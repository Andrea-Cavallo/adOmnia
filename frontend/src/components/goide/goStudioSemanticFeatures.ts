import type { CancellablePromise } from '@wailsio/runtime'
import { monaco } from '@/lib/monacoSetup'
import {
  requestDocumentHighlights,
  requestHover,
  requestInlayHints,
  requestLocations,
  requestQuickDefinition,
  requestRecursiveCalls,
  requestSemanticTokens,
  type GoIDELanguageServerFeatures,
} from '@/lib/goide-lsp-api'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { currentGoStudioDocumentVersion } from './goStudioLspSync'
import { prepareDocument, toEditorRange, toMonacoRange } from './goStudioLanguageFeatures'
import { CLIENT_TOKEN_MODIFIERS, CLIENT_TOKEN_TYPES, isLiteralArgument, remapSemanticTokens, typeInfoFromHover } from './goStudioSemanticTokens'

const LANGUAGE = 'go'
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

function featuresFor(sessionId: string): GoIDELanguageServerFeatures | null {
  const status = useGoIDELspStore.getState().status[sessionId]
  return status?.state === 'ready' ? status.features ?? null : null
}

function isCurrent(documentId: string, version: number): boolean {
  const current = currentGoStudioDocumentVersion(documentId)
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

function registerSemanticTokens(): void {
  monaco.languages.registerDocumentSemanticTokensProvider(LANGUAGE, {
    onDidChange: semanticChanged.event,
    getLegend: () => ({ tokenTypes: [...CLIENT_TOKEN_TYPES], tokenModifiers: [...CLIENT_TOKEN_MODIFIERS] }),
    async provideDocumentSemanticTokens(model, _lastResultId, token) {
      if (!useGoIDELspStore.getState().preferences.semanticHighlighting) return null
      const prepared = await prepareDocument(model)
      const features = prepared ? featuresFor(prepared.sessionId) : null
      if (!prepared || !features?.semanticTokens) return null
      const result = await settle(requestSemanticTokens(prepared.sessionId, prepared.documentId), token).catch(() => { throw cancelled() })
      if (!isCurrent(prepared.documentId, result.version)) throw cancelled()
      return { data: remapSemanticTokens(result.data, features.tokenTypes, features.tokenModifiers) }
    },
    releaseDocumentSemanticTokens: () => undefined,
  })
}

function registerInlayHints(): void {
  monaco.languages.registerInlayHintsProvider(LANGUAGE, {
    onDidChangeInlayHints: inlayChanged.event,
    async provideInlayHints(model, range, token) {
      const empty = { hints: [], dispose: () => undefined }
      if (!useGoIDELspStore.getState().preferences.inlayHints) return empty
      const prepared = await prepareDocument(model)
      if (!prepared || !featuresFor(prepared.sessionId)?.inlayHints) return empty
      const result = await settle(requestInlayHints(prepared.sessionId, prepared.documentId, toEditorRange(range)), token).catch(() => { throw cancelled() })
      if (!isCurrent(prepared.documentId, result.version)) throw cancelled()
      const hints = result.hints
        .filter((hint) => hint.kind !== INLAY_PARAMETER || (hint.line <= model.getLineCount() && isLiteralArgument(model.getLineContent(hint.line), hint.column)))
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
      if (!prepared || !featuresFor(prepared.sessionId)?.documentHighlight) return null
      const result = await settle(requestDocumentHighlights(prepared.sessionId, prepared.documentId, position.lineNumber, position.column), token).catch(() => null)
      if (!result || !isCurrent(prepared.documentId, result.version)) return null
      return result.highlights.map((highlight) => ({ range: toMonacoRange(highlight.range), kind: HIGHLIGHT_KINDS[highlight.kind] ?? HIGHLIGHT_KINDS.text }))
    },
  })
}

/** Registra una sola volta semantic tokens, inlay hints ed evidenziazione delle occorrenze/punti di uscita. */
export function registerGoStudioSemanticFeatures(): void {
  if (registered) return
  registered = true
  registerSemanticTokens()
  registerInlayHints()
  registerDocumentHighlights()
  useGoIDELspStore.subscribe((state, previous) => {
    const preferencesChanged = state.preferences.semanticHighlighting !== previous.preferences.semanticHighlighting || state.preferences.inlayHints !== previous.preferences.inlayHints
    if (state.status !== previous.status || preferencesChanged) {
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
    inFlight?.cancel()
    const model = editor.getModel()
    const prepared = model ? await prepareDocument(model) : null
    if (!prepared || !featuresFor(prepared.sessionId)?.callHierarchy || prepared.document.document.readOnly) return decorations.clear()
    const request = requestRecursiveCalls(prepared.sessionId, prepared.documentId)
    inFlight = request
    const result = await request.catch(() => null)
    if (!result || !isCurrent(prepared.documentId, result.version) || editor.getModel() !== model) return
    decorations.set(result.calls.map((call) => ({
      range: toMonacoRange(call.range),
      options: {
        glyphMarginClassName: 'go-studio-recursive-glyph',
        glyphMarginHoverMessage: { value: `Recursive call of \`${call.function}\`` },
        inlineClassName: 'go-studio-recursive-call',
      },
    })))
  }
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void refresh(), RECURSION_DEBOUNCE_MS)
  }
  editor.onDidChangeModel(schedule)
  editor.onDidChangeModelContent(schedule)
  const unsubscribe = useGoIDELspStore.subscribe((state, previous) => { if (state.status !== previous.status) schedule() })
  editor.onDidDispose(() => {
    if (timer) clearTimeout(timer)
    inFlight?.cancel()
    unsubscribe()
  })
  schedule()
}

function report(message: string): void {
  useGoIDELspStore.setState({ message })
}

function caretAnchor(editor: monaco.editor.ICodeEditor): { x: number; y: number } | null {
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
    useGoIDELspStore.getState().showCaretPopup({ kind: 'definition', anchor, result })
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
    useGoIDELspStore.getState().showCaretPopup({ kind: 'usages', anchor, sessionId: context.prepared.sessionId, title: `Usages of ${word}`, locations })
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
