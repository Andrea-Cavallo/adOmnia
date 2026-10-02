import * as GoIDEBindings from '../../bindings/adomnia/goide'
import type { CancellablePromise } from '@wailsio/runtime'
import type {
  CodeActionEntry,
  ImplementationMarker,
  CompletionResult,
  DocumentSymbolsResult,
  EditorLocation,
  EditorRange,
  EditorTextEdit,
  FileChange,
  FormatResult,
  GoplsInfo,
  HoverResult,
  LanguageServerSettings,
  LanguageServerStatus,
  OpenDocument,
  RenameTarget,
  SearchMatch,
  SearchQuery,
  SearchResult,
  SignatureResult,
  SymbolNode,
  WorkspaceChange,
  WorkspaceSymbol,
  Execution,
  LintResult,
  LinterInfo,
  SemanticTokensResult,
  InlayHintsResult,
  HighlightsResult,
  RecursiveCallsResult,
  LanguageServerFeatures,
  QuickDefinitionResult, HierarchyItem } from '../../bindings/adomnia/internal/goide/models'

export type GoIDELanguageServerStatus = LanguageServerStatus
export type GoIDELanguageServerFeatures = LanguageServerFeatures
export type GoIDEInlayHintsResult = InlayHintsResult
export type GoIDEHighlightsResult = HighlightsResult
export type GoIDEQuickDefinition = QuickDefinitionResult
export type GoIDELanguageServerSettings = LanguageServerSettings
export type GoIDEGoplsInfo = GoplsInfo
export type GoIDEEditorRange = EditorRange
export type GoIDEEditorTextEdit = EditorTextEdit
export type GoIDEEditorLocation = EditorLocation
export type GoIDESymbolNode = SymbolNode
export type GoIDEWorkspaceSymbol = WorkspaceSymbol
export type GoIDEWorkspaceChange = WorkspaceChange
export type GoIDEFileChange = FileChange
export type GoIDECodeAction = CodeActionEntry
export type GoIDESearchQuery = SearchQuery
export type GoIDELinterInfo = LinterInfo
export type GoIDELintResult = LintResult
export type GoIDELinterKind = 'golangci-lint' | 'staticcheck'
export type GoIDESearchMatch = SearchMatch
export type GoIDESearchResult = SearchResult
/** Payload dell'evento `lsp.diagnostics` (goide.DiagnosticsReport). */
export interface GoIDEDiagnostic {
  range: EditorRange
  severity: number
  message: string
  source?: string
  code?: string
  /** Solo linter: direttiva ufficiale per ignorare la riga (//nolint:x o //lint:ignore). */
  suppression?: string
  /** Solo linter: correzioni proposte, valide sul file così come è stato analizzato. */
  fixes?: Array<{ title: string; edits: EditorTextEdit[] }>
}

export interface GoIDEDiagnosticsReport {
  uri: string
  path: string
  relativePath?: string
  documentId?: string
  diagnostics: GoIDEDiagnostic[]
}

/** Payload dell'evento `lsp.progress` (goide.LanguageServerProgress). */
export interface GoIDELanguageServerProgress {
  token: string
  kind: 'begin' | 'report' | 'end'
  title?: string
  message?: string
  percentage?: number
}

export type GoIDELocationKind = 'definition' | 'typeDefinition' | 'implementation' | 'references'

// Gestione del language server: promise normali.
export async function detectGopls(sessionId: string): Promise<GoplsInfo> {
  return GoIDEBindings.DetectGopls(sessionId)
}

export async function configureGopls(sessionId: string, binary: string): Promise<void> {
  await GoIDEBindings.ConfigureGopls(sessionId, binary)
}

export async function installGopls(sessionId: string): Promise<Execution> {
  return GoIDEBindings.InstallGopls(sessionId, true)
}

export async function startLanguageServer(sessionId: string, settings: LanguageServerSettings): Promise<LanguageServerStatus> {
  return GoIDEBindings.StartLanguageServer(sessionId, settings)
}

export async function restartLanguageServer(sessionId: string, settings: LanguageServerSettings): Promise<LanguageServerStatus> {
  return GoIDEBindings.RestartLanguageServer(sessionId, settings)
}

export async function stopLanguageServer(sessionId: string): Promise<void> {
  await GoIDEBindings.StopLanguageServer(sessionId)
}

export async function getLanguageServerStatus(sessionId: string): Promise<LanguageServerStatus> {
  return GoIDEBindings.GetLanguageServerStatus(sessionId)
}

export async function getLanguageServerLog(sessionId: string): Promise<string[]> {
  return GoIDEBindings.GetLanguageServerLog(sessionId)
}

export async function updateDocumentBuffer(sessionId: string, documentId: string, version: number, text: string): Promise<void> {
  await GoIDEBindings.UpdateDocumentBuffer(sessionId, documentId, version, text)
}

export async function openExternalDocument(sessionId: string, path: string): Promise<OpenDocument> {
  return GoIDEBindings.OpenExternalDocument(sessionId, path)
}

export async function detectLinter(sessionId: string): Promise<LinterInfo> {
  return GoIDEBindings.DetectLinter(sessionId)
}

export async function configureLinter(sessionId: string, binary: string): Promise<void> {
  await GoIDEBindings.ConfigureLinter(sessionId, binary)
}

export async function installLinter(sessionId: string, kind: GoIDELinterKind): Promise<Execution> {
  return GoIDEBindings.InstallLinter(sessionId, kind, true)
}

/** changedOnly: solo i package dei file Go modificati (git status), riportando solo quei file. */
export function requestLint(sessionId: string, changedOnly = false): CancellablePromise<LintResult> {
  return changedOnly ? GoIDEBindings.RunLintChanged(sessionId) : GoIDEBindings.RunLint(sessionId)
}

// Richieste semantiche: restituiscono la CancellablePromise del binding, così cancel() annulla il ctx Go e gopls.
export function requestCompletion(sessionId: string, documentId: string, line: number, column: number): CancellablePromise<CompletionResult> {
  return GoIDEBindings.Completion(sessionId, documentId, line, column)
}

export function requestHover(sessionId: string, documentId: string, line: number, column: number): CancellablePromise<HoverResult> {
  return GoIDEBindings.Hover(sessionId, documentId, line, column)
}

export function requestSignatureHelp(sessionId: string, documentId: string, line: number, column: number): CancellablePromise<SignatureResult> {
  return GoIDEBindings.SignatureHelp(sessionId, documentId, line, column)
}

export function requestLocations(sessionId: string, documentId: string, kind: GoIDELocationKind, line: number, column: number): CancellablePromise<EditorLocation[]> {
  return GoIDEBindings.Locations(sessionId, documentId, kind, line, column)
}

export function requestDocumentSymbols(sessionId: string, documentId: string): CancellablePromise<DocumentSymbolsResult> {
  return GoIDEBindings.DocumentSymbols(sessionId, documentId)
}

export function requestWorkspaceSymbols(sessionId: string, query: string): CancellablePromise<WorkspaceSymbol[]> {
  return GoIDEBindings.WorkspaceSymbols(sessionId, query)
}

export function requestPrepareRename(sessionId: string, documentId: string, line: number, column: number): CancellablePromise<RenameTarget> {
  return GoIDEBindings.PrepareRename(sessionId, documentId, line, column)
}

export function requestRename(sessionId: string, documentId: string, line: number, column: number, newName: string): CancellablePromise<WorkspaceChange> {
  return GoIDEBindings.Rename(sessionId, documentId, line, column, newName)
}

export function requestFormatting(sessionId: string, documentId: string): CancellablePromise<FormatResult> {
  return GoIDEBindings.FormatDocument(sessionId, documentId)
}

export type GoIDEImplementationMarker = ImplementationMarker

export function requestImplementationMarkers(sessionId: string, documentId: string): CancellablePromise<ImplementationMarker[]> {
  return GoIDEBindings.ImplementationMarkers(sessionId, documentId)
}

export function requestCodeActions(sessionId: string, documentId: string, selection: EditorRange, only: string[] = []): CancellablePromise<CodeActionEntry[]> {
  return GoIDEBindings.CodeActions(sessionId, documentId, selection, only)
}

/** Riordina o rimuove parametri e risultati (indici dei campi attuali) di firma e chiamate; restituisce l'anteprima. */
export function requestChangeSignature(sessionId: string, documentId: string, caret: EditorRange, params: number[], results: number[]): CancellablePromise<WorkspaceChange> {
  return GoIDEBindings.ChangeSignature(sessionId, documentId, caret, params, results)
}

export function requestResolveCodeAction(sessionId: string, actionId: string): CancellablePromise<WorkspaceChange> {
  return GoIDEBindings.ResolveCodeAction(sessionId, actionId)
}

export function requestOrganizeImports(sessionId: string, documentId: string): CancellablePromise<WorkspaceChange> {
  return GoIDEBindings.OrganizeImports(sessionId, documentId)
}

export function requestProjectSearch(query: SearchQuery): CancellablePromise<SearchResult> {
  return GoIDEBindings.SearchProject(query)
}

export function requestSemanticTokens(sessionId: string, documentId: string): CancellablePromise<SemanticTokensResult> {
  return GoIDEBindings.SemanticTokens(sessionId, documentId)
}

export function requestInlayHints(sessionId: string, documentId: string, visible: EditorRange): CancellablePromise<InlayHintsResult> {
  return GoIDEBindings.InlayHints(sessionId, documentId, visible)
}

export function requestDocumentHighlights(sessionId: string, documentId: string, line: number, column: number): CancellablePromise<HighlightsResult> {
  return GoIDEBindings.DocumentHighlights(sessionId, documentId, line, column)
}

export function requestRecursiveCalls(sessionId: string, documentId: string): CancellablePromise<RecursiveCallsResult> {
  return GoIDEBindings.RecursiveCalls(sessionId, documentId)
}

export function requestQuickDefinition(sessionId: string, documentId: string, line: number, column: number): CancellablePromise<QuickDefinitionResult> {
  return GoIDEBindings.QuickDefinition(sessionId, documentId, line, column)
}

export type GoIDEHierarchyItem = HierarchyItem

/** Call Hierarchy ("call") o Type Hierarchy ("type") sul simbolo alla posizione indicata. */
export function requestPrepareHierarchy(sessionId: string, documentId: string, kind: 'call' | 'type', line: number, column: number): CancellablePromise<HierarchyItem[]> {
  return GoIDEBindings.PrepareHierarchy(sessionId, documentId, kind, line, column)
}

/** Figli di un nodo: incoming/outgoing per le chiamate, supertypes/subtypes per i tipi. */
export function requestExpandHierarchy(sessionId: string, direction: string, token: string): CancellablePromise<HierarchyItem[]> {
  return GoIDEBindings.ExpandHierarchy(sessionId, direction, token)
}
