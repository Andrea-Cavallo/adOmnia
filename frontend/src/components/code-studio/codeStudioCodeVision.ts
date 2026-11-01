import { useCodeStudioStore } from '@/stores/codeStudio'
import { codeVisionEditorLanguages } from '@/components/ide/languages'
import { monaco } from '@/lib/monacoSetup'
import { requestDocumentSymbols, requestLocations, requestPrepareHierarchy, type GoIDESymbolNode } from '@/lib/code-studio-lsp-api'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { prepareDocument } from './codeStudioLanguageFeatures'
import { heavyFeatureEnabled } from './codeStudioResourceMode'

// Provider LSP generici: valgono per ogni linguaggio servito da un language server.
const LANGUAGE = codeVisionEditorLanguages()
const SHOW_USAGES_COMMAND = 'codeStudio.codeVisionUsages'

/** Kind LSP dei simboli che meritano Code Vision: funzioni, metodi, tipi, costanti e variabili di package. */
const VISION_KINDS = new Set([5, 6, 10, 11, 12, 13, 14, 23])
/** Punti di ingresso chiamati dal runtime: il conteggio degli usi sarebbe sempre zero e fuorviante. */
const ENTRY_POINT = /^(main|init|(Test|Benchmark|Fuzz|Example)\w*)$/


interface VisionLens extends monaco.languages.CodeLens {
  visionSymbol: { name: string, line: number, column: number, countUsages: boolean }
}

let registered = false

function report(message: string): void {
  useCodeStudioLspStore.setState({ message })
}

/** Chiave stabile delle sessioni che soddisfano il predicato: cambia solo quando cambia la prontezza, non ad ogni progresso. */
function readySessions<T>(status: Record<string, T>, isReady: (value: T) => boolean): string {
  return Object.keys(status).filter((sessionId) => isReady(status[sessionId])).sort((a, b) => a.localeCompare(b)).join('|')
}

function usagesLabel(count: number): string {
  if (count === 0) return 'no usages'
  return count === 1 ? '1 usage' : `${count} usages`
}

function visionLens(symbol: GoIDESymbolNode): VisionLens {
  const { startLine, startColumn } = symbol.selectionRange
  return {
    range: { startLineNumber: startLine, startColumn: 1, endLineNumber: startLine, endColumn: 1 },
    visionSymbol: { name: symbol.name, line: startLine, column: startColumn, countUsages: !ENTRY_POINT.test(symbol.name) },
  }
}

async function provideVisionLenses(model: monaco.editor.ITextModel, token: monaco.CancellationToken): Promise<monaco.languages.CodeLensList> {
  const empty = { lenses: [], dispose: () => undefined }
  if (!heavyFeatureEnabled(useCodeStudioLspStore.getState(), 'codeVision')) return empty
  const prepared = await prepareDocument(model)
  if (!prepared || prepared.document.document.readOnly || token.isCancellationRequested) return empty
  try {
    const result = await requestDocumentSymbols(prepared.sessionId, prepared.documentId)
    if (token.isCancellationRequested) return empty
    const lenses: monaco.languages.CodeLens[] = []
    const visit = (symbols: GoIDESymbolNode[]) => {
      for (const symbol of symbols) {
        if (VISION_KINDS.has(symbol.kind)) {
          const lens = visionLens(symbol)
          if (lens.visionSymbol.countUsages) lenses.push(lens)
          if ([6,12].includes(symbol.kind)) lenses.push({ range: lens.range, command: { id: 'codeStudio.functionExplorer', title: 'callers · callees', arguments: [prepared.sessionId, prepared.documentId, symbol.selectionRange.startLine, symbol.selectionRange.startColumn] } })
        }
        if (symbol.children) visit(symbol.children)
      }
    }
    visit(result.symbols)
    return { lenses, dispose: () => undefined }
  } catch {
    return empty
  }
}

async function resolveVisionLens(model: monaco.editor.ITextModel, lens: VisionLens, token: monaco.CancellationToken): Promise<monaco.languages.CodeLens> {
  const { name, line, column, countUsages } = lens.visionSymbol
  const parts: string[] = []
  if (countUsages) {
    const prepared = await prepareDocument(model)
    if (prepared && !token.isCancellationRequested) {
      try {
        const locations = await requestLocations(prepared.sessionId, prepared.documentId, 'references', line, column)
        // gopls include la dichiarazione tra i riferimenti.
        parts.push(usagesLabel(Math.max(0, locations.length - 1)))
        lens.command = { id: SHOW_USAGES_COMMAND, title: '', arguments: [prepared.sessionId, prepared.documentId, line, column, name] }
      } catch {
        // An unresolved symbol has no usage count to display.
      }
    }
  }
  const title = parts.join('  ·  ')
  lens.command = lens.command ? { ...lens.command, title } : { id: '', title }
  return lens
}

async function showUsages(sessionId: string, documentId: string, line: number, column: number, name: string): Promise<void> {
  try {
    const locations = await requestLocations(sessionId, documentId, 'references', line, column)
    if (locations.length <= 1) return report(`No usages of ${name} found.`)
    useCodeStudioLspStore.getState().showReferences(sessionId, { title: `Usages of ${name}`, locations })
  } catch (error) {
    report(error instanceof Error ? error.message : String(error))
  }
}

/** Usage navigation stays separate from opt-in Git blame annotations. */
export function registerCodeStudioCodeVision(): void {
  if (registered) return
  registered = true
  const changed = new monaco.Emitter<monaco.languages.CodeLensProvider>()
  const provider: monaco.languages.CodeLensProvider = {
    onDidChange: changed.event,
    provideCodeLenses: provideVisionLenses,
    resolveCodeLens: (model, lens, token) => 'visionSymbol' in lens ? resolveVisionLens(model, lens as VisionLens, token) : lens,
  }
  // Refresh lenses when the language server becomes ready.
  // Anche quando l'utente accende o spegne Code Vision, o cambia la modalità a basso consumo.
  useCodeStudioLspStore.subscribe((state, previous) => {
    const readyChanged = readySessions(state.status, (status) => status.state === 'ready') !== readySessions(previous.status, (status) => status.state === 'ready')
    if (readyChanged || heavyFeatureEnabled(state, 'codeVision') !== heavyFeatureEnabled(previous, 'codeVision')) changed.fire(provider)
  })
  monaco.editor.registerCommand(SHOW_USAGES_COMMAND, (_accessor, sessionId: string, documentId: string, line: number, column: number, name: string) => {
    void showUsages(sessionId, documentId, line, column, name)
  })
  monaco.editor.registerCommand('codeStudio.functionExplorer', async (_accessor, sessionId: string, documentId: string, line: number, column: number) => {
    try {
      const roots = await requestPrepareHierarchy(sessionId, documentId, 'call', line, column)
      if (useCodeStudioStore.getState().activeSessionId !== sessionId) return
      if (roots[0]) useCodeStudioLspStore.setState({ hierarchy: { sessionId, kind: 'call', root: roots[0] } })
      else report('No call hierarchy reported for this symbol.')
    } catch (error) { report(String(error)) }
  })
  monaco.languages.registerCodeLensProvider(LANGUAGE, provider)
}
