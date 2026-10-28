import { installSymbolOriginCopy } from './codeStudioSymbolOriginEditor'
import { installInlineDiagnostics } from './codeStudioInlineDiagnostics'
import { attachEditorMode } from './codeStudioEditorModes'
import { CodeStudioEditorModeNotice } from './CodeStudioEditorModeNotice'
import { registerCodeStudioSettingsJson } from './codeStudioSettingsJson'
import { editorConfigWithProject } from '@/lib/code-studio/projectSettings'
import { useProjectSettings } from '@/stores/codeStudioProjectSettings'
import { useCodeStudioWhenStore } from '@/stores/codeStudioWhenContext'
import { caretFor, rememberCaret } from '@/lib/code-studio/codeStudioCaretMemory'
import { heavyFeatureEnabled } from './codeStudioResourceMode'
import { releaseSleepingSessionModels, startCodeStudioHibernation, useCodeStudioHibernation } from './codeStudioHibernation'
import { useCodeStudioNavigationStore } from '@/stores/codeStudioNavigation'
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Editor, type BeforeMount, type OnMount } from '@monaco-editor/react'
import { CODE_STUDIO_THEMES, applyCodeStudioMonacoThemes, configureMonacoLoader, monaco } from '@/lib/monacoSetup'
import { useCodeStudioStore, type GoIDEEditorDocument } from '@/stores/codeStudio'
import { useSettingsStore } from '@/stores/settings'
import { registerCodeStudioEditor } from './codeStudioEditorRegistry'
import { installCodeStudioEditorActions } from './codeStudioEditorActions'
import { installCodeStudioAIActions } from './codeStudioAIActionsRunner'
import { documentForModel, registerCodeStudioLanguageFeatures } from './codeStudioLanguageFeatures'
import { registerCodeStudioCodeLens } from './codeStudioCodeLens'
import { registerCodeStudioPom } from './codeStudioPom'
import { registerCodeStudioGoVuln } from './codeStudioGoVuln'
import { registerCodeStudioPythonSecurity } from './codeStudioPythonSecurity'
import { registerCodeStudioSpring } from './codeStudioSpring'
import { registerCodeStudioMyBatis } from './codeStudioMyBatis'
import { registerCodeStudioProtoLens } from './codeStudioProtoLens'
import { registerCodeStudioRuntimeLens } from './codeStudioRuntimeLens'
import { registerCodeStudioCodeVision } from './codeStudioCodeVision'
import { registerCodeStudioCopilotCompletions } from './codeStudioCopilotCompletions'
import { editorModelUri, releaseModelsOfClosedDocuments } from './codeStudioModelUri'
import { installRecursiveCallMarkers, registerCodeStudioSemanticFeatures } from './codeStudioSemanticFeatures'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { useCodeStudioTestsStore, visibleCoverage } from '@/stores/codeStudioTests'
import { coverageForDocument, coverageLineStates } from './codeStudioCoverage'
import { useCodeStudioProfileHeatDecorations } from './codeStudioProfileHeat'
import { startCodeStudioLspSync } from './codeStudioLspSync'
import { useWebMonaco } from '@/components/ide/languages/web/useWebMonaco'
import { useJavaMainsStore } from '@/stores/codeStudioJavaMains'
import { findRunTargets, runCommandFor, type CodeStudioRunTarget, type CodeStudioRunTargetHandler } from './codeStudioRunTargets'
import { isToolTarget, toolTargetLabel } from './codeStudioToolTargets'
import { isPythonTarget } from './codeStudioPythonTargets'
import { isRustTarget, isRustTestTarget } from './codeStudioRustTargets'
import { isJavaTarget } from './codeStudioJavaTargets'
import { indentationFor, useEditorConfig } from './codeStudioEditorConfig'
import { recordCaretPosition, useCodeStudioBookmarks } from './codeStudioNavigationEditor'
import { openImplementationMarker, useCodeStudioImplementationMarkers } from './codeStudioImplementationMarkers'
import { useCodeStudioContextMarkers } from './codeStudioContextMarkers'
import { useCodeStudioCommentTags } from './codeStudioCommentTags'
import { openVcsHunk, useCodeStudioVcsGutter } from './codeStudioVcsEditor'
import { registerCodeStudioExtraLanguages } from './codeStudioExtraLanguages'
import { installBreakpointGutter, registerCodeStudioDebugHover, useCodeStudioDebugDecorations } from './codeStudioDebugEditor'
import './codeStudioEditor.css'
import { startCodeStudioExtensions, installIDEExtensionActions } from './codeStudioExtensions'
import { extensionLanguageForPath, useIDEExtensionsStore } from '@/stores/ideExtensions'
const CodeStudioCollabBar = lazy(() => import('./CodeStudioCollabBar'))

configureMonacoLoader()
registerCodeStudioLanguageFeatures()
registerCodeStudioCodeLens()
registerCodeStudioPom()
registerCodeStudioGoVuln()
registerCodeStudioPythonSecurity()
registerCodeStudioSpring()
registerCodeStudioMyBatis()
registerCodeStudioProtoLens()
registerCodeStudioRuntimeLens()
registerCodeStudioCodeVision()
registerCodeStudioCopilotCompletions()
registerCodeStudioSemanticFeatures()
startCodeStudioLspSync()
registerCodeStudioDebugHover()
registerCodeStudioExtraLanguages()
startCodeStudioExtensions()
registerCodeStudioSettingsJson()

const RUN_TARGET_DEBOUNCE_MS = 250

void releaseModelsOfClosedDocuments()
startCodeStudioHibernation()

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

export const beforeCodeStudioMount: BeforeMount = (instance) => applyCodeStudioMonacoThemes(instance)

export function useCodeStudioEditorTheme(): string {
  return useSettingsStore((state) => state.settings.appearance.theme === 'light' ? CODE_STUDIO_THEMES.light : CODE_STUDIO_THEMES.dark)
}

interface CodeStudioCodeEditorProps {
  document: GoIDEEditorDocument
  /** Solo l'editor principale gestisce le richieste di navigazione (reveal). */
  handlesReveal: boolean
  onCursor: (line: number, column: number) => void
  onRunTarget: CodeStudioRunTargetHandler
}

/**
 * Editor Monaco di Code Studio. Pannello principale e split condividono il modello del file
 * (stesso URI) ma mantengono cursore, scroll e selezione indipendenti.
 */
export function CodeStudioCodeEditor(props: CodeStudioCodeEditorProps) {
  const sleeping = useCodeStudioHibernation(state => !!state.sleeping[props.document.document.sessionId])
  // Each split keeps its own selection/scroll instead of sharing Monaco React's URI cache.
  const view = useRef<{ documentId: string; state: monaco.editor.ICodeEditorViewState | null } | null>(null)
  const sessionId = props.document.document.sessionId
  useEffect(() => {
    if (sleeping) releaseSleepingSessionModels(sessionId)
  }, [sleeping, sessionId])
  return sleeping ? null : <MountedCodeStudioCodeEditor {...props} hibernationView={view} />
}

function MountedCodeStudioCodeEditor({ document, handlesReveal, onCursor, onRunTarget, hibernationView }: CodeStudioCodeEditorProps & {
  hibernationView: { current: { documentId: string; state: monaco.editor.ICodeEditorViewState | null } | null }
}) {
  const theme = useCodeStudioEditorTheme()
  useWebMonaco(document.document.sessionId, document.document.language)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const decorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const coverageDecorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const runTargetsRef = useRef<CodeStudioRunTarget[]>([])
  const callbacks = useRef({ onCursor, onRunTarget })
  useLayoutEffect(() => { callbacks.current = { onCursor, onRunTarget } })
  const [mountCount, setMountCount] = useState(0)
  const [mountedEditor, setMountedEditor] = useState<monaco.editor.IStandaloneCodeEditor | null>(null)
  const updateDocument = useCodeStudioStore((state) => state.updateDocument)
  const checkActiveDocument = useCodeStudioStore((state) => state.checkActiveDocument)
  const revealLocation = useCodeStudioStore((state) => state.revealLocation)
  const clearRevealLocation = useCodeStudioStore((state) => state.clearRevealLocation)
  const semanticHighlighting = useCodeStudioLspStore((state) => heavyFeatureEnabled(state, 'semanticHighlighting'))
  const inlayHints = useCodeStudioLspStore((state) => heavyFeatureEnabled(state, 'inlayHints'))
  const stickyScrollPref = useCodeStudioLspStore((state) => heavyFeatureEnabled(state, 'stickyScroll'))
  const inlineDiagnostics = useCodeStudioLspStore(state => state.preferences.inlineDiagnostics)
  const inlineWarnings = useCodeStudioLspStore(state => state.preferences.inlineDiagnosticWarnings)
  const inlineInfo = useCodeStudioLspStore(state => state.preferences.inlineDiagnosticInfo)
  useEffect(() => {
    if (!mountedEditor || !inlineDiagnostics) return
    // Hints stay in the normal Monaco hover; inline severities are independently selectable.
    return installInlineDiagnostics(mountedEditor, [monaco.MarkerSeverity.Error, ...(inlineWarnings ? [monaco.MarkerSeverity.Warning] : []), ...(inlineInfo ? [monaco.MarkerSeverity.Info] : [])])
  }, [mountedEditor, inlineDiagnostics, inlineWarnings, inlineInfo])
  const fontLigaturesPref = useCodeStudioLspStore((state) => state.preferences.fontLigatures)
  const fontSizePref = useCodeStudioLspStore((state) => state.preferences.fontSize)
  const editorModePref = useCodeStudioLspStore((state) => state.preferences.editorMode)
  // `.adomnia/settings.json` del progetto vince sulle preferenze utente, chiave per chiave.
  const projectEditor = useProjectSettings(document.document.sessionId).settings.editor
  const stickyScroll = projectEditor.stickyScroll ?? stickyScrollPref
  const fontLigatures = projectEditor.fontLigatures ?? fontLigaturesPref
  const fontSize = projectEditor.fontSize ?? fontSizePref
  const configuredEditorMode = projectEditor.editorMode ?? editorModePref
  const [standardOverride, setStandardOverride] = useState<string | null>(null)
  const [prevConfiguredMode, setPrevConfiguredMode] = useState(configuredEditorMode)
  if (prevConfiguredMode !== configuredEditorMode) {
    setPrevConfiguredMode(configuredEditorMode)
    setStandardOverride(null)
  }
  const editorMode = standardOverride === document.document.sessionId ? 'default' : configuredEditorMode
  const vimMode = useCodeStudioWhenStore(state => state.vimMode)
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
    setMountedEditor(editor)
    if (hibernationView.current?.documentId === document.document.id) {
      editor.restoreViewState(hibernationView.current.state)
    }
    const unregister = registerCodeStudioEditor(editor)
    editor.onDidDispose(unregister)
    editor.onDidFocusEditorWidget(() => {
      registerCodeStudioEditor(editor)
      const position = editor.getPosition()
      if (position) callbacks.current.onCursor(position.lineNumber, position.column)
    })
    installCodeStudioEditorActions(editor)
    installSymbolOriginCopy(editor)
    installIDEExtensionActions(editor)
    installCodeStudioAIActions(editor)
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
        rememberCaret(caretDocument.document.sessionId, caretDocument.document.relativePath, event.position.lineNumber, event.position.column, (id) => void useCodeStudioStore.getState().persistSessionView(id))
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
        useCodeStudioNavigationStore.getState().recordEdit(changed.document.sessionId, { relativePath: changed.document.relativePath, line: edited.startLineNumber, column: edited.startColumn })
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
    const editor = mountedEditor
    const caret = caretFor(document.document.sessionId, document.document.relativePath)
    const position = editor?.getPosition()
    if (!editor || !caret || !position || position.lineNumber !== 1 || position.column !== 1) return
    const target = { lineNumber: caret.line, column: caret.column }
    editor.setPosition(target)
    revealWhenSized(editor, target)
  }, [document.document.id, document.document.relativePath, document.document.sessionId, mountedEditor])

  useCodeStudioDebugDecorations(editorRef, document, mountCount)
  useCodeStudioBookmarks(editorRef, document, mountCount)
  useCodeStudioImplementationMarkers(editorRef, document, mountCount)
  useCodeStudioContextMarkers(editorRef, document, mountCount)
  useCodeStudioCommentTags(editorRef, document, mountCount)
  useCodeStudioVcsGutter(editorRef, document, mountCount)
  useCodeStudioProfileHeatDecorations(editorRef, document, mountCount)

  // Overlay di coverage: solo se il file è identico a quello misurato, altrimenti sparisce (e l'editor avvisa).
  const coverage = useCodeStudioTestsStore((state) => visibleCoverage(state, document.document.sessionId))
  useEffect(() => {
    if (!mountedEditor) return
    const match = coverageForDocument(coverage, document.document.relativePath, document.diskToken, document.dirty)
    if (match.state !== 'current') return void coverageDecorationsRef.current?.clear()
    const decorations: monaco.editor.IModelDeltaDecoration[] = []
    for (const [line, state] of coverageLineStates(match.file)) {
      decorations.push({ range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 }, options: { linesDecorationsClassName: `code-studio-cov code-studio-cov-${state}`, isWholeLine: true } })
    }
    coverageDecorationsRef.current?.set(decorations)
  }, [coverage, document.diskToken, document.dirty, document.document.relativePath, mountedEditor])

  // Le `main` le decide JDT LS quando è pronto; il gutter si rilegge quando la risposta arriva.
  const isJava = document.document.relativePath.endsWith('.java')
  const jdtMains = useJavaMainsStore((state) => (isJava ? state.bySession[document.document.sessionId] : undefined))
  useEffect(() => {
    if (isJava) void useJavaMainsStore.getState().refresh(document.document.sessionId)
  // oxlint-disable-next-line react/exhaustive-effect-dependencies -- diskToken is a refetch trigger: the file changed on disk
  }, [isJava, document.document.sessionId, document.diskToken])

  // ▶ nel gutter accanto a func main e ai test: ricalcolato con debounce mentre si scrive.
  useEffect(() => {
    if (!mountedEditor) return
    const timer = window.setTimeout(() => {
      const targets = document.document.readOnly ? [] : findRunTargets(document.document.relativePath, document.buffer, jdtMains?.source === 'jdt' ? jdtMains.classes : null)
      runTargetsRef.current = targets
      decorationsRef.current?.set(targets.map((target) => ({
        range: { startLineNumber: target.line, startColumn: 1, endLineNumber: target.line, endColumn: 1 },
        options: {
          glyphMarginClassName: `code-studio-run-glyph${target.kind === 'main' || target.kind === 'java-main' || target.kind === 'python-main' || target.kind === 'rust-main' || isToolTarget(target) ? '' : ' code-studio-test-glyph'}`,
          glyphMarginHoverMessage: { value: isRustTestTarget(target)
            ? `▶ Run ${target.name} · cargo test`
            : isPythonTarget(target) || isRustTarget(target)
            ? `▶ Run ${target.name} · Run or Debug`
            : isToolTarget(target)
            ? `▶ ${toolTargetLabel(target)} · ${target.kind === 'docker' ? 'Build, Build & Run' : target.kind === 'compose' && !target.name ? 'Up, Down' : 'Run'} or save as configuration`
            : isJavaTarget(target)
              ? `▶ ${target.kind === 'java-main' ? `Run ${target.className}` : `Run ${target.name}`}${' · Run or Debug'}`
              : `▶ ${runCommandFor(target).label} · Run, Debug or Coverage` },
        },
      })))
    }, RUN_TARGET_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [document.buffer, document.document.readOnly, document.document.relativePath, jdtMains, mountedEditor])

  // Vim / Emacs opzionali: si agganciano all'editor montato e si staccano quando si torna al default.
  useEffect(() => {
    const editor = mountedEditor
    if (!editor || editorMode === 'default') return
    let detach: (() => void) | null = null
    let cancelled = false
    void attachEditorMode(editor, editorMode, modeStatusRef.current, (mode) => useCodeStudioWhenStore.getState().setVimMode(mode)).then((dispose) => {
      if (cancelled) dispose()
      else detach = dispose
    }).catch((error) => useCodeStudioLspStore.setState({ message: `Could not start ${editorMode} mode: ${error instanceof Error ? error.message : String(error)}` }))
    return () => {
      cancelled = true
      detach?.()
    }
  }, [editorMode, mountedEditor])

  return (
    <div className="flex h-full min-h-0 flex-col">
    <Suspense fallback={null}><CodeStudioCollabBar document={document} editor={mountedEditor} /></Suspense>
    <div className="min-h-0 flex-1">
    <Editor
      path={editorModelUri(document.document)}
      keepCurrentModel
      saveViewState
      language={extensionLanguage?.monaco || extensionLanguage?.id || document.document.language}
      value={document.buffer}
      theme={theme}
      beforeMount={beforeCodeStudioMount}
      onMount={onMount}
      options={{
        automaticLayout: true,
        mouseWheelZoom: true,
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
        // Parentesi monocromatiche: il colore resta alla sintassi, si evidenzia solo la coppia sotto il cursore.
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
        codeLensFontSize: 10,
        codeLensFontFamily: 'var(--font-sans)',
        // Go, assembly e Makefile vogliono tab veri: una ricetta indentata a spazi rompe make.
        // Per gli altri file vale .editorconfig, e `.adomnia/settings.json` è il livello più esplicito.
        ...indentationFor(document.document.language, editorConfigWithProject(editorConfig, projectEditor)),
        padding: { top: 36, bottom: 8 },
        scrollBeyondLastColumn: 4,
      }}
    />
    </div>
    <CodeStudioEditorModeNotice mode={editorMode} vimMode={vimMode} statusRef={modeStatusRef} onStandard={() => {
        // A project setting can override the global preference: recover this editor as well.
        setStandardOverride(document.document.sessionId)
        useCodeStudioLspStore.getState().updatePreferences({ editorMode: 'default' })
        requestAnimationFrame(() => editorRef.current?.focus())
      }} />
    </div>
  )
}
