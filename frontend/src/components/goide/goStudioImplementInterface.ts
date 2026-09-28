import { monaco } from '@/lib/monacoSetup'
import {
  requestCodeActions,
  requestDocumentSymbols,
  requestOrganizeImports,
  requestResolveCodeAction,
  type GoIDESymbolNode,
  type GoIDEWorkspaceSymbol,
} from '@/lib/goide-lsp-api'
import { useGoIDELspStore, type GoIDEImplementRequest } from '@/stores/goideLsp'
import { prepareDocument } from './goStudioLanguageFeatures'
import { applyGoStudioWorkspaceChange } from './goStudioWorkspaceEdits'

const LSP_KIND_STRUCT = 23
const LSP_KIND_INTERFACE = 11
const QUICK_FIX_ATTEMPTS = 16
const QUICK_FIX_INTERVAL_MS = 250
const DECLARE_METHODS = /^Declare missing methods of /

function report(message: string): void {
  useGoIDELspStore.setState({ message })
}

function directoryOf(relativePath: string): string {
  const slash = relativePath.lastIndexOf('/')
  return slash < 0 ? '' : relativePath.slice(0, slash)
}

/** Struct la cui dichiarazione contiene la riga del cursore (anche dentro i campi). */
export function structAtLine(symbols: GoIDESymbolNode[], line: number): GoIDESymbolNode | null {
  for (const symbol of symbols) {
    if (symbol.kind === LSP_KIND_STRUCT && symbol.range.startLine <= line && line <= symbol.range.endLine) return symbol
    const nested = structAtLine(symbol.children ?? [], line)
    if (nested) return nested
  }
  return null
}

/** Interfacce utilizzabili: niente interfacce embedded (Nome.Embedded) né non esportate di altri package. */
export function implementableInterfaces(symbols: GoIDEWorkspaceSymbol[], directory: string): GoIDEWorkspaceSymbol[] {
  return symbols.filter((symbol) => {
    if (symbol.kind !== LSP_KIND_INTERFACE || symbol.name.includes('.')) return false
    const samePackage = !symbol.location.external && directoryOf(symbol.location.relativePath ?? '') === directory
    return samePackage || /^[A-Z]/.test(symbol.name)
  })
}

/** Nome dell'interfaccia come va scritto nel file: qualificato con il package se esterno. */
export function interfaceReference(symbol: GoIDEWorkspaceSymbol, directory: string): string {
  const samePackage = !symbol.location.external && directoryOf(symbol.location.relativePath ?? '') === directory
  if (samePackage || !symbol.container) return symbol.name
  const packageName = symbol.container.split('/').pop() ?? symbol.container
  return `${packageName}.${symbol.name}`
}

/** Asserzione idiomatica di compile-time: mantiene il tipo allineato all'interfaccia anche in futuro. */
export function interfaceAssertion(typeName: string, reference: string): string {
  return `var _ ${reference} = (*${typeName})(nil)`
}

/** Prepara la richiesta Implement Interface dal cursore; spiega cosa manca se il cursore non è su una struct. */
export async function requestImplementInterface(editor: monaco.editor.ICodeEditor): Promise<void> {
  const model = editor.getModel()
  const position = editor.getPosition()
  const prepared = model ? await prepareDocument(model) : null
  if (!model || !position || !prepared) return report('gopls is not ready for this file yet.')
  const symbols = await requestDocumentSymbols(prepared.sessionId, prepared.documentId).catch(() => null)
  const target = symbols ? structAtLine(symbols.symbols, position.lineNumber) : null
  if (!target) return report('Implement Interface: place the caret on a struct type declaration.')
  const request: GoIDEImplementRequest = {
    sessionId: prepared.sessionId, documentId: prepared.documentId, typeName: target.name,
    declarationEndLine: target.range.endLine, directory: directoryOf(prepared.document.document.relativePath),
  }
  useGoIDELspStore.setState({ implementRequest: request })
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

/** gopls propone il quick fix solo dopo aver ricalcolato la diagnostica del buffer appena modificato. */
async function waitForDeclareMethods(editor: monaco.editor.ICodeEditor, line: number): Promise<string | null> {
  for (let attempt = 0; attempt < QUICK_FIX_ATTEMPTS; attempt++) {
    const model = editor.getModel()
    const prepared = model ? await prepareDocument(model) : null
    if (!model || !prepared) return null
    const lineText = model.getLineContent(line)
    const column = lineText.indexOf('(*') + 2
    const actions = await requestCodeActions(prepared.sessionId, prepared.documentId, { startLine: line, startColumn: column, endLine: line, endColumn: column }, ['quickfix']).catch(() => [])
    const declare = actions.find((action) => DECLARE_METHODS.test(action.title))
    if (declare) return declare.id
    await wait(QUICK_FIX_INTERVAL_MS)
  }
  return null
}

/**
 * Implementa l'interfaccia scelta: inserisce l'asserzione, aggiunge l'import con Optimize Imports,
 * poi applica (dopo anteprima) i metodi generati da gopls. Annullando, l'editor torna com'era.
 */
export async function implementInterface(editor: monaco.editor.ICodeEditor, request: GoIDEImplementRequest, symbol: GoIDEWorkspaceSymbol): Promise<void> {
  const model = editor.getModel()
  if (!model) return
  const reference = interfaceReference(symbol, request.directory)
  const assertion = interfaceAssertion(request.typeName, reference)
  const endColumn = model.getLineMaxColumn(request.declarationEndLine)
  let undoSteps = 0
  editor.pushUndoStop()
  editor.executeEdits('go-studio-implement', [{
    range: { startLineNumber: request.declarationEndLine, startColumn: endColumn, endLineNumber: request.declarationEndLine, endColumn },
    text: `\n\n${assertion}`,
  }])
  editor.pushUndoStop()
  undoSteps++
  const revert = () => { for (let step = 0; step < undoSteps; step++) editor.trigger('go-studio-implement', 'undo', null) }
  if (reference.includes('.')) {
    const prepared = await prepareDocument(model)
    const imports = prepared ? await requestOrganizeImports(prepared.sessionId, prepared.documentId).catch(() => null) : null
    if (imports && imports.files.length > 0) {
      await applyGoStudioWorkspaceChange(imports)
      undoSteps++
    }
  }
  // Optimize Imports può spostare le righe: l'asserzione si ritrova per contenuto.
  const assertionLine = model.getLinesContent().indexOf(assertion) + 1
  const actionId = assertionLine > 0 ? await waitForDeclareMethods(editor, assertionLine) : null
  const prepared = await prepareDocument(model)
  if (!actionId || !prepared) {
    revert()
    return report(`${request.typeName} already implements ${reference}, or gopls could not generate its methods.`)
  }
  try {
    const change = await requestResolveCodeAction(prepared.sessionId, actionId)
    useGoIDELspStore.setState({ pendingChange: { ...change, label: `Implement ${reference} on *${request.typeName}` }, pendingChangeOnCancel: revert })
  } catch (error) {
    revert()
    report(error instanceof Error ? error.message : String(error))
  }
}
