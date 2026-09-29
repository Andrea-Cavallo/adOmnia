import { useEffect, useRef, useState } from 'react'
import Editor, { type BeforeMount, type OnMount } from '@monaco-editor/react'
import { GO_STUDIO_THEMES, applyGoStudioMonacoThemes, configureMonacoLoader, monaco } from '@/lib/monacoSetup'
import { useGoIDEStore, type GoIDEEditorDocument } from '@/stores/goide'
import { useSettingsStore } from '@/stores/settings'
import { registerGoStudioEditor } from './goStudioEditorRegistry'
import { installGoStudioEditorActions } from './goStudioEditorActions'
import { documentForModel, registerGoStudioLanguageFeatures } from './goStudioLanguageFeatures'
import { registerGoStudioCodeLens } from './goStudioCodeLens'
import { editorModelUri } from './goStudioModelUri'
import { installRecursiveCallMarkers, registerGoStudioSemanticFeatures } from './goStudioSemanticFeatures'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { useGoIDETestsStore, visibleCoverage } from '@/stores/goideTests'
import { coverageForDocument, coverageLineStates } from './goStudioCoverage'
import { startGoStudioLspSync } from './goStudioLspSync'
import { findRunTargets, runCommandFor, type GoStudioRunTarget, type GoStudioRunTargetHandler } from './goStudioRunTargets'
import { isToolTarget, toolTargetLabel } from './goStudioToolTargets'
import { recordCaretPosition, useGoStudioBookmarks } from './goStudioNavigationEditor'
import { openImplementationMarker, useGoStudioImplementationMarkers } from './goStudioImplementationMarkers'
import { openVcsHunk, useGoStudioVcsGutter } from './goStudioVcsEditor'
import { registerGoStudioExtraLanguages } from './goStudioExtraLanguages'
import { installBreakpointGutter, registerGoStudioDebugHover, useGoStudioDebugDecorations } from './goStudioDebugEditor'
import './goStudioEditor.css'

configureMonacoLoader()
registerGoStudioLanguageFeatures()
registerGoStudioCodeLens()
registerGoStudioSemanticFeatures()
startGoStudioLspSync()
registerGoStudioDebugHover()
registerGoStudioExtraLanguages()

const RUN_TARGET_DEBOUNCE_MS = 250

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
 * Editor Monaco di Go Studio. Pannello principale e split condividono il modello del file
 * (stesso URI) ma mantengono cursore, scroll e selezione indipendenti.
 */
export function GoStudioCodeEditor({ document, handlesReveal, onCursor, onRunTarget }: GoStudioCodeEditorProps) {
  const theme = useGoStudioEditorTheme()
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
  const semanticHighlighting = useGoIDELspStore((state) => state.preferences.semanticHighlighting)
  const inlayHints = useGoIDELspStore((state) => state.preferences.inlayHints)

  const onMount: OnMount = (editor) => {
    editorRef.current = editor
    const unregister = registerGoStudioEditor(editor)
    editor.onDidDispose(unregister)
    editor.onDidFocusEditorWidget(() => {
      registerGoStudioEditor(editor)
      const position = editor.getPosition()
      if (position) callbacks.current.onCursor(position.lineNumber, position.column)
    })
    installGoStudioEditorActions(editor)
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
    })
    editor.onDidFocusEditorText(() => void checkActiveDocument())
    // Il documento si ricava dal modello che è cambiato, mai dal componente: durante il cambio file
    // @monaco-editor/react può notificare con la closure del file precedente e sporcarne il buffer.
    editor.onDidChangeModelContent(() => {
      const model = editor.getModel()
      const changed = model ? documentForModel(model) : null
      if (!model || !changed || changed.document.readOnly) return
      const value = model.getValue()
      if (value !== changed.buffer) updateDocument(changed.document.id, value)
    })
  }

  useEffect(() => {
    if (!handlesReveal || revealLocation?.documentId !== document.document.id || !editorRef.current) return
    const position = { lineNumber: revealLocation.line, column: revealLocation.column }
    editorRef.current.setPosition(position)
    editorRef.current.revealPositionInCenter(position)
    editorRef.current.focus()
    clearRevealLocation()
  }, [clearRevealLocation, document.document.id, handlesReveal, revealLocation])

  useGoStudioDebugDecorations(editorRef, document, mountCount)
  useGoStudioBookmarks(editorRef, document, mountCount)
  useGoStudioImplementationMarkers(editorRef, document, mountCount)
  useGoStudioVcsGutter(editorRef, document, mountCount)

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
            ? `▶ ${toolTargetLabel(target)} · ${target.kind === 'docker' ? 'Build, Build & Run' : 'Run'} or save as configuration`
            : `▶ ${runCommandFor(target).label} · Run, Debug or Coverage` },
        },
      })))
    }, RUN_TARGET_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [document.buffer, document.document.id, document.document.readOnly, document.document.relativePath, mountCount])

  return (
    <Editor
      path={editorModelUri(document.document)}
      language={document.document.language}
      value={document.buffer}
      theme={theme}
      beforeMount={beforeGoStudioMount}
      onMount={onMount}
      options={{
        automaticLayout: true,
        fontSize: 12,
        fontFamily: 'var(--skin-font-mono, var(--font-mono))',
        lineHeight: 20,
        minimap: { enabled: false },
        lineNumbers: 'on',
        folding: true,
        bracketPairColorization: { enabled: true },
        matchBrackets: 'always',
        scrollBeyondLastLine: false,
        renderLineHighlight: 'line',
        readOnly: !!document.document.readOnly,
        glyphMargin: true,
        lineDecorationsWidth: 16,
        codeLens: !document.document.readOnly,
        'semanticHighlighting.enabled': semanticHighlighting,
        inlayHints: { enabled: inlayHints ? 'on' : 'off', fontSize: 10, padding: true },
        occurrencesHighlight: 'singleFile',
        codeLensFontSize: 10,
        tabSize: document.document.language === 'go' || document.document.language === 'goasm' ? 4 : 2,
        // Go, assembly e Makefile vogliono tab veri: una ricetta indentata a spazi rompe make.
        insertSpaces: !['go', 'goasm', 'makefile'].includes(document.document.language),
        padding: { top: 6, bottom: 6 },
      }}
    />
  )
}
