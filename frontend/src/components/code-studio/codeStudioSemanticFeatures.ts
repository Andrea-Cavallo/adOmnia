import { featuresForEditor } from './codeStudioServerFeatures'
import { importColorRanges } from './codeStudioImportColors'
import { useIdeLanguageServersStore } from '@/stores/ideLanguageServers'
import { heavyFeatureEditorLanguages, semanticTokenEditorLanguages } from '@/components/ide/languages'
import { heavyFeatureEnabled } from './codeStudioResourceMode'
import type { CancellablePromise } from '@wailsio/runtime'
import { monaco } from '@/lib/monacoSetup'
import {
  requestDocumentHighlights,
  requestHover,
  requestInlayHints,
  requestLocations,
  requestQuickDefinition,
  requestPrepareHierarchy,
  requestRecursiveCalls,
  requestSemanticTokens,
} from '@/lib/code-studio-lsp-api'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { currentCodeStudioDocumentVersion } from './codeStudioLspSync'
import { prepareDocument, toEditorRange, toMonacoRange } from './codeStudioLanguageFeatures'
import { CLIENT_TOKEN_MODIFIERS, CLIENT_TOKEN_TYPES, isLiteralArgument, remapSemanticTokens, type SemanticRemapContext, semanticRetryDelay, typeInfoFromHover } from './codeStudioSemanticTokens'

// Provider LSP generici: valgono per ogni linguaggio servito da un language server.
const LANGUAGE = heavyFeatureEditorLanguages()
const INLAY_PARAMETER = 2
const RECURSION_DEBOUNCE_MS = 800

let registered = false
const semanticChanged = new monaco.Emitter<void>()
const inlayChanged = new monaco.Emitter<void>()

/** Errore riconosciuto da Monaco come annullamento: conserva i token precedenti invece di azzerarli (niente flicker). */
function cancelled(): Error {
  const error = new Error('Canceled')
  error.name = 'Canceled'
  return error
}

function isCurrent(documentId: string, version: number): boolean {
  const current = currentCodeStudioDocumentVersion(documentId)
  return current === null || current === version
}

async function settle<T>(request: CancellablePromise<T>, token: monaco.CancellationToken): Promise<T> {
  const subscription = token.onCancellationRequested(() => request.cancel())
  try {
    const result = await request
    if (token.isCancellationRequested) throw cancelled()
    return result
  } finally {
    subscription.dispose()
  }
}

const WORK_REFRESH_MS = 5_000
let lastWorkRefresh = 0

/** Tentativi falliti per documento: si azzerano al primo successo. */
const semanticFailures = new Map<string, number>()
let semanticRetryTimer: ReturnType<typeof setTimeout> | null = null

/**
 * gopls può fallire o andare in timeout mentre carica i pacchetti di un progetto grande. Monaco non
 * richiede più i token di un modello finché non cambia: senza un nuovo tentativo quel file restava
 * senza colori semantici (funzioni e tipi bianchi) mentre i file aperti dopo si coloravano.
 */
function scheduleSemanticRetry(documentId: string): void {
  const attempt = semanticFailures.get(documentId) ?? 0
  const delay = semanticRetryDelay(attempt)
  if (delay === null) return
  semanticFailures.set(documentId, attempt + 1)
  if (semanticRetryTimer) return
  semanticRetryTimer = setTimeout(() => {
    semanticRetryTimer = null
    semanticChanged.fire()
  }, delay)
}

/** Java: `@Nome` è sempre un'annotazione (JDT LS la tipa a volte come interfaccia) e le variabili hanno il loro colore. */
function semanticContextFor(model: monaco.editor.ITextModel): SemanticRemapContext {
  const importRanges = importColorRanges(model.getValue(), model.getLanguageId())
  if (model.getLanguageId() !== 'java') return { importRanges }
  return {
    importRanges,
    isAnnotationAt: (line, start) => start > 0 && line < model.getLineCount() && model.getLineContent(line + 1).charAt(start - 1) === '@',
    variableType: 'javaVariable',
  }
}

function registerSemanticTokens(): void {
  monaco.languages.registerDocumentSemanticTokensProvider(semanticTokenEditorLanguages(), {
    onDidChange: semanticChanged.event,
    getLegend: () => ({ tokenTypes: [...CLIENT_TOKEN_TYPES], tokenModifiers: [...CLIENT_TOKEN_MODIFIERS] }),
    async provideDocumentSemanticTokens(model, _lastResultId, token) {
      if (!heavyFeatureEnabled(useCodeStudioLspStore.getState(), 'semanticHighlighting')) return null
      const prepared = await prepareDocument(model)
      const features = prepared ? featuresForEditor(prepared.sessionId, prepared.document.document.language) : null
      if (!prepared || !features?.semanticTokens) return null
      const result = await settle(requestSemanticTokens(prepared.sessionId, prepared.documentId), token).catch(() => {
        if (!token.isCancellationRequested) scheduleSemanticRetry(prepared.documentId)
        throw cancelled()
      })
      if (!isCurrent(prepared.documentId, result.version)) throw cancelled()
      // Un server che sta ancora importando il progetto (JDT LS) risponde senza token: si riprova invece di lasciare il file bianco.
      if (result.data.length === 0 && model.getLineCount() > 3) scheduleSemanticRetry(prepared.documentId)
      else semanticFailures.delete(prepared.documentId)
      return { data: remapSemanticTokens(result.data, features.tokenTypes, features.tokenModifiers, semanticContextFor(model)) }
    },
    releaseDocumentSemanticTokens: () => undefined,
  })
}

function registerInlayHints(): void {
  monaco.languages.registerInlayHintsProvider(LANGUAGE, {
    onDidChangeInlayHints: inlayChanged.event,
    async provideInlayHints(model, range, token) {
      const empty = { hints: [], dispose: () => undefined }
      if (!heavyFeatureEnabled(useCodeStudioLspStore.getState(), 'inlayHints')) return empty
      const prepared = await prepareDocument(model)
      if (!prepared || !featuresForEditor(prepared.sessionId, prepared.document.document.language)?.inlayHints) return empty
      const result = await settle(requestInlayHints(prepared.sessionId, prepared.documentId, toEditorRange(range)), token).catch(() => { throw cancelled() })
      if (!isCurrent(prepared.documentId, result.version)) throw cancelled()
      const hints = result.hints
        .filter((hint) => hint.kind !== INLAY_PARAMETER || (hint.line <= model.getLineCount() && isLiteralArgument(model.getLineContent(hint.line), hint.column)))
        .filter((hint) => hint.kind === INLAY_PARAMETER || showTypeHint(hint.label))
        .map((hint) => ({
          position: { lineNumber: hint.line, column: hint.column },
          label: hint.label,
          kind: hint.kind === INLAY_PARAMETER ? monaco.languages.InlayHintKind.Parameter : monaco.languages.InlayHintKind.Type,
          paddingLeft: hint.paddingLeft,
          paddingRight: hint.paddingRight,
        }))
      return { hints, dispose: () => undefined }
    },
  })
}

const HIGHLIGHT_KINDS: Record<string, monaco.languages.DocumentHighlightKind> = {
  read: monaco.languages.DocumentHighlightKind.Read,
  write: monaco.languages.DocumentHighlightKind.Write,
  text: monaco.languages.DocumentHighlightKind.Text,
}

function registerDocumentHighlights(): void {
  monaco.languages.registerDocumentHighlightProvider(LANGUAGE, {
    async provideDocumentHighlights(model, position, token) {
      const prepared = await prepareDocument(model)
      if (!prepared || !featuresForEditor(prepared.sessionId, prepared.document.document.language)?.documentHighlight) return null
      const result = await settle(requestDocumentHighlights(prepared.sessionId, prepared.documentId, position.lineNumber, position.column), token).catch(() => null)
      if (!result || !isCurrent(prepared.documentId, result.version)) return null
      return result.highlights.map((highlight) => ({ range: toMonacoRange(highlight.range), kind: HIGHLIGHT_KINDS[highlight.kind] ?? HIGHLIGHT_KINDS.text }))
    },
  })
}

/** Registra una sola volta semantic tokens, inlay hints ed evidenziazione delle occorrenze/punti di uscita. */
/**
 * I type parameter dedotti (`[int]`) restano sempre visibili con gli inlay hint; gli altri
 * suggerimenti di tipo (` int` dopo :=/range, tipi dei composite literal, `= 3` delle costanti)
 * solo con la preferenza Type Hints. gopls li invia tutti come InlayHintKind.Type.
 */
export function showTypeHint(label: string): boolean {
  return label.trimStart().startsWith('[') || heavyFeatureEnabled(useCodeStudioLspStore.getState(), 'typeHints')
}

export function registerCodeStudioSemanticFeatures(): void {
  if (registered) return
  registered = true
  registerSemanticTokens()
  registerInlayHints()
  registerDocumentHighlights()
  useIdeLanguageServersStore.subscribe((state, previous) => {
    if (state.servers !== previous.servers) { semanticFailures.clear(); semanticChanged.fire(); inlayChanged.fire() }
  })
  useCodeStudioLspStore.subscribe((state, previous) => {
    const preferencesChanged = state.preferences.semanticHighlighting !== previous.preferences.semanticHighlighting || state.preferences.inlayHints !== previous.preferences.inlayHints
      || state.preferences.typeHints !== previous.preferences.typeHints
      || state.preferences.resourceMode !== previous.preferences.resourceMode || state.onBattery !== previous.onBattery
    // Fine di un lavoro di gopls (caricamento pacchetti, indicizzazione): ora può rispondere per tutti i file.
    // Al massimo un aggiornamento ogni WORK_REFRESH_MS: se una richiesta facesse ripartire un lavoro di gopls,
    // il suo `end` non deve innescare un ciclo di richieste.
    const workFinished = Object.keys(previous.progress).some((sessionId) => previous.progress[sessionId] && !state.progress[sessionId])
      && Date.now() - lastWorkRefresh >= WORK_REFRESH_MS
    if (workFinished) {
      lastWorkRefresh = Date.now()
      semanticFailures.clear()
    }
    if (state.status !== previous.status || preferencesChanged || workFinished) {
      semanticChanged.fire()
      inlayChanged.fire()
    }
  })
}

/**
 * Marca nel gutter le chiamate ricorsive dirette, ricavate da call hierarchy di gopls.
 * Si aggiorna con debounce durante la digitazione e scarta risposte di versioni superate.
 */
export function installRecursiveCallMarkers(editor: monaco.editor.IStandaloneCodeEditor): void {
  const decorations = editor.createDecorationsCollection()
  let timer: ReturnType<typeof setTimeout> | null = null
  let inFlight: CancellablePromise<unknown> | null = null
  const refresh = async () => {
    void inFlight?.cancel()
    const model = editor.getModel()
    const prepared = model ? await prepareDocument(model) : null
    if (!prepared || !featuresForEditor(prepared.sessionId, prepared.document.document.language)?.callHierarchy || prepared.document.document.readOnly) return decorations.clear()
    const request = requestRecursiveCalls(prepared.sessionId, prepared.documentId)
    inFlight = request
    const result = await request.catch(() => null)
    if (!result || !isCurrent(prepared.documentId, result.version) || editor.getModel() !== model) return
    decorations.set(result.calls.map((call) => ({
      range: toMonacoRange(call.range),
      options: {
        glyphMarginClassName: 'code-studio-recursive-glyph',
        glyphMarginHoverMessage: { value: `Recursive call of \`${call.function}\`` },
        inlineClassName: 'code-studio-recursive-call',
      },
    })))
  }
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void refresh(), RECURSION_DEBOUNCE_MS)
  }
  editor.onDidChangeModel(schedule)
  editor.onDidChangeModelContent(schedule)
  const unsubscribe = useCodeStudioLspStore.subscribe((state, previous) => { if (state.status !== previous.status) schedule() })
  editor.onDidDispose(() => {
    if (timer) clearTimeout(timer)
    void inFlight?.cancel()
    unsubscribe()
  })
  schedule()
}

function report(message: string): void {
  useCodeStudioLspStore.setState({ message })
}

export function caretAnchor(editor: monaco.editor.ICodeEditor): { x: number; y: number } | null {
  const position = editor.getPosition()
  const node = editor.getDomNode()
  const visible = position ? editor.getScrolledVisiblePosition(position) : null
  if (!node || !visible) return null
  const rect = node.getBoundingClientRect()
  return { x: rect.left + visible.left, y: rect.top + visible.top + visible.height }
}

async function caretContext(editor: monaco.editor.ICodeEditor) {
  const model = editor.getModel()
  const position = editor.getPosition()
  const prepared = model ? await prepareDocument(model) : null
  if (!model || !position || !prepared) {
    report('gopls is not ready for this file yet.')
    return null
  }
  return { model, position, prepared }
}

/** Quick Definition: sorgente della dichiarazione in un popup, senza lasciare il file. */
export async function showQuickDefinition(editor: monaco.editor.ICodeEditor): Promise<void> {
  const context = await caretContext(editor)
  if (!context) return
  try {
    const result = await requestQuickDefinition(context.prepared.sessionId, context.prepared.documentId, context.position.lineNumber, context.position.column)
    const anchor = caretAnchor(editor)
    if (!result.found || !anchor) return report('Quick Definition: no declaration found here.')
    useCodeStudioLspStore.getState().showCaretPopup({ kind: 'definition', anchor, result })
  } catch (error) {
    report(error instanceof Error ? error.message : String(error))
  }
}

/** Show Usages: utilizzi raggruppati per tipo in un popup accanto al cursore. */
export async function showUsagesPopup(editor: monaco.editor.ICodeEditor): Promise<void> {
  const context = await caretContext(editor)
  if (!context) return
  const word = context.model.getWordAtPosition(context.position)?.word ?? 'symbol'
  try {
    const locations = await requestLocations(context.prepared.sessionId, context.prepared.documentId, 'references', context.position.lineNumber, context.position.column)
    const anchor = caretAnchor(editor)
    if (locations.length === 0 || !anchor) return report(`No usages of ${word} found.`)
    useCodeStudioLspStore.getState().showCaretPopup({ kind: 'usages', anchor, sessionId: context.prepared.sessionId, title: `Usages of ${word}`, locations })
  } catch (error) {
    report(error instanceof Error ? error.message : String(error))
  }
}

interface MessageController {
  showMessage(message: string, position: monaco.IPosition): void
}

/** Type Info: mostra accanto al cursore il tipo dell'espressione, ricavato dalla hover di gopls. */
export async function showTypeInfo(editor: monaco.editor.ICodeEditor): Promise<void> {
  const context = await caretContext(editor)
  if (!context) return
  try {
    const hover = await requestHover(context.prepared.sessionId, context.prepared.documentId, context.position.lineNumber, context.position.column)
    const info = typeInfoFromHover(hover.markdown ?? '')
    if (!info) return report('Type Info: no type information at the caret.')
    const controller = editor.getContribution('editor.contrib.messageController') as unknown as MessageController | null
    if (controller) controller.showMessage(info, context.position)
    else report(info)
  } catch (error) {
    report(error instanceof Error ? error.message : String(error))
  }
}

/** Call Hierarchy / Type Hierarchy sul simbolo al cursore. */
export async function showHierarchy(editor: monaco.editor.ICodeEditor, kind: 'call' | 'type'): Promise<void> {
  const context = await caretContext(editor)
  if (!context) return
  const label = kind === 'call' ? 'Call Hierarchy' : 'Type Hierarchy'
  try {
    const roots = await requestPrepareHierarchy(context.prepared.sessionId, context.prepared.documentId, kind, context.position.lineNumber, context.position.column)
    if (roots.length === 0) return report(`${label}: put the caret on a ${kind === 'call' ? 'function or method' : 'type or interface'}.`)
    useCodeStudioLspStore.setState({ hierarchy: { sessionId: context.prepared.sessionId, kind, root: roots[0], anchor: caretAnchor(editor) ?? undefined } })
  } catch (error) {
    report(`${label}: ${error instanceof Error ? error.message : String(error)}`)
  }
}
