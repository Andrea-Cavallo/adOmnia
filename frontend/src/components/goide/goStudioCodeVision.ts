import { monaco } from '@/lib/monacoSetup'
import { requestDocumentSymbols, requestLocations, type GoIDESymbolNode } from '@/lib/goide-lsp-api'
import { getGoIDEBlame, type GoIDEVCSBlameLine } from '@/lib/goide-vcs-api'
import type { GoIDEEditorDocument } from '@/stores/goide'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { useGoIDEVCSStore } from '@/stores/goideVcs'
import { prepareDocument } from './goStudioLanguageFeatures'

const LANGUAGE = 'go'
const SHOW_USAGES_COMMAND = 'goStudio.codeVisionUsages'
const UNCOMMITTED_HASH = /^0+$/

/** Kind LSP dei simboli che meritano Code Vision: funzioni, metodi, tipi, costanti e variabili di package. */
const VISION_KINDS = new Set([5, 6, 11, 12, 13, 14, 23])
/** Punti di ingresso chiamati dal runtime: il conteggio degli usi sarebbe sempre zero e fuorviante. */
const ENTRY_POINT = /^(main|init|(Test|Benchmark|Fuzz|Example)\w*)$/

interface VisionLens extends monaco.languages.CodeLens {
  visionSymbol: { name: string, line: number, column: number, countUsages: boolean, author: string }
}

let registered = false
const blameCache = new Map<string, Promise<GoIDEVCSBlameLine[]>>()

function report(message: string): void {
  useGoIDELspStore.setState({ message })
}

/** Chiave stabile delle sessioni che soddisfano il predicato: cambia solo quando cambia la prontezza, non ad ogni progresso. */
function readySessions<T>(status: Record<string, T>, isReady: (value: T) => boolean): string {
  return Object.keys(status).filter((sessionId) => isReady(status[sessionId])).sort().join('|')
}

function usagesLabel(count: number): string {
  if (count === 0) return 'no usages'
  return count === 1 ? '1 usage' : `${count} usages`
}

/** Blame del file su disco, una volta per versione salvata. Nessun repository: nessun autore. */
function blameFor(document: GoIDEEditorDocument): Promise<GoIDEVCSBlameLine[]> {
  const { sessionId, relativePath, id, external } = document.document
  if (external || !useGoIDEVCSStore.getState().status[sessionId]?.available) return Promise.resolve([])
  const key = `${id}:${document.diskToken}`
  const cached = blameCache.get(key)
  if (cached) return cached
  const request = getGoIDEBlame(sessionId, relativePath).catch(() => [])
  blameCache.set(key, request)
  return request
}

/** Autore dell'ultima modifica nel range, come in IntelliJ: "*" se ci sono righe non committate. */
export function authorForRange(blame: GoIDEVCSBlameLine[], startLine: number, endLine: number): string {
  const lines = blame.filter((line) => line.line >= startLine && line.line <= endLine)
  const committed = lines.filter((line) => !UNCOMMITTED_HASH.test(line.hash))
  const hasUncommitted = committed.length < lines.length
  if (committed.length === 0) return hasUncommitted ? 'new *' : ''
  const latest = committed.reduce((best, line) => line.date > best.date ? line : best)
  return hasUncommitted ? `${latest.author} *` : latest.author
}

function visionLens(symbol: GoIDESymbolNode, author: string): VisionLens {
  const { startLine, startColumn } = symbol.selectionRange
  return {
    range: { startLineNumber: startLine, startColumn: 1, endLineNumber: startLine, endColumn: 1 },
    visionSymbol: { name: symbol.name, line: startLine, column: startColumn, countUsages: !ENTRY_POINT.test(symbol.name), author },
  }
}

async function provideVisionLenses(model: monaco.editor.ITextModel, token: monaco.CancellationToken): Promise<monaco.languages.CodeLensList> {
  const empty = { lenses: [], dispose: () => undefined }
  const prepared = await prepareDocument(model)
  if (!prepared || prepared.document.document.readOnly || token.isCancellationRequested) return empty
  try {
    const [result, blame] = await Promise.all([
      requestDocumentSymbols(prepared.sessionId, prepared.documentId),
      // Il blame descrive il file salvato: con modifiche in corso le righe non corrispondono più.
      prepared.document.dirty ? Promise.resolve([]) : blameFor(prepared.document),
    ])
    if (token.isCancellationRequested) return empty
    const lenses = result.symbols
      .filter((symbol) => VISION_KINDS.has(symbol.kind))
      .map((symbol) => visionLens(symbol, authorForRange(blame, symbol.range.startLine, symbol.range.endLine)))
      .filter((lens) => lens.visionSymbol.countUsages || lens.visionSymbol.author)
    return { lenses, dispose: () => undefined }
  } catch {
    return empty
  }
}

async function resolveVisionLens(model: monaco.editor.ITextModel, lens: VisionLens, token: monaco.CancellationToken): Promise<monaco.languages.CodeLens> {
  const { name, line, column, countUsages, author } = lens.visionSymbol
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
        // gopls occupato o simbolo non risolvibile: resta solo l'autore.
      }
    }
  }
  if (author) parts.push(author)
  const title = parts.join('  ·  ')
  lens.command = lens.command ? { ...lens.command, title } : { id: '', title }
  return lens
}

async function showUsages(sessionId: string, documentId: string, line: number, column: number, name: string): Promise<void> {
  try {
    const locations = await requestLocations(sessionId, documentId, 'references', line, column)
    if (locations.length <= 1) return report(`No usages of ${name} found.`)
    useGoIDELspStore.getState().showReferences(sessionId, { title: `Usages of ${name}`, locations })
  } catch (error) {
    report(error instanceof Error ? error.message : String(error))
  }
}

/** Code Vision alla IntelliJ: numero di usi e autore git sopra ogni dichiarazione di package. */
export function registerGoStudioCodeVision(): void {
  if (registered) return
  registered = true
  const changed = new monaco.Emitter<monaco.languages.CodeLensProvider>()
  const provider: monaco.languages.CodeLensProvider = {
    onDidChange: changed.event,
    provideCodeLenses: provideVisionLenses,
    resolveCodeLens: (model, lens, token) => resolveVisionLens(model, lens as VisionLens, token),
  }
  // gopls pronto o repository rilevato: i lens calcolati prima erano vuoti o senza autore.
  useGoIDELspStore.subscribe((state, previous) => {
    if (readySessions(state.status, (status) => status.state === 'ready') !== readySessions(previous.status, (status) => status.state === 'ready')) changed.fire(provider)
  })
  useGoIDEVCSStore.subscribe((state, previous) => {
    if (readySessions(state.status, (status) => !!status?.available) !== readySessions(previous.status, (status) => !!status?.available)) changed.fire(provider)
  })
  monaco.editor.registerCommand(SHOW_USAGES_COMMAND, (_accessor, sessionId: string, documentId: string, line: number, column: number, name: string) => {
    void showUsages(sessionId, documentId, line, column, name)
  })
  monaco.languages.registerCodeLensProvider(LANGUAGE, provider)
}
