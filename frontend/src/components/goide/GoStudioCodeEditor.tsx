import { installInlineDiagnostics } from './goStudioInlineDiagnostics'
import { attachEditorMode } from './goStudioEditorModes'
import { registerGoStudioSettingsJson } from './goStudioSettingsJson'
import { editorConfigWithProject } from '@/lib/goide/projectSettings'
import { useProjectSettings } from '@/stores/goideProjectSettings'
import { useGoStudioWhenStore } from '@/stores/goStudioWhenContext'
import { caretFor, rememberCaret } from '@/lib/goide/goStudioCaretMemory'
import { heavyFeatureEnabled } from './goStudioResourceMode'
import { releaseSleepingSessionModels, startGoStudioHibernation, useGoStudioHibernation } from './goStudioHibernation'
import { useGoIDENavigationStore } from '@/stores/goideNavigation'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import Editor, { type BeforeMount, type OnMount } from '@monaco-editor/react'
import { GO_STUDIO_THEMES, applyGoStudioMonacoThemes, configureMonacoLoader, monaco } from '@/lib/monacoSetup'
import { useGoIDEStore, type GoIDEEditorDocument } from '@/stores/goide'
import { useSettingsStore } from '@/stores/settings'
import { registerGoStudioEditor } from './goStudioEditorRegistry'
import { installGoStudioEditorActions } from './goStudioEditorActions'
import { installGoStudioAIActions } from './goStudioAIActionsRunner'
import { documentForModel, registerGoStudioLanguageFeatures } from './goStudioLanguageFeatures'
import { registerGoStudioCodeLens } from './goStudioCodeLens'
import { registerGoStudioProtoLens } from './goStudioProtoLens'
import { registerGoStudioRuntimeLens } from './goStudioRuntimeLens'
import { registerGoStudioCodeVision } from './goStudioCodeVision'
import { registerGoStudioCopilotCompletions } from './goStudioCopilotCompletions'
import { editorModelUri, releaseModelsOfClosedDocuments } from './goStudioModelUri'
import { installRecursiveCallMarkers, registerGoStudioSemanticFeatures } from './goStudioSemanticFeatures'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { useGoIDETestsStore, visibleCoverage } from '@/stores/goideTests'
import { coverageForDocument, coverageLineStates } from './goStudioCoverage'
import { useGoStudioProfileHeatDecorations } from './goStudioProfileHeat'
import { startGoStudioLspSync } from './goStudioLspSync'
import { useWebMonaco } from '@/components/ide/languages/web/useWebMonaco'
import { findRunTargets, runCommandFor, type GoStudioRunTarget, type GoStudioRunTargetHandler } from './goStudioRunTargets'
import { isToolTarget, toolTargetLabel } from './goStudioToolTargets'
import { indentationFor, useEditorConfig } from './goStudioEditorConfig'
import { recordCaretPosition, useGoStudioBookmarks } from './goStudioNavigationEditor'
import { openImplementationMarker, useGoStudioImplementationMarkers } from './goStudioImplementationMarkers'
import { useGoStudioContextMarkers } from './goStudioContextMarkers'
import { useGoStudioCommentTags } from './goStudioCommentTags'
import { openVcsHunk, useGoStudioVcsGutter } from './goStudioVcsEditor'
import { registerGoStudioExtraLanguages } from './goStudioExtraLanguages'
import { installBreakpointGutter, registerGoStudioDebugHover, useGoStudioDebugDecorations } from './goStudioDebugEditor'
import './goStudioEditor.css'
import { startGoStudioExtensions, installIDEExtensionActions } from './goStudioExtensions'
import { extensionLanguageForPath, useIDEExtensionsStore } from '@/stores/ideExtensions'
const GoStudioCollabBar = lazy(() => import('./GoStudioCollabBar'))

configureMonacoLoader()
registerGoStudioLanguageFeatures()
registerGoStudioCodeLens()
registerGoStudioProtoLens()
registerGoStudioRuntimeLens()
registerGoStudioCodeVision()
registerGoStudioCopilotCompletions()
registerGoStudioSemanticFeatures()
startGoStudioLspSync()
registerGoStudioDebugHover()
registerGoStudioExtraLanguages()
startGoStudioExtensions()
registerGoStudioSettingsJson()

const RUN_TARGET_DEBOUNCE_MS = 250

void releaseModelsOfClosedDocuments()
startGoStudioHibernation()

/**
 * Centers a position and keeps it centered while the editor settles: a jump from another panel shows
 * Code Studio in the same tick, when the editor is still a few pixels tall, and grows right after.
 * ponytail: a fixed 1 s settle window; tie it to the panel transition end if a slower one appears.
 */
function revealWhenSized(editor: monaco.editor.IStandaloneCodeEditor, position: { lineNumber: number; column: number }): void {
  const reveal = () => {
    const caret = editor.getPosition()
    if (caret && (caret.lineNumber !== position.lineNumber || caret.column !== position.column)) return
    // Explicit scroll: revealPositionInCenter is a no-op here while the panel is being shown.
    editor.setScrollTop(Math.max(0, editor.getTopForLineNumber(position.lineNumber) - editor.getLayoutInfo().height / 2))
    // A jump to a line start must show the indentation, not keep the old horizontal scroll.
    if (position.column <= 1) editor.setScrollLeft(0)
  }
  reveal()
  // The viewport takes the new size after this event: reveal on the next frame.
  const sub = editor.onDidLayoutChange(() => requestAnimationFrame(reveal))
  window.setTimeout(() => sub.dispose(), 1000)
}

export const beforeGoStudioMount: BeforeMount = (instance) => applyGoStudioMonacoThemes(instance)

export function useGoStudioEditorTheme(): string {
  return useSettingsStore((state) => state.settings.appearance.theme === 'light' ? GO_STUDIO_THEMES.light : GO_STUDIO_THEMES.dark)
}

interface GoStudioCodeEditorProps {
  document: GoIDEEditorDocument
  /** Solo l'editor principale gestisce le richieste di navigazione (reveal). */
  handlesReveal: boolean
  onCursor: (line: number, column: number) => void
  onRunTarget: GoStudioRunTargetHandler
}

/**
 * Editor Monaco di Code Studio. Pannello principale e split condividono il modello del file
 * (stesso URI) ma mantengono cursore, scroll e selezione indipendenti.
 */
export function GoStudioCodeEditor(props: GoStudioCodeEditorProps) {
  const sleeping = useGoStudioHibernation(state => !!state.sleeping[props.document.document.sessionId])
  // Each split keeps its own selection/scroll instead of sharing Monaco React's URI cache.
  const view = useRef<{ documentId: string; state: monaco.editor.ICodeEditorViewState | null } | null>(null)
  const sessionId = props.document.document.sessionId
  useEffect(() => {
    if (sleeping) releaseSleepingSessionModels(sessionId)
  }, [sleeping, sessionId])
  return sleeping ? null : <MountedGoStudioCodeEditor {...props} hibernationView={view} />
}

function MountedGoStudioCodeEditor({ document, handlesReveal, onCursor, onRunTarget, hibernationView }: GoStudioCodeEditorProps & {
  hibernationView: { current: { documentId: string; state: monaco.editor.ICodeEditorViewState | null } | null }
}) {
  const theme = useGoStudioEditorTheme()
  useWebMonaco(document.document.sessionId, document.document.language)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const decorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const coverageDecorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const runTargetsRef = useRef<GoStudioRunTarget[]>([])
  const callbacks = useRef({ onCursor, onRunTarget })
  callbacks.current = { onCursor, onRunTarget }
  const [mountCount, setMountCount] = useState(0)
  const updateDocument = useGoIDEStore((state) => state.updateDocument)
  const checkActiveDocument = useGoIDEStore((state) => state.checkActiveDocument)
  const revealLocation = useGoIDEStore((state) => state.revealLocation)
  const clearRevealLocation = useGoIDEStore((state) => state.clearRevealLocation)
  const semanticHighlighting = useGoIDELspStore((state) => heavyFeatureEnabled(state, 'semanticHighlighting'))
  const inlayHints = useGoIDELspStore((state) => heavyFeatureEnabled(state, 'inlayHints'))
  const stickyScrollPref = useGoIDELspStore((state) => heavyFeatureEnabled(state, 'stickyScroll'))
  const inlineDiagnostics = useGoIDELspStore(state => state.preferences.inlineDiagnostics)
  const inlineWarnings = useGoIDELspStore(state => state.preferences.inlineDiagnosticWarnings)
  const inlineInfo = useGoIDELspStore(state => state.preferences.inlineDiagnosticInfo)
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !inlineDiagnostics) return
    // Hints stay in the normal Monaco hover; inline severities are independently selectable.
    return installInlineDiagnostics(editor, [monaco.MarkerSeverity.Error, ...(inlineWarnings ? [monaco.MarkerSeverity.Warning] : []), ...(inlineInfo ? [monaco.MarkerSeverity.Info] : [])])
  }, [mountCount, inlineDiagnostics, inlineWarnings, inlineInfo])
  const fontLigaturesPref = useGoIDELspStore((state) => state.preferences.fontLigatures)
  const fontSizePref = useGoIDELspStore((state) => state.preferences.fontSize)
  const editorModePref = useGoIDELspStore((state) => state.preferences.editorMode)
  // `.adomnia/settings.json` del progetto vince sulle preferenze utente, chiave per chiave.
  const projectEditor = useProjectSettings(document.document.sessionId).settings.editor
  const stickyScroll = projectEditor.stickyScroll ?? stickyScrollPref
  const fontLigatures = projectEditor.fontLigatures ?? fontLigaturesPref
  const fontSize = projectEditor.fontSize ?? fontSizePref
  const editorMode = projectEditor.editorMode ?? editorModePref
  const modeStatusRef = useRef<HTMLDivElement | null>(null)
  const editorConfig = useEditorConfig(document.document.sessionId, document.document.relativePath)
  const extensions = useIDEExtensionsStore(state => state.items)
  const extensionLanguage = extensionLanguageForPath(document.document.relativePath,extensions)
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(preference.matches)
    update()
    preference.addEventListener('change', update)
    return () => preference.removeEventListener('change', update)
  }, [])

  const onMount: OnMount = (editor) => {
    editorRef.current = editor
    if (hibernationView.current?.documentId === document.document.id) {
      editor.restoreViewState(hibernationView.current.state)
    }
    const unregister = registerGoStudioEditor(editor)
    editor.onDidDispose(unregister)
    editor.onDidFocusEditorWidget(() => {
      registerGoStudioEditor(editor)
      const position = editor.getPosition()
      if (position) callbacks.current.onCursor(position.lineNumber, position.column)
    })
    installGoStudioEditorActions(editor)
    installIDEExtensionActions(editor)
    installGoStudioAIActions(editor)
    installRecursiveCallMarkers(editor)
    decorationsRef.current = editor.createDecorationsCollection()
    coverageDecorationsRef.current = editor.createDecorationsCollection()
    setMountCount((value) => value + 1)
    editor.onMouseDown((event) => {
      if (event.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS && event.target.position) {
        openVcsHunk(editor, event.target.position.lineNumber, { x: event.event.browserEvent.clientX, y: event.event.browserEvent.clientY })
        return
      }
      if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return
      const line = event.target.position?.lineNumber
      const anchor = { x: event.event.browserEvent.clientX, y: event.event.browserEvent.clientY }
      const model = editor.getModel()
      const sessionId = model ? documentForModel(model)?.document.sessionId : undefined
      if (line && sessionId && openImplementationMarker(editor, line, anchor, sessionId)) return
      const target = runTargetsRef.current.find((item) => item.line === line)
      if (target) callbacks.current.onRunTarget(target, anchor)
    })
    installBreakpointGutter(editor)
    editor.onDidChangeCursorPosition((event) => {
      callbacks.current.onCursor(event.position.lineNumber, event.position.column)
      // Anche i salti programmatici (Go to Declaration, cambio tab) entrano in cronologia: Back li ripercorre.
      recordCaretPosition(editor.getModel(), event.position)
      const caretModel = editor.getModel()
      const caretDocument = caretModel ? documentForModel(caretModel) : null
      if (caretDocument && !caretDocument.document.external) {
        rememberCaret(caretDocument.document.sessionId, caretDocument.document.relativePath, event.position.lineNumber, event.position.column, (id) => void useGoIDEStore.getState().persistSessionView(id))
      }
    })
    editor.onDidFocusEditorText(() => void checkActiveDocument())
    // Il documento si ricava dal modello che è cambiato, mai dal componente: durante il cambio file
    // @monaco-editor/react può notificare con la closure del file precedente e sporcarne il buffer.
    editor.onDidChangeModelContent((event) => {
      const model = editor.getModel()
      const changed = model ? documentForModel(model) : null
      if (!model || !changed || changed.document.readOnly) return
      const edited = event.changes[0]?.range
      if (edited && !changed.document.external && !event.isFlush) {
        useGoIDENavigationStore.getState().recordEdit(changed.document.sessionId, { relativePath: changed.document.relativePath, line: edited.startLineNumber, column: edited.startColumn })
      }
      const value = model.getValue()
      if (value !== changed.buffer) updateDocument(changed.document.id, value)
    })
  }

  useEffect(() => () => {
    const editor = editorRef.current
    const model = editor?.getModel()
    const current = model ? documentForModel(model) : null
    if (editor && current) hibernationView.current = { documentId: current.document.id, state: editor.saveViewState() }
  }, [hibernationView])

  useEffect(() => {
    if (!handlesReveal || revealLocation?.documentId !== document.document.id || !editorRef.current) return
    const position = { lineNumber: revealLocation.line, column: revealLocation.column }
    const editor = editorRef.current
    editor.setPosition(position)
    editor.focus()
    // No cleanup: clearing the location re-runs this effect and must not cancel the reveal.
    revealWhenSized(editor, position)
    clearRevealLocation()
  }, [clearRevealLocation, document.document.id, handlesReveal, revealLocation])

  // Ripristino dopo riavvio o crash: il file riapre dove era il cursore, se nessuno l'ha già spostato.
  useEffect(() => {
    const editor = editorRef.current
    const caret = caretFor(document.document.sessionId, document.document.relativePath)
    const position = editor?.getPosition()
    if (!editor || !caret || !position || position.lineNumber !== 1 || position.column !== 1) return
    const target = { lineNumber: caret.line, column: caret.column }
    editor.setPosition(target)
    revealWhenSized(editor, target)
  }, [document.document.id, document.document.relativePath, document.document.sessionId, mountCount])

  useGoStudioDebugDecorations(editorRef, document, mountCount)
  useGoStudioBookmarks(editorRef, document, mountCount)
  useGoStudioImplementationMarkers(editorRef, document, mountCount)
  useGoStudioContextMarkers(editorRef, document, mountCount)
  useGoStudioCommentTags(editorRef, document, mountCount)
  useGoStudioVcsGutter(editorRef, document, mountCount)
  useGoStudioProfileHeatDecorations(editorRef, document, mountCount)

  // Overlay di coverage: solo se il file è identico a quello misurato, altrimenti sparisce (e l'editor avvisa).
  const coverage = useGoIDETestsStore((state) => visibleCoverage(state, document.document.sessionId))
  useEffect(() => {
    const match = coverageForDocument(coverage, document.document.relativePath, document.diskToken, document.dirty)
    if (match.state !== 'current') return void coverageDecorationsRef.current?.clear()
    const decorations: monaco.editor.IModelDeltaDecoration[] = []
    for (const [line, state] of coverageLineStates(match.file)) {
      decorations.push({ range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 }, options: { linesDecorationsClassName: `go-studio-cov go-studio-cov-${state}`, isWholeLine: true } })
    }
    coverageDecorationsRef.current?.set(decorations)
  }, [coverage, document.diskToken, document.dirty, document.document.relativePath, mountCount])

  // ▶ nel gutter accanto a func main e ai test: ricalcolato con debounce mentre si scrive.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const targets = document.document.readOnly ? [] : findRunTargets(document.document.relativePath, document.buffer)
      runTargetsRef.current = targets
      decorationsRef.current?.set(targets.map((target) => ({
        range: { startLineNumber: target.line, startColumn: 1, endLineNumber: target.line, endColumn: 1 },
        options: {
          glyphMarginClassName: `go-studio-run-glyph${target.kind === 'main' || isToolTarget(target) ? '' : ' go-studio-test-glyph'}`,
          glyphMarginHoverMessage: { value: isToolTarget(target)
            ? `▶ ${toolTargetLabel(target)} · ${target.kind === 'docker' ? 'Build, Build & Run' : target.kind === 'compose' && !target.name ? 'Up, Down' : 'Run'} or save as configuration`
            : `▶ ${runCommandFor(target).label} · Run, Debug or Coverage` },
        },
      })))
    }, RUN_TARGET_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [document.buffer, document.document.id, document.document.readOnly, document.document.relativePath, mountCount])

  // Vim / Emacs opzionali: si agganciano all'editor montato e si staccano quando si torna al default.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || editorMode === 'default') return
    let detach: (() => void) | null = null
    let cancelled = false
    void attachEditorMode(editor, editorMode, modeStatusRef.current, (mode) => useGoStudioWhenStore.getState().setVimMode(mode)).then((dispose) => {
      if (cancelled) dispose()
      else detach = dispose
    }).catch((error) => useGoIDELspStore.setState({ message: `Could not start ${editorMode} mode: ${error instanceof Error ? error.message : String(error)}` }))
    return () => {
      cancelled = true
      detach?.()
    }
  }, [editorMode, mountCount])

  return (
    <div className="flex h-full min-h-0 flex-col">
    <Suspense fallback={null}><GoStudioCollabBar document={document} editor={editorRef.current} /></Suspense>
    <div className="min-h-0 flex-1">
    <Editor
      path={editorModelUri(document.document)}
      keepCurrentModel
      saveViewState
      language={extensionLanguage?.monaco || extensionLanguage?.id || document.document.language}
      value={document.buffer}
      theme={theme}
      beforeMount={beforeGoStudioMount}
      onMount={onMount}
      options={{
        automaticLayout: true,
        // Avoid forcing the text onto a separate composited layer: WebKitGTK
        // can rasterize it differently from normal browser text on that layer.
        disableLayerHinting: true,
        fontSize,
        lineHeight: Math.round(fontSize * 1.65),
        fontLigatures,
        stickyScroll: { enabled: stickyScroll, maxLineCount: 4 },
        fontFamily: 'var(--skin-font-mono, var(--font-mono))',
        // Panoramica a tutta altezza (fill), a blocchi leggibili (scala 2), con il riquadro della vista sempre visibile.
        minimap: { enabled: false },
        lineNumbers: projectEditor.lineNumbers ?? 'on',
        wordWrap: projectEditor.wordWrap ?? 'off',
        folding: true,
        // Parentesi monocromatiche come in IntelliJ: il colore resta alla sintassi, si evidenzia solo la coppia sotto il cursore.
        bracketPairColorization: { enabled: false },
        guides: { bracketPairs: false, indentation: true, highlightActiveIndentation: true },
        matchBrackets: 'always',
        scrollBeyondLastLine: false,
        // Monaco owns scrolling: its device classifier preserves continuous input.
        inertialScroll: !reducedMotion,
        smoothScrolling: !reducedMotion,
        cursorSmoothCaretAnimation: reducedMotion ? 'off' : 'on',
        cursorBlinking: reducedMotion ? 'solid' : 'smooth',
        renderLineHighlight: 'line',
        readOnly: !!document.document.readOnly,
        glyphMargin: true,
        lineDecorationsWidth: 16,
        // Scrollbar sottile con tacche discrete: le macchie colorate distraggono dal codice.
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
        overviewRulerBorder: false,
        hideCursorInOverviewRuler: true,
        codeLens: !document.document.readOnly,
        'semanticHighlighting.enabled': semanticHighlighting,
        inlayHints: { enabled: inlayHints ? 'on' : 'off', fontSize: 10, padding: true },
        occurrencesHighlight: 'singleFile',
        // Ghost text di Copilot: Tab accetta, Esc rifiuta, Alt+] / Alt+[ scorrono le alternative.
        inlineSuggest: { enabled: true, showToolbar: 'onHover', mode: 'subword' },
        codeLensFontSize: 11,
        codeLensFontFamily: 'var(--font-sans)',
        // Go, assembly e Makefile vogliono tab veri: una ricetta indentata a spazi rompe make.
        // Per gli altri file vale .editorconfig, e `.adomnia/settings.json` è il livello più esplicito.
        ...indentationFor(document.document.language, editorConfigWithProject(editorConfig, projectEditor)),
        padding: { top: 6, bottom: 6 },
      }}
    />
    </div>
    {/* Riga di stato di Vim (modo, comando in corso): esiste solo con la modalità Vim attiva. */}
    <div ref={modeStatusRef} aria-live="polite" className={editorMode === 'vim' ? 'h-5 shrink-0 border-t border-border-1 px-2 font-mono text-[10.5px] leading-5 text-text-3' : 'hidden'} />
    </div>
  )
}
