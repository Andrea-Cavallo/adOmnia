import type { CancellablePromise } from '@wailsio/runtime'
import { monaco } from '@/lib/monacoSetup'
import {
  requestCodeActions,
  requestCompletion,
  requestDocumentSymbols,
  requestFormatting,
  requestHover,
  requestLocations,
  requestResolveCodeAction,
  requestSignatureHelp,
  type GoIDEDiagnosticsReport,
  type GoIDEEditorLocation,
  type GoIDEEditorRange,
  type GoIDEEditorTextEdit,
  type GoIDESymbolNode,
} from '@/lib/goide-lsp-api'
import { useGoIDEStore, type GoIDEEditorDocument } from '@/stores/goide'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { currentGoStudioDocumentVersion, flushGoStudioDocument } from './goStudioLspSync'
import { applyGoStudioWorkspaceChange } from './goStudioWorkspaceEdits'
import { lintActionsFor } from './goStudioLintActions'
import { editorModelUri, fileUri } from './goStudioModelUri'

const LANGUAGE = 'go'
const MARKER_OWNER = 'gopls'
const LINT_MARKER_OWNER = 'lint'
export const APPLY_CODE_ACTION_COMMAND = 'goStudio.applyCodeAction'

const COMPLETION_KINDS = [
  'Text', 'Text', 'Method', 'Function', 'Constructor', 'Field', 'Variable', 'Class', 'Interface', 'Module', 'Property',
  'Unit', 'Value', 'Enum', 'Keyword', 'Snippet', 'Color', 'File', 'Reference', 'Folder', 'EnumMember', 'Constant',
  'Struct', 'Event', 'Operator', 'TypeParameter',
] as const

interface PreparedDocument {
  document: GoIDEEditorDocument
  sessionId: string
  documentId: string
}

const locationCache = new Map<string, GoIDEEditorLocation>()
let registered = false

export function toMonacoRange(range: GoIDEEditorRange): monaco.IRange {
  return { startLineNumber: range.startLine, startColumn: range.startColumn, endLineNumber: range.endLine, endColumn: range.endColumn }
}

export function toEditorRange(range: monaco.IRange): GoIDEEditorRange {
  return { startLine: range.startLineNumber, startColumn: range.startColumn, endLine: range.endLineNumber, endColumn: range.endColumn }
}

export function toMonacoEdits(edits: GoIDEEditorTextEdit[]): monaco.editor.IIdentifiedSingleEditOperation[] {
  return edits.map((edit) => ({ range: toMonacoRange(edit.range), text: edit.text, forceMoveMarkers: true }))
}

/** Trova il documento Go Studio associato a un modello Monaco. */
export function documentForModel(model: monaco.editor.ITextModel): GoIDEEditorDocument | null {
  const target = model.uri.toString()
  return useGoIDEStore.getState().documents.find((item) => editorModelUri(item.document) === target) ?? null
}

function languageServerReady(sessionId: string): boolean {
  return useGoIDELspStore.getState().status[sessionId]?.state === 'ready'
}

/** Sincronizza il buffer e verifica che gopls sia pronto prima di una richiesta semantica. */
export async function prepareDocument(model: monaco.editor.ITextModel): Promise<PreparedDocument | null> {
  const document = documentForModel(model)
  if (!document || !languageServerReady(document.document.sessionId)) return null
  await flushGoStudioDocument(document.document.id)
  return { document, sessionId: document.document.sessionId, documentId: document.document.id }
}

/** Lega una CancellablePromise al token Monaco e scarta risposte fallite o annullate. */
async function cancellable<T>(request: CancellablePromise<T>, token: monaco.CancellationToken): Promise<T | null> {
  const subscription = token.onCancellationRequested(() => request.cancel())
  try {
    const result = await request
    return token.isCancellationRequested ? null : result
  } catch {
    return null
  } finally {
    subscription.dispose()
  }
}

/** Una risposta è valida solo se si riferisce alla versione del buffer ancora corrente. */
function isCurrent(documentId: string, version: number): boolean {
  const current = currentGoStudioDocumentVersion(documentId)
  return current === null || current === version
}

/** Apre la posizione nel progetto o, per SDK e module cache, in sola lettura. */
export function navigateToLocation(location: GoIDEEditorLocation): void {
  const store = useGoIDEStore.getState()
  const { startLine, startColumn } = location.range
  if (location.external || !location.relativePath) void store.openExternalLocation(location.path, startLine, startColumn)
  else void store.openLocation(location.relativePath, startLine, startColumn)
}

function rememberLocations(locations: GoIDEEditorLocation[]): monaco.languages.Location[] {
  return locations.map((location) => {
    const uri = monaco.Uri.parse(location.uri)
    locationCache.set(uri.toString(), location)
    return { uri, range: toMonacoRange(location.range) }
  })
}

function completionItem(entry: Awaited<ReturnType<typeof requestCompletion>>['items'][number], fallback: monaco.IRange): monaco.languages.CompletionItem {
  const kindName = COMPLETION_KINDS[entry.kind] ?? 'Text'
  return {
    label: entry.label,
    kind: monaco.languages.CompletionItemKind[kindName],
    detail: entry.detail,
    documentation: entry.documentation ? { value: entry.documentation } : undefined,
    sortText: entry.sortText,
    filterText: entry.filterText,
    insertText: entry.insertText,
    insertTextRules: entry.snippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
    range: entry.range ? toMonacoRange(entry.range) : fallback,
    additionalTextEdits: entry.additionalEdits?.map((edit) => ({ range: toMonacoRange(edit.range), text: edit.text })),
    preselect: entry.preselect,
    tags: entry.deprecated ? [monaco.languages.CompletionItemTag.Deprecated] : undefined,
  }
}

function symbolTree(nodes: GoIDESymbolNode[]): monaco.languages.DocumentSymbol[] {
  return nodes.map((node) => ({
    name: node.name,
    detail: node.detail ?? '',
    kind: Math.max(0, node.kind - 1) as monaco.languages.SymbolKind,
    tags: [],
    range: toMonacoRange(node.range),
    selectionRange: toMonacoRange(node.selectionRange),
    children: symbolTree(node.children ?? []),
  }))
}

function registerProviders(): void {
  monaco.languages.registerCompletionItemProvider(LANGUAGE, {
    triggerCharacters: ['.'],
    async provideCompletionItems(model, position, _context, token) {
      const prepared = await prepareDocument(model)
      if (!prepared) return { suggestions: [] }
      const result = await cancellable(requestCompletion(prepared.sessionId, prepared.documentId, position.lineNumber, position.column), token)
      if (!result || !isCurrent(prepared.documentId, result.version)) return { suggestions: [] }
      const word = model.getWordUntilPosition(position)
      const fallback = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn }
      return { suggestions: result.items.map((entry) => completionItem(entry, fallback)), incomplete: result.incomplete }
    },
  })

  monaco.languages.registerHoverProvider(LANGUAGE, {
    async provideHover(model, position, token) {
      const prepared = await prepareDocument(model)
      if (!prepared) return null
      const result = await cancellable(requestHover(prepared.sessionId, prepared.documentId, position.lineNumber, position.column), token)
      if (!result?.markdown || !isCurrent(prepared.documentId, result.version)) return null
      return { contents: [{ value: result.markdown }], range: result.range ? toMonacoRange(result.range) : undefined }
    },
  })

  monaco.languages.registerSignatureHelpProvider(LANGUAGE, {
    signatureHelpTriggerCharacters: ['(', ','],
    signatureHelpRetriggerCharacters: [','],
    async provideSignatureHelp(model, position, token) {
      const prepared = await prepareDocument(model)
      if (!prepared) return null
      const result = await cancellable(requestSignatureHelp(prepared.sessionId, prepared.documentId, position.lineNumber, position.column), token)
      if (!result || result.signatures.length === 0 || !isCurrent(prepared.documentId, result.version)) return null
      return {
        value: {
          signatures: result.signatures.map((signature) => ({
            label: signature.label,
            documentation: signature.documentation ? { value: signature.documentation } : undefined,
            parameters: signature.parameters.map((parameter) => ({ label: parameter.label, documentation: parameter.documentation ? { value: parameter.documentation } : undefined })),
          })),
          activeSignature: result.activeSignature,
          activeParameter: result.activeParameter,
        },
        dispose: () => undefined,
      }
    },
  })

  const locationProvider = (kind: 'definition' | 'typeDefinition') => ({
    async provide(model: monaco.editor.ITextModel, position: monaco.Position, token: monaco.CancellationToken) {
      const prepared = await prepareDocument(model)
      if (!prepared) return null
      const locations = await cancellable(requestLocations(prepared.sessionId, prepared.documentId, kind, position.lineNumber, position.column), token)
      return locations ? rememberLocations(locations) : null
    },
  })
  const definition = locationProvider('definition')
  const typeDefinition = locationProvider('typeDefinition')
  monaco.languages.registerDefinitionProvider(LANGUAGE, { provideDefinition: definition.provide })
  monaco.languages.registerTypeDefinitionProvider(LANGUAGE, { provideTypeDefinition: typeDefinition.provide })

  monaco.languages.registerDocumentSymbolProvider(LANGUAGE, {
    async provideDocumentSymbols(model, token) {
      const prepared = await prepareDocument(model)
      if (!prepared) return []
      const result = await cancellable(requestDocumentSymbols(prepared.sessionId, prepared.documentId), token)
      return result ? symbolTree(result.symbols) : []
    },
  })

  monaco.languages.registerDocumentFormattingEditProvider(LANGUAGE, {
    async provideDocumentFormattingEdits(model, _options, token) {
      const prepared = await prepareDocument(model)
      if (!prepared) return []
      const result = await cancellable(requestFormatting(prepared.sessionId, prepared.documentId), token)
      if (!result || !isCurrent(prepared.documentId, result.version)) return []
      return result.edits.map((edit) => ({ range: toMonacoRange(edit.range), text: edit.text }))
    },
  })

  monaco.languages.registerCodeActionProvider(LANGUAGE, {
    async provideCodeActions(model, range, _context, token) {
      const prepared = await prepareDocument(model)
      if (!prepared) return { actions: [], dispose: () => undefined }
      const actions = await cancellable(requestCodeActions(prepared.sessionId, prepared.documentId, toEditorRange(range)), token)
      return {
        actions: (actions ?? []).map((action) => ({
          title: action.title,
          kind: action.kind || 'quickfix',
          isPreferred: action.preferred,
          disabled: action.disabled || undefined,
          command: { id: APPLY_CODE_ACTION_COMMAND, title: action.title, arguments: [prepared.sessionId, action.id] },
        })),
        dispose: () => undefined,
      }
    },
  }, { providedCodeActionKinds: ['quickfix', 'refactor', 'source'] })

  // Alt+Enter unisce le azioni di gopls a quelle dei linter (correzioni proposte e soppressione della riga).
  monaco.languages.registerCodeActionProvider(LANGUAGE, {
    provideCodeActions(model, range) {
      const document = documentForModel(model)
      const report = document ? lintReportFor(document.document.sessionId, fileUri(document.document.uri)) : null
      if (!document || !report) return { actions: [], dispose: () => undefined }
      const actions = lintActionsFor(report.diagnostics, range.startLineNumber, range.endLineNumber, (line) => line <= model.getLineCount() ? model.getLineContent(line) : '', !document.dirty)
      return {
        actions: actions.map((action) => ({
          title: action.title,
          kind: 'quickfix',
          isPreferred: action.preferred,
          diagnostics: [{ ...toMonacoRange(action.diagnostic.range), severity: SEVERITY[action.diagnostic.severity] ?? monaco.MarkerSeverity.Warning, message: action.diagnostic.message }],
          edit: { edits: action.edits.map((edit) => ({ resource: model.uri, textEdit: { range: toMonacoRange(edit.range), text: edit.text }, versionId: model.getVersionId() })) },
        })),
        dispose: () => undefined,
      }
    },
  }, { providedCodeActionKinds: ['quickfix'] })

  monaco.editor.registerCommand(APPLY_CODE_ACTION_COMMAND, (_accessor, sessionId: string, actionId: string) => {
    void requestResolveCodeAction(sessionId, actionId)
      .then((change) => applyGoStudioWorkspaceChange(change))
      .catch((error: unknown) => useGoIDEStore.setState({ error: error instanceof Error ? error.message : String(error) }))
  })

  // Monaco standalone non sa aprire altri file: la navigazione passa dallo store di Go Studio.
  monaco.editor.registerEditorOpener({
    openCodeEditor(_source, resource, selectionOrPosition) {
      const cached = locationCache.get(resource.toString())
      const start = selectionOrPosition && 'startLineNumber' in selectionOrPosition
        ? { line: selectionOrPosition.startLineNumber, column: selectionOrPosition.startColumn }
        : { line: selectionOrPosition?.lineNumber ?? 1, column: selectionOrPosition?.column ?? 1 }
      const location: GoIDEEditorLocation = cached
        ? { ...cached, range: { startLine: start.line, startColumn: start.column, endLine: start.line, endColumn: start.column } }
        : { uri: resource.toString(), path: resource.fsPath, external: true, range: { startLine: start.line, startColumn: start.column, endLine: start.line, endColumn: start.column } }
      navigateToLocation(location)
      return true
    },
  })
}

const SEVERITY: Record<number, monaco.MarkerSeverity> = {
  1: monaco.MarkerSeverity.Error,
  2: monaco.MarkerSeverity.Warning,
  3: monaco.MarkerSeverity.Info,
  4: monaco.MarkerSeverity.Hint,
}

function markersFor(report: GoIDEDiagnosticsReport): monaco.editor.IMarkerData[] {
  return report.diagnostics.map((diagnostic) => ({
    ...toMonacoRange(diagnostic.range),
    severity: SEVERITY[diagnostic.severity] ?? monaco.MarkerSeverity.Info,
    message: diagnostic.message,
    source: diagnostic.source || MARKER_OWNER,
    code: diagnostic.code || undefined,
  }))
}

function reportFor(reports: Record<string, GoIDEDiagnosticsReport> | undefined, uri: string): GoIDEDiagnosticsReport | null {
  return Object.values(reports ?? {}).find((report) => fileUri(report.uri) === uri) ?? null
}

function lintReportFor(sessionId: string, uri: string): GoIDEDiagnosticsReport | null {
  return reportFor(useGoIDELspStore.getState().lint[sessionId]?.reports, uri)
}

/** gopls e linter usano owner distinti: ognuno aggiorna solo i propri marker. */
function applyMarkers(): void {
  // Ogni modello riceve solo la diagnostica della propria sessione: nessun marker attraversa i progetti.
  const state = useGoIDELspStore.getState()
  for (const model of monaco.editor.getModels()) {
    const document = documentForModel(model)
    const sessionId = document?.document.sessionId
    const uri = document ? fileUri(document.document.uri) : ''
    const gopls = sessionId ? reportFor(state.diagnostics[sessionId], uri) : null
    const lint = sessionId ? reportFor(state.lint[sessionId]?.reports, uri) : null
    monaco.editor.setModelMarkers(model, MARKER_OWNER, gopls ? markersFor(gopls) : [])
    monaco.editor.setModelMarkers(model, LINT_MARKER_OWNER, lint ? markersFor(lint) : [])
  }
}

/** Registra una sola volta provider, comandi, opener e marker per il linguaggio Go. */
export function registerGoStudioLanguageFeatures(): void {
  if (registered) return
  registered = true
  registerProviders()
  applyMarkers()
  monaco.editor.onDidCreateModel(() => applyMarkers())
  useGoIDELspStore.subscribe((state, previous) => {
    if (state.diagnostics !== previous.diagnostics || state.lint !== previous.lint) applyMarkers()
  })
}
