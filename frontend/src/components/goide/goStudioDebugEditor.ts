import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { monaco } from '@/lib/monacoSetup'
import { evaluateGoIDEDebug, type GoIDEBreakpointState, type GoIDEDebugScope, type GoIDEDebugVariable } from '@/lib/goide-debug-api'
import type { GoIDEEditorDocument } from '@/stores/goide'
import { activeDebugView, executionPoint, hasBreakpointOptions, hasLiveDebugger, useGoIDEDebugStore, type GoIDEExecutionPoint } from '@/stores/goideDebug'
import { breakpointSummary, useGoStudioBreakpointUi } from './goStudioBreakpoints'
import { documentForModel } from './goStudioLanguageFeatures'
import { useTrackedLineMarkers } from './goStudioLineMarkers'
import { frameVariables, inlineValueText } from './goStudioDebugInlineValues'

const HOVER_VALUE_MAX_CHARS = 2000
const EMPTY_BREAKPOINTS: GoIDEBreakpointState[] = []
const NO_SCOPES: GoIDEDebugScope[] = []
const NO_CHILDREN: Record<number, GoIDEDebugVariable[]> = {}
/** Spazio tra il codice e il valore mostrato a fine riga. */
const INLINE_VALUE_GAP = '    '
/** Identificatori e selettori Go (p.X.Y): quello che GoLand valuta al passaggio del mouse. */
const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/
const SELECTOR_BEFORE = /(?:[A-Za-z_][A-Za-z0-9_]*\.)+$/

/** Solo i file Go del progetto accettano breakpoint: fuori dal progetto Delve non li risolverebbe. */
export function canHoldBreakpoints(document: GoIDEEditorDocument | null): document is GoIDEEditorDocument {
  return !!document && !document.document.external && document.document.relativePath.endsWith('.go')
}

/** Classi del glifo: pallino, "?" per condizione e hit count, rombo per i logpoint, grigio se disattivato. */
export function breakpointClass(state: GoIDEBreakpointState, debugging: boolean): string {
  const classes = ['go-studio-bp']
  if (state.disabled) classes.push('go-studio-bp-disabled')
  else if (debugging && !state.verified) classes.push('go-studio-bp-pending')
  if (state.logMessage) classes.push('go-studio-bp-log')
  else if (hasBreakpointOptions(state)) classes.push('go-studio-bp-cond')
  return classes.join(' ')
}

/** Pallino rosso sul numero di riga; vuoto finché Delve non verifica il breakpoint durante un debug. */
export function breakpointDecorations(states: GoIDEBreakpointState[], debugging: boolean): monaco.editor.IModelDeltaDecoration[] {
  return states.map((state) => {
    const pending = debugging && !state.verified && !state.disabled
    const kind = state.logMessage ? 'Logpoint' : 'Breakpoint'
    const summary = breakpointSummary(state)
    const hover = pending
      ? state.message || `${kind} not verified by Delve yet`
      : `${kind}${summary ? ` · ${summary}` : ''} · click to remove, right-click to edit`
    return {
      range: { startLineNumber: state.line, startColumn: 1, endLineNumber: state.line, endColumn: 1 },
      options: {
        lineNumberClassName: breakpointClass(state, debugging),
        lineNumberHoverMessage: { value: hover },
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        overviewRuler: state.disabled ? undefined : { color: 'rgba(239, 68, 68, 0.8)', position: monaco.editor.OverviewRulerLane.Left },
      },
    }
  })
}

/** Riga di esecuzione corrente: sfondo e freccia; i frame più in basso nello stack sono più tenui. */
export function executionDecorations(point: GoIDEExecutionPoint | null): monaco.editor.IModelDeltaDecoration[] {
  if (!point) return []
  return [{
    range: { startLineNumber: point.line, startColumn: 1, endLineNumber: point.line, endColumn: 1 },
    options: {
      isWholeLine: true,
      className: point.top ? 'go-studio-exec-line' : 'go-studio-exec-line go-studio-exec-frame',
      lineNumberClassName: 'go-studio-exec',
      overviewRuler: { color: 'rgba(250, 204, 21, 0.9)', position: monaco.editor.OverviewRulerLane.Full },
    },
  }]
}

/** Espressione sotto il cursore, compresi i selettori a sinistra: su "X" in "p.X" restituisce "p.X". */
export function expressionAt(lineText: string, column: number): string | null {
  const index = column - 1
  if (!/[A-Za-z0-9_]/.test(lineText[index] ?? '')) return null
  let start = index
  while (start > 0 && /[A-Za-z0-9_]/.test(lineText[start - 1])) start--
  let end = index
  while (end < lineText.length && /[A-Za-z0-9_]/.test(lineText[end])) end++
  const word = lineText.slice(start, end)
  if (!IDENTIFIER.test(word) || /^[0-9]/.test(word)) return null
  const prefix = SELECTOR_BEFORE.exec(lineText.slice(0, start))?.[0] ?? ''
  return prefix + word
}

function toggleAt(document: GoIDEEditorDocument, line: number): void {
  void useGoIDEDebugStore.getState().toggleBreakpoint(document.document.sessionId, document.document.relativePath, line)
}

/** Ctrl+F8: breakpoint sulla riga del cursore dell'editor indicato. */
export function toggleBreakpointAtCursor(editor: monaco.editor.ICodeEditor | null): boolean {
  const model = editor?.getModel()
  const position = editor?.getPosition()
  const document = model ? documentForModel(model) : null
  if (!position || !canHoldBreakpoints(document)) return false
  toggleAt(document, position.lineNumber)
  return true
}

/** Alt+F9: riprende il programma in pausa fino alla riga del cursore. */
export function runToCursorAt(editor: monaco.editor.ICodeEditor | null): boolean {
  const model = editor?.getModel()
  const position = editor?.getPosition()
  const document = model ? documentForModel(model) : null
  if (!position || !canHoldBreakpoints(document)) return false
  const debug = useGoIDEDebugStore.getState()
  const view = activeDebugView(debug, document.document.sessionId)
  if (!view) return false
  void debug.runToCursor(view.info.id, document.document.relativePath, position.lineNumber)
  return true
}

/**
 * Clic sui numeri di riga = breakpoint, come in GoLand; tasto destro = popover con condizione,
 * hit count e logpoint (Monaco non apre il suo menu sul gutter). Monaco selezionerebbe la riga:
 * la selezione precedente si ripristina al rilascio del mouse.
 */
export function installBreakpointGutter(editor: monaco.editor.IStandaloneCodeEditor): void {
  let pending: { line: number; selection: monaco.Selection | null } | null = null
  editor.onMouseDown((event) => {
    pending = null
    if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS || !event.event.leftButton) return
    const line = event.target.position?.lineNumber
    if (line) pending = { line, selection: editor.getSelection() }
  })
  editor.onMouseUp((event) => {
    const click = pending
    pending = null
    if (!click || event.target.position?.lineNumber !== click.line) return
    const model = editor.getModel()
    const document = model ? documentForModel(model) : null
    if (!canHoldBreakpoints(document)) return
    toggleAt(document, click.line)
    if (click.selection) editor.setSelection(click.selection)
  })
  editor.onContextMenu((event) => {
    if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS) return
    const line = event.target.position?.lineNumber
    const model = editor.getModel()
    const document = model ? documentForModel(model) : null
    if (!line || !canHoldBreakpoints(document)) return
    event.event.preventDefault()
    useGoStudioBreakpointUi.getState().openPopover({ sessionId: document.document.sessionId, relativePath: document.document.relativePath, line, x: event.event.posx, y: event.event.posy })
  })
}

/**
 * Disegna breakpoint e riga di esecuzione, e mantiene i breakpoint sulle righe giuste mentre si scrive:
 * le decorazioni seguono il testo e, dopo una pausa, le nuove righe tornano al backend.
 */
export function useGoStudioDebugDecorations(editorRef: MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>, document: GoIDEEditorDocument, mountCount: number): void {
  const { sessionId, relativePath, id } = document.document
  const breakpoints = useGoIDEDebugStore((state) => state.breakpoints[sessionId]?.[relativePath] ?? EMPTY_BREAKPOINTS)
  const debugging = useGoIDEDebugStore((state) => hasLiveDebugger(state, sessionId))
  // Solo valori primitivi: un oggetto nuovo a ogni lettura farebbe ridisegnare all'infinito.
  const { pointLine, pointTop } = useGoIDEDebugStore(useShallow((state) => {
    const point = executionPoint(state, sessionId)
    return { pointLine: point?.relativePath === relativePath ? point.line : 0, pointTop: !!point?.top }
  }))
  // Valori delle variabili a fine riga, come GoLand: solo nel file della riga in pausa.
  const inline = useGoIDEDebugStore(useShallow((state) => {
    const view = activeDebugView(state, sessionId)
    const point = executionPoint(state, sessionId)
    if (!view || point?.relativePath !== relativePath) return { scopes: NO_SCOPES, children: NO_CHILDREN }
    return { scopes: view.scopes, children: view.children }
  }))
  const holdsBreakpoints = canHoldBreakpoints(document)
  const executionRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const inlineValuesRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const decorations = useMemo(() => breakpointDecorations(breakpoints, debugging), [breakpoints, debugging])

  useTrackedLineMarkers(editorRef, {
    documentId: id, mountCount, decorations, tracked: holdsBreakpoints,
    onMoved: (lines) => void useGoIDEDebugStore.getState().setBreakpointLines(sessionId, relativePath, lines),
  })

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    executionRef.current ??= editor.createDecorationsCollection()
    inlineValuesRef.current ??= editor.createDecorationsCollection()
  }, [editorRef, mountCount])

  useEffect(() => { void useGoIDEDebugStore.getState().loadBreakpoints(sessionId) }, [sessionId])

  useEffect(() => {
    executionRef.current?.set(executionDecorations(pointLine ? { relativePath, line: pointLine, top: pointTop } : null))
  }, [id, mountCount, pointLine, pointTop, relativePath])

  useEffect(() => {
    const model = editorRef.current?.getModel()
    if (!model || !pointLine) return void inlineValuesRef.current?.clear()
    const values = inlineValueText(model.getLinesContent(), pointLine, frameVariables(inline.scopes, inline.children))
    inlineValuesRef.current?.set([...values].map(([line, content]) => {
      const column = model.getLineMaxColumn(line)
      return {
        range: { startLineNumber: line, startColumn: column, endLineNumber: line, endColumn: column },
        options: { after: { content: `${INLINE_VALUE_GAP}${content}`, inlineClassName: 'go-studio-inline-value' }, showIfCollapsed: true },
      }
    }))
  }, [editorRef, id, inline.children, inline.scopes, mountCount, pointLine])
}

let hoverRegistered = false

function truncate(value: string): string {
  return value.length > HOVER_VALUE_MAX_CHARS ? `${value.slice(0, HOVER_VALUE_MAX_CHARS)}…` : value
}

/** In pausa, il passaggio del mouse su una variabile ne mostra il valore nel frame selezionato. */
export function registerGoStudioDebugHover(): void {
  if (hoverRegistered) return
  hoverRegistered = true
  monaco.languages.registerHoverProvider('go', {
    provideHover: async (model, position) => {
      const document = documentForModel(model)
      if (!document) return null
      const view = activeDebugView(useGoIDEDebugStore.getState(), document.document.sessionId)
      if (!view || view.info.state !== 'stopped' || view.frameId === null) return null
      const expression = expressionAt(model.getLineContent(position.lineNumber), position.column)
      if (!expression) return null
      try {
        const result = await evaluateGoIDEDebug(view.info.id, expression, view.frameId, 'hover')
        const type = result.type ? ` *${result.type}*` : ''
        return { contents: [{ value: `**${expression}** =${type}\n\n\`\`\`go\n${truncate(result.result)}\n\`\`\`` }] }
      } catch {
        return null
      }
    },
  })
}
