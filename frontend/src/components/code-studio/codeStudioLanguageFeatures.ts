import { completeLocalJava } from '@/components/ide/languages/java/javaLocalCompletion'
import { analyzeJavaFile } from '@/components/ide/languages/java/javaLocalAnalysis'
import { languageServerEditorLanguages } from '@/components/ide/languages'
import { isServerReady, serverLanguageForEditor } from '@/stores/ideLanguageServers'
import { extensionLanguageForPath } from '@/stores/ideExtensions'
import { ExtensionLanguageStatus } from '../../../bindings/adomnia/goide'
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
} from '@/lib/code-studio-lsp-api'
import { useCodeStudioStore, type GoIDEEditorDocument } from '@/stores/codeStudio'
import { navigateToLocation, type StudioLocation } from './codeStudioNavigation'
import { goModDefinitionLocation } from './codeStudioDependencySource'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { currentCodeStudioDocumentVersion, flushCodeStudioDocument } from './codeStudioLspSync'
import { applyCodeStudioWorkspaceChange } from './codeStudioWorkspaceEdits'
import { lintActionsFor } from './codeStudioLintActions'
import { editorModelUri, fileUri } from './codeStudioModelUri'
import { fixCodeStudioProblemWithAI, codeStudioAIFixAvailable } from './codeStudioAIFixRunner'

// Provider LSP generici: valgono per ogni linguaggio servito da un language server.
let LANGUAGE = languageServerEditorLanguages()
const MARKER_OWNER = 'gopls'
const LINT_MARKER_OWNER = 'lint'
export const APPLY_CODE_ACTION_COMMAND = 'codeStudio.applyCodeAction'
const AI_FIX_COMMAND = 'codeStudio.fixWithAI'

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

const locationCache = new Map<string, StudioLocation>()
const previewDocuments = new Map<string, GoIDEEditorDocument>()
let registered = false
let commandsRegistered = false
const registeredLanguages = new Set<string>()

export function toMonacoRange(range: GoIDEEditorRange): monaco.IRange {
  return { startLineNumber: range.startLine, startColumn: range.startColumn, endLineNumber: range.endLine, endColumn: range.endColumn }
}

export function toEditorRange(range: monaco.IRange): GoIDEEditorRange {
  return { startLine: range.startLineNumber, startColumn: range.startColumn, endLine: range.endLineNumber, endColumn: range.endColumn }
}

export function toMonacoEdits(edits: GoIDEEditorTextEdit[]): monaco.editor.IIdentifiedSingleEditOperation[] {
  return edits.map((edit) => ({ range: toMonacoRange(edit.range), text: edit.text, forceMoveMarkers: true }))
}

/** Trova il documento Code Studio associato a un modello Monaco. */
export function documentForModel(model: monaco.editor.ITextModel): GoIDEEditorDocument | null {
  const target = model.uri.toString()
  return useCodeStudioStore.getState().documents.find((item) => editorModelUri(item.document) === target) ?? previewDocuments.get(target) ?? null
}

/** Il go.mod del progetto: le sue dipendenze si aprono come sorgenti, non come simboli. */
function isGoModDocument(document: GoIDEEditorDocument): boolean {
  return document.document.relativePath.replace(/\\/g, '/').split('/').pop() === 'go.mod'
}

function languageServerReady(sessionId: string): boolean {
  return useCodeStudioLspStore.getState().status[sessionId]?.state === 'ready'
}

/** Sincronizza il buffer e verifica che gopls sia pronto prima di una richiesta semantica. */
export async function prepareDocument(model: monaco.editor.ITextModel): Promise<PreparedDocument | null> {
  const document = documentForModel(model)
  if (!document) return null
  const extension = extensionLanguageForPath(document.document.relativePath)
  if (extension) {
    if (!extension.server || (await ExtensionLanguageStatus(document.document.sessionId,extension.id).catch(() => null))?.state !== 'ready') return null
  } else if (serverLanguageForEditor(document.document.language)) {
    if (!isServerReady(document.document.sessionId, serverLanguageForEditor(document.document.language)!)) return null
  } else if (!languageServerReady(document.document.sessionId)) return null
  await flushCodeStudioDocument(document.document.id)
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
  const current = currentCodeStudioDocumentVersion(documentId)
  return current === null || current === version
}

export { navigateToLocation, type StudioLocation }

const MAX_PREVIEW_MODELS = 20
const previewModels: string[] = []

/**
 * Ctrl+hover shows the definition's code from a model at the location URI. Editor models carry the
 * session in the fragment and stdlib/module files have none, so Monaco failed with "Model not found":
 * read the target once (read-only, GOROOT/module cache allowed) and keep a small LRU of previews.
 */
export async function ensurePreviewModel(sessionId: string, location: GoIDEEditorLocation): Promise<void> {
  const uri = monaco.Uri.parse(editorModelUri({ uri: location.uri, sessionId }))
  if (monaco.editor.getModel(uri)) return
  try {
    const open = useCodeStudioStore.getState().documents.find((item) => item.document.sessionId === sessionId && (item.document.uri === location.uri || (item.document.relativePath === location.relativePath && !location.external)))
    let owner = open
    if (!owner) {
      const { openGoIDEDocument } = await import('@/lib/code-studio-api')
      const { openExternalDocument } = await import('@/lib/code-studio-lsp-api')
      const read = location.external || !location.relativePath ? await openExternalDocument(sessionId, location.path) : await openGoIDEDocument(sessionId, location.relativePath)
      owner = { ...read, buffer: read.content, savedContent: read.content, dirty: false, saving: false, saveError: null, externalState: null }
    }
    if (monaco.editor.getModel(uri)) return
    // Keep the tracked document alive: hover and definition inside a peek need its LSP identity too.
    previewDocuments.set(uri.toString(), owner)
    const model = monaco.editor.createModel(owner.buffer, owner.document.language, uri)
    const documentId = owner.document.id
    model.onWillDispose(() => {
      previewDocuments.delete(uri.toString())
      if (!useCodeStudioStore.getState().documents.some((item) => item.document.id === documentId)) {
        void import('@/lib/code-studio-api').then(({ closeGoIDEDocument }) => closeGoIDEDocument(sessionId, documentId)).catch(() => undefined)
      }
    })
    previewModels.push(uri.toString())
    while (previewModels.length > MAX_PREVIEW_MODELS) {
      const oldest = previewModels.shift()!
      if (!useCodeStudioStore.getState().documents.some((item) => editorModelUri(item.document) === oldest)) monaco.editor.getModel(monaco.Uri.parse(oldest))?.dispose()
    }
  } catch {
    // Navigation can still open the source even if no preview is available.
  }
}

export function rememberLocations(locations: readonly StudioLocation[], sessionId?: string): monaco.languages.Location[] {
  return locations.map((location) => {
    const uri = monaco.Uri.parse(sessionId ? editorModelUri({ uri: location.uri, sessionId }) : location.uri)
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
      if (model.getLanguageId() === 'java') {
        const owner = documentForModel(model)
        if (!owner || !isServerReady(owner.document.sessionId, 'java')) {
          const word = model.getWordUntilPosition(position)
          const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn }
          return { suggestions: completeLocalJava(model.getValue(), model.getOffsetAt(position)).map(item => ({
            label: item.label, detail: item.detail, insertText: item.insertText,
            kind: monaco.languages.CompletionItemKind[item.kind], range,
            insertTextRules: item.snippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
          })) }
        }
      }
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
      const owner = documentForModel(model)
      // go.mod: la definizione di una dipendenza e il suo sorgente (replace locale, progetto o
      // module cache), una scelta Go-specific che non passa da gopls.
      if (owner && isGoModDocument(owner)) {
        if (kind !== 'definition') return null
        const location = await goModDefinitionLocation(owner, position.lineNumber)
        return location ? rememberLocations([location]) : null
      }
      const prepared = await prepareDocument(model)
      if (!prepared) return null
      const locations = await cancellable(requestLocations(prepared.sessionId, prepared.documentId, kind, position.lineNumber, position.column), token)
      if (locations?.[0]) await ensurePreviewModel(prepared.sessionId, locations[0])
      return locations ? rememberLocations(locations, prepared.sessionId) : null
    },
  })
  const definition = locationProvider('definition')
  const typeDefinition = locationProvider('typeDefinition')
  monaco.languages.registerDefinitionProvider(LANGUAGE, { provideDefinition: definition.provide })
  monaco.languages.registerTypeDefinitionProvider(LANGUAGE, { provideTypeDefinition: typeDefinition.provide })

  monaco.languages.registerDocumentSymbolProvider(LANGUAGE, {
    async provideDocumentSymbols(model, token) {
      if (model.getLanguageId() === 'java') {
        const owner = documentForModel(model)
        if (!owner || !isServerReady(owner.document.sessionId, 'java')) return symbolTree(analyzeJavaFile(model.getValue()).symbols)
      }
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
    async provideCodeActions(model, range, context, token) {
      const prepared = await prepareDocument(model)
      if (!prepared) return { actions: [], dispose: () => undefined }
      // Refactor This e le scorciatoie chiedono solo la famiglia richiesta: meno lavoro per gopls.
      const only = context.only ? [context.only] : []
      const actions = await cancellable(requestCodeActions(prepared.sessionId, prepared.documentId, toEditorRange(range), only), token)
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

  // "Fix with AI" su errori e warning: usa il provider AI configurato in adOmnia e passa sempre
  // dall'anteprima delle modifiche. Compare solo se l'AI è attiva e verificata nelle Settings.
  monaco.languages.registerCodeActionProvider(LANGUAGE, {
    provideCodeActions(model, _range, context) {
      const document = documentForModel(model)
      const problems = context.markers.filter((marker) => marker.severity >= monaco.MarkerSeverity.Warning)
      if (!document || document.document.external || problems.length === 0 || !codeStudioAIFixAvailable()) return { actions: [], dispose: () => undefined }
      const all = monaco.editor.getModelMarkers({ resource: model.uri }).filter((marker) => marker.severity >= monaco.MarkerSeverity.Warning)
      return {
        actions: problems.map((marker) => ({
          title: `Fix with AI: ${marker.message.length > 60 ? `${marker.message.slice(0, 57)}…` : marker.message}`,
          kind: 'quickfix',
          diagnostics: [marker],
          command: { id: AI_FIX_COMMAND, title: 'Fix with AI', arguments: [document.document.relativePath, marker, all.filter((other) => other !== marker)] },
        })),
        dispose: () => undefined,
      }
    },
  }, { providedCodeActionKinds: ['quickfix'] })

  if (commandsRegistered) return
  commandsRegistered = true
  monaco.editor.registerCommand(AI_FIX_COMMAND, (_accessor, relativePath: string, marker: monaco.editor.IMarkerData, others: monaco.editor.IMarkerData[] = []) => {
    const problem = (item: monaco.editor.IMarkerData) => ({ message: item.message, line: item.startLineNumber, source: typeof item.source === 'string' ? item.source : undefined })
    void fixCodeStudioProblemWithAI(relativePath, problem(marker), others.map(problem))
  })

  monaco.editor.registerCommand(APPLY_CODE_ACTION_COMMAND, (_accessor, sessionId: string, actionId: string) => {
    void requestResolveCodeAction(sessionId, actionId)
      .then((change) => applyCodeStudioWorkspaceChange(change))
      .catch((error: unknown) => useCodeStudioStore.setState({ error: error instanceof Error ? error.message : String(error) }))
  })

  // Monaco standalone non sa aprire altri file: la navigazione passa dallo store di Code Studio.
  monaco.editor.registerEditorOpener({
    openCodeEditor(_source, resource, selectionOrPosition) {
      const cached = locationCache.get(resource.toString())
      const start = selectionOrPosition && 'startLineNumber' in selectionOrPosition
        ? { line: selectionOrPosition.startLineNumber, column: selectionOrPosition.startColumn }
        : { line: selectionOrPosition?.lineNumber ?? 1, column: selectionOrPosition?.column ?? 1 }
      const location: StudioLocation = cached
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
  return reportFor(useCodeStudioLspStore.getState().lint[sessionId]?.reports, uri)
}

/** gopls e linter usano owner distinti: ognuno aggiorna solo i propri marker. */
function applyMarkers(): void {
  // Ogni modello riceve solo la diagnostica della propria sessione: nessun marker attraversa i progetti.
  const state = useCodeStudioLspStore.getState()
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
export function registerCodeStudioLanguageFeatures(additionalLanguages?: string[]): void {
  LANGUAGE = (additionalLanguages ?? languageServerEditorLanguages()).filter(id => !registeredLanguages.has(id))
  if (!LANGUAGE.length) return
  LANGUAGE.forEach(id => registeredLanguages.add(id))
  registerProviders()
  if (registered) return
  registered = true
  applyMarkers()
  monaco.editor.onDidCreateModel(() => applyMarkers())
  useCodeStudioLspStore.subscribe((state, previous) => {
    if (state.diagnostics !== previous.diagnostics || state.lint !== previous.lint) applyMarkers()
  })
}
