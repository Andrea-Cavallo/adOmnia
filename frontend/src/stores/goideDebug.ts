import { create } from 'zustand'
import { confirm } from '@/lib/confirmDialog'
import { subscribeGoIDEEvents, type GoIDEEvent } from '@/lib/goide-api'
import {
  detectGoIDEDelve, evaluateGoIDEDebug, getGoIDEDebugGoroutines, getGoIDEDebugScopes, getGoIDEDebugStack, getGoIDEDebugVariables, installGoIDEDelve,
  listGoIDEBreakpoints, listGoIDEDebugThreads, setGoIDEBreakpoints, startGoIDEDebug, stepGoIDEDebug, stopGoIDEDebug,
  type GoIDEBreakpointState, type GoIDEDebugFrame, type GoIDEDebugOutput, type GoIDEDebugRequest, type GoIDEDebugScope,
  type GoIDEDebugSession, type GoIDEDebugStepAction, type GoIDEGoroutineOverview, type GoIDEDelveInfo, type GoIDEDebugThread, type GoIDEDebugVariable, type GoIDEFileBreakpoints,
} from '@/lib/goide-debug-api'
import { useGoIDEStore } from './goide'
import { useGoIDELspStore } from './goideLsp'

const MAX_CONSOLE_LINES = 2000
const MAX_DEBUGGERS_PER_SESSION = 5
/** Suggerimento del terminale di Delve: in un IDE non serve. */
const DELVE_NOISE = /^Type 'dlv help' for list of commands\.?\s*$/
/** Messaggio del backend per una variabile non visibile nel frame selezionato. */
const OUT_OF_SCOPE = /is not visible in the selected frame$/
const DELVE_MODULE = 'github.com/go-delve/delve/cmd/dlv@latest'

export interface GoIDEDebugConsoleLine {
  id: number
  category: 'stdout' | 'stderr' | 'console' | 'input' | 'result' | 'error'
  text: string
}

export interface GoIDEWatchValue {
  value: string
  type?: string
  reference: number
  error?: boolean
  /** La variabile esiste ma non nel frame selezionato: non è un errore, si mostra attenuata. */
  outOfScope?: boolean
}

/** Stato di una sessione di debug: dati di pausa validi solo finché info.state è 'stopped'. */
export interface GoIDEDebugView {
  info: GoIDEDebugSession
  threads: GoIDEDebugThread[]
  frames: GoIDEDebugFrame[]
  threadId: number | null
  frameId: number | null
  scopes: GoIDEDebugScope[]
  /** Figli già caricati per variablesReference. */
  children: Record<number, GoIDEDebugVariable[]>
  watchValues: Record<string, GoIDEWatchValue>
  console: GoIDEDebugConsoleLine[]
  loading: boolean
  /** Istantanea di tutte le goroutine alla pausa corrente (vista Concurrency). */
  goroutines: GoIDEGoroutineOverview | null
  goroutinesLoading: boolean
  /** Conteggio per stato a ogni pausa della sessione: la timeline della vista Concurrency. */
  timeline: GoIDEGoroutineSample[]
  /** Richiesta originale, per Rerun. */
  request: GoIDEDebugRequest | null
}

export interface GoIDEGoroutineSample {
  pause: number
  at: number
  total: number
  counts: Record<string, number>
}

/** Pause ricordate nella timeline: bastano per vedere una crescita, senza accumulare memoria. */
const MAX_TIMELINE_SAMPLES = 60

export function goroutineSample(overview: GoIDEGoroutineOverview, pause: number, at: number): GoIDEGoroutineSample {
  const counts: Record<string, number> = {}
  for (const goroutine of overview.goroutines ?? []) counts[goroutine.state] = (counts[goroutine.state] ?? 0) + 1
  return { pause, at, total: overview.goroutines?.length ?? 0, counts }
}

export interface GoIDEExecutionPoint {
  relativePath: string
  line: number
  /** true solo per il frame in cima: gli altri frame si evidenziano in modo più tenue. */
  top: boolean
}

interface GoIDEDebugState {
  debuggers: Record<string, GoIDEDebugView>
  activeBySession: Record<string, string | null>
  breakpoints: Record<string, Record<string, GoIDEBreakpointState[]>>
  watches: Record<string, string[]>
  delve: Record<string, GoIDEDelveInfo>
  error: string | null
  start: (request: GoIDEDebugRequest) => Promise<void>
  stop: (debugId: string) => Promise<void>
  restart: (debugId: string) => Promise<void>
  step: (debugId: string, action: GoIDEDebugStepAction) => Promise<void>
  selectDebugger: (sessionId: string, debugId: string) => void
  selectThread: (debugId: string, threadId: number) => Promise<void>
  selectFrame: (debugId: string, frameId: number) => Promise<void>
  refreshGoroutines: (debugId: string) => Promise<void>
  loadChildren: (debugId: string, reference: number) => Promise<void>
  evaluate: (debugId: string, expression: string) => Promise<void>
  addWatch: (sessionId: string, expression: string) => void
  removeWatch: (sessionId: string, expression: string) => void
  loadBreakpoints: (sessionId: string) => Promise<void>
  toggleBreakpoint: (sessionId: string, relativePath: string, line: number) => Promise<void>
  setBreakpointLines: (sessionId: string, relativePath: string, lines: number[]) => Promise<void>
  installDelve: (sessionId: string) => Promise<boolean>
  detectDelve: (sessionId: string) => Promise<GoIDEDelveInfo | null>
  handleEvent: (event: GoIDEEvent) => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

let lineSequence = 0
let unsubscribe: (() => void) | null = null
/** Ogni pausa ha un token: risposte arrivate dopo un resume vengono scartate. */
const pauseTokens: Record<string, number> = {}

function ensureSubscribed(handle: (event: GoIDEEvent) => void): void {
  if (!unsubscribe) unsubscribe = subscribeGoIDEEvents(handle)
}

function emptyView(info: GoIDEDebugSession, request: GoIDEDebugRequest | null = null): GoIDEDebugView {
  return { info, threads: [], frames: [], threadId: null, frameId: null, scopes: [], children: {}, watchValues: {}, console: [], loading: false, goroutines: null, goroutinesLoading: false, timeline: [], request }
}

function appendLines(lines: GoIDEDebugConsoleLine[], category: GoIDEDebugConsoleLine['category'], text: string): GoIDEDebugConsoleLine[] {
  const next = [...lines, { id: ++lineSequence, category, text }]
  return next.length > MAX_CONSOLE_LINES ? next.slice(next.length - MAX_CONSOLE_LINES) : next
}

function consoleCategory(output: GoIDEDebugOutput): GoIDEDebugConsoleLine['category'] {
  if (output.category === 'stderr') return 'stderr'
  if (output.category === 'stdout') return 'stdout'
  return 'console'
}

/** Prima riga del frame con sorgente di progetto: in pausa manuale la cima è spesso nel runtime. */
function preferredFrame(frames: GoIDEDebugFrame[]): GoIDEDebugFrame | null {
  return frames.find((frame) => frame.relativePath) ?? frames[0] ?? null
}

/** Punto di esecuzione del debug attivo della sessione, per evidenziare la riga nell'editor. */
export function executionPoint(state: Pick<GoIDEDebugState, 'debuggers' | 'activeBySession'>, sessionId: string): GoIDEExecutionPoint | null {
  const debugId = state.activeBySession[sessionId]
  const view = debugId ? state.debuggers[debugId] : null
  if (!view || view.info.state !== 'stopped') return null
  const frame = view.frames.find((item) => item.id === view.frameId)
  if (!frame?.relativePath) return null
  return { relativePath: frame.relativePath, line: frame.line, top: view.frames[0]?.id === frame.id }
}

/** Sessione di debug mostrata nella tool window: quella scelta o la più recente. */
export function activeDebugView(state: Pick<GoIDEDebugState, 'debuggers' | 'activeBySession'>, sessionId: string): GoIDEDebugView | null {
  const debugId = state.activeBySession[sessionId]
  return debugId ? state.debuggers[debugId] ?? null : null
}

/** true se c'è un debug non terminato nella sessione. */
export function hasLiveDebugger(state: Pick<GoIDEDebugState, 'debuggers'>, sessionId: string): boolean {
  return Object.values(state.debuggers).some((view) => view.info.sessionId === sessionId && view.info.state !== 'terminated')
}

/** Tiene solo le ultime sessioni terminate del progetto, così la console dei debug vecchi non cresce senza limite. */
function pruneFinished(debuggers: Record<string, GoIDEDebugView>, sessionId: string): Record<string, GoIDEDebugView> {
  const finished = Object.values(debuggers).filter((view) => view.info.sessionId === sessionId && view.info.state === 'terminated')
  const dropped = new Set(finished.slice(0, Math.max(0, finished.length - (MAX_DEBUGGERS_PER_SESSION - 1))).map((view) => view.info.id))
  return Object.fromEntries(Object.entries(debuggers).filter(([id]) => !dropped.has(id)))
}

function linesOf(states: GoIDEBreakpointState[] | undefined): number[] {
  return (states ?? []).map((item) => item.line)
}

function sameLines(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((line, index) => line === right[index])
}

async function confirmDelveInstall(): Promise<boolean> {
  return confirm({
    title: 'Install Delve?',
    message: `The Go debugger (dlv) is not installed.\n\nCommand: go install ${DELVE_MODULE}\n\nDownloads Delve through your Go proxy and installs it into adOmnia's local tools folder, using the Go SDK selected for this project. Output appears in the Run console.`,
    confirmLabel: 'Install Delve',
  })
}

export const useGoIDEDebugStore = create<GoIDEDebugState>((set, get) => {
  const updateView = (debugId: string, update: (view: GoIDEDebugView) => Partial<GoIDEDebugView>) => set((state) => {
    const view = state.debuggers[debugId]
    return view ? { debuggers: { ...state.debuggers, [debugId]: { ...view, ...update(view) } } } : {}
  })

  const isCurrentPause = (debugId: string, token: number) => pauseTokens[debugId] === token && get().debuggers[debugId]?.info.state === 'stopped'

  const evaluateWatches = async (debugId: string, frameId: number, token: number) => {
    const view = get().debuggers[debugId]
    if (!view) return
    const values: Record<string, GoIDEWatchValue> = {}
    for (const expression of get().watches[view.info.sessionId] ?? []) {
      try {
        const result = await evaluateGoIDEDebug(debugId, expression, frameId, 'watch')
        values[expression] = { value: result.result, type: result.type, reference: result.variablesReference }
      } catch (error) {
        const message = errorMessage(error)
        values[expression] = { value: message, reference: 0, error: true, outOfScope: OUT_OF_SCOPE.test(message) }
      }
    }
    if (isCurrentPause(debugId, token)) updateView(debugId, () => ({ watchValues: values }))
  }

  const loadFrame = async (debugId: string, frame: GoIDEDebugFrame, token: number, reveal: boolean) => {
    const scopes = await getGoIDEDebugScopes(debugId, frame.id)
    const children: Record<number, GoIDEDebugVariable[]> = {}
    for (const scope of scopes.filter((item) => !item.expensive && item.variablesReference > 0)) {
      children[scope.variablesReference] = await getGoIDEDebugVariables(debugId, scope.variablesReference)
    }
    if (!isCurrentPause(debugId, token)) return
    updateView(debugId, () => ({ frameId: frame.id, scopes, children, loading: false }))
    if (reveal && frame.relativePath) void useGoIDEStore.getState().openLocation(frame.relativePath, frame.line, frame.column || 1)
    await evaluateWatches(debugId, frame.id, token)
  }

  // Dopo variabili e frame, così la riga in pausa e i valori arrivano per primi.
  const loadGoroutines = async (debugId: string, token: number) => {
    updateView(debugId, () => ({ goroutinesLoading: true }))
    try {
      const overview = await getGoIDEDebugGoroutines(debugId)
      if (!isCurrentPause(debugId, token)) return
      updateView(debugId, (view) => {
        const last = view.timeline[view.timeline.length - 1]
        const sample = goroutineSample(overview, token, Date.now())
        // Un Refresh nella stessa pausa aggiorna l'ultimo punto invece di aggiungerne uno.
        const timeline = last?.pause === token ? [...view.timeline.slice(0, -1), sample] : [...view.timeline, sample].slice(-MAX_TIMELINE_SAMPLES)
        return { goroutines: overview, goroutinesLoading: false, timeline }
      })
    } catch (error) {
      if (isCurrentPause(debugId, token)) updateView(debugId, (view) => ({ goroutinesLoading: false, console: appendLines(view.console, 'error', `Goroutines: ${errorMessage(error)}`) }))
    }
  }

  const loadPause = async (debugId: string, preferredThread: number) => {
    const token = pauseTokens[debugId] ?? 0
    try {
      const threads = await listGoIDEDebugThreads(debugId)
      const threadId = threads.some((thread) => thread.id === preferredThread) ? preferredThread : threads[0]?.id ?? null
      const frames = threadId === null ? [] : await getGoIDEDebugStack(debugId, threadId)
      if (!isCurrentPause(debugId, token)) return
      updateView(debugId, () => ({ threads, threadId, frames }))
      const frame = preferredFrame(frames)
      if (frame) await loadFrame(debugId, frame, token, true)
      else updateView(debugId, () => ({ loading: false }))
      await loadGoroutines(debugId, token)
    } catch (error) {
      if (isCurrentPause(debugId, token)) updateView(debugId, (view) => ({ loading: false, console: appendLines(view.console, 'error', errorMessage(error)) }))
    }
  }

  const applyState = (info: GoIDEDebugSession) => {
    const previous = get().debuggers[info.id]
    pauseTokens[info.id] = (pauseTokens[info.id] ?? 0) + 1
    set((state) => {
      const base = previous ?? emptyView(info)
      const paused = info.state === 'stopped'
      let console = base.console
      if (info.state === 'terminated' && previous?.info.state !== 'terminated') {
        console = appendLines(console, info.error ? 'error' : 'console', info.error ? `Debugger stopped: ${info.error}` : 'Debug session finished.')
      }
      // In esecuzione i dati di pausa non valgono più: si svuotano per non mostrare valori vecchi.
      const view: GoIDEDebugView = paused
        ? { ...base, info, console, loading: true }
        : { ...base, info, console, frames: [], scopes: [], children: {}, watchValues: {}, frameId: null, loading: false, goroutines: null, goroutinesLoading: false }
      return { debuggers: { ...state.debuggers, [info.id]: view } }
    })
    if (info.state === 'stopped') void loadPause(info.id, info.threadId ?? 0)
  }

  const sendBreakpoints = async (sessionId: string, relativePath: string, lines: number[]) => {
    try {
      const states = await setGoIDEBreakpoints(sessionId, relativePath, lines)
      set((state) => ({ breakpoints: { ...state.breakpoints, [sessionId]: { ...state.breakpoints[sessionId], [relativePath]: states } } }))
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  }

  return {
    debuggers: {},
    activeBySession: {},
    breakpoints: {},
    watches: {},
    delve: {},
    error: null,

    start: async (request) => {
      ensureSubscribed((event) => get().handleEvent(event))
      set({ error: null })
      const sessionId = request.sessionId
      try {
        // Un server remoto è già un Delve in ascolto; attach e remote non compilano i file del progetto.
        if (request.mode !== 'remote') {
          const delve = await get().detectDelve(sessionId)
          if (!delve) return
          if (!delve.available) {
            if (await confirmDelveInstall()) await get().installDelve(sessionId)
            return
          }
        }
        if ((request.mode === 'debug' || request.mode === 'test') && !await useGoIDEStore.getState().saveAllDocuments(sessionId)) return
        const info = await startGoIDEDebug(request)
        set((state) => ({
          debuggers: { ...pruneFinished(state.debuggers, sessionId), [info.id]: { ...(state.debuggers[info.id] ?? emptyView(info)), request } },
          activeBySession: { ...state.activeBySession, [sessionId]: info.id },
        }))
        useGoIDEStore.getState().updateLayout({ bottomOpen: true })
        useGoIDELspStore.getState().showToolWindow('debug')
      } catch (error) {
        set({ error: errorMessage(error) })
        useGoIDEStore.setState({ error: errorMessage(error) })
      }
    },

    stop: async (debugId) => {
      try { await stopGoIDEDebug(debugId) } catch (error) { set({ error: errorMessage(error) }) }
    },

    restart: async (debugId) => {
      const view = get().debuggers[debugId]
      if (!view?.request) return
      if (view.info.state !== 'terminated') await get().stop(debugId)
      await get().start(view.request)
    },

    step: async (debugId, action) => {
      const view = get().debuggers[debugId]
      if (!view) return
      try {
        await stepGoIDEDebug(debugId, action, view.threadId ?? view.info.threadId ?? 0)
      } catch (error) {
        updateView(debugId, (current) => ({ console: appendLines(current.console, 'error', errorMessage(error)) }))
      }
    },

    selectDebugger: (sessionId, debugId) => set((state) => ({ activeBySession: { ...state.activeBySession, [sessionId]: debugId } })),

    selectThread: async (debugId, threadId) => {
      const token = pauseTokens[debugId] ?? 0
      if (!isCurrentPause(debugId, token)) return
      try {
        const frames = await getGoIDEDebugStack(debugId, threadId)
        if (!isCurrentPause(debugId, token)) return
        updateView(debugId, () => ({ threadId, frames }))
        const frame = preferredFrame(frames)
        if (frame) await loadFrame(debugId, frame, token, true)
      } catch (error) {
        updateView(debugId, (view) => ({ console: appendLines(view.console, 'error', errorMessage(error)) }))
      }
    },

    refreshGoroutines: async (debugId) => {
      const token = pauseTokens[debugId] ?? 0
      if (isCurrentPause(debugId, token)) await loadGoroutines(debugId, token)
    },

    selectFrame: async (debugId, frameId) => {
      const token = pauseTokens[debugId] ?? 0
      const frame = get().debuggers[debugId]?.frames.find((item) => item.id === frameId)
      if (!frame || !isCurrentPause(debugId, token)) return
      updateView(debugId, () => ({ frameId }))
      try {
        await loadFrame(debugId, frame, token, true)
      } catch (error) {
        updateView(debugId, (view) => ({ console: appendLines(view.console, 'error', errorMessage(error)) }))
      }
    },

    loadChildren: async (debugId, reference) => {
      const token = pauseTokens[debugId] ?? 0
      if (reference <= 0 || get().debuggers[debugId]?.children[reference]) return
      try {
        const variables = await getGoIDEDebugVariables(debugId, reference)
        if (isCurrentPause(debugId, token)) updateView(debugId, (view) => ({ children: { ...view.children, [reference]: variables } }))
      } catch (error) {
        updateView(debugId, (view) => ({ console: appendLines(view.console, 'error', errorMessage(error)) }))
      }
    },

    evaluate: async (debugId, expression) => {
      const trimmed = expression.trim()
      const view = get().debuggers[debugId]
      if (!trimmed || !view) return
      updateView(debugId, (current) => ({ console: appendLines(current.console, 'input', trimmed) }))
      if (view.info.state !== 'stopped') {
        updateView(debugId, (current) => ({ console: appendLines(current.console, 'error', 'Pause the program to evaluate expressions.') }))
        return
      }
      try {
        const result = await evaluateGoIDEDebug(debugId, trimmed, view.frameId ?? 0, 'repl')
        updateView(debugId, (current) => ({ console: appendLines(current.console, 'result', result.type ? `${result.result}  (${result.type})` : result.result) }))
      } catch (error) {
        updateView(debugId, (current) => ({ console: appendLines(current.console, 'error', errorMessage(error)) }))
      }
    },

    addWatch: (sessionId, expression) => {
      const trimmed = expression.trim()
      if (!trimmed || (get().watches[sessionId] ?? []).includes(trimmed)) return
      set((state) => ({ watches: { ...state.watches, [sessionId]: [...(state.watches[sessionId] ?? []), trimmed] } }))
      const debugId = get().activeBySession[sessionId]
      const view = debugId ? get().debuggers[debugId] : null
      if (debugId && view?.info.state === 'stopped' && view.frameId !== null) void evaluateWatches(debugId, view.frameId, pauseTokens[debugId] ?? 0)
    },

    removeWatch: (sessionId, expression) => set((state) => ({ watches: { ...state.watches, [sessionId]: (state.watches[sessionId] ?? []).filter((item) => item !== expression) } })),

    loadBreakpoints: async (sessionId) => {
      ensureSubscribed((event) => get().handleEvent(event))
      if (get().breakpoints[sessionId]) return
      try {
        const saved = await listGoIDEBreakpoints(sessionId)
        const byPath = Object.fromEntries(saved.map((file: GoIDEFileBreakpoints) => [file.relativePath, file.breakpoints]))
        set((state) => ({ breakpoints: { ...state.breakpoints, [sessionId]: { ...byPath, ...state.breakpoints[sessionId] } } }))
      } catch (error) {
        set({ error: errorMessage(error) })
      }
    },

    toggleBreakpoint: async (sessionId, relativePath, line) => {
      const current = linesOf(get().breakpoints[sessionId]?.[relativePath])
      const lines = current.includes(line) ? current.filter((item) => item !== line) : [...current, line].sort((left, right) => left - right)
      // Aggiornamento ottimistico: il pallino compare subito, Delve lo verifica dopo.
      set((state) => ({ breakpoints: { ...state.breakpoints, [sessionId]: { ...state.breakpoints[sessionId], [relativePath]: lines.map((item) => ({ line: item, verified: false })) } } }))
      await sendBreakpoints(sessionId, relativePath, lines)
    },

    setBreakpointLines: async (sessionId, relativePath, lines) => {
      const sorted = [...new Set(lines)].sort((left, right) => left - right)
      if (sameLines(sorted, linesOf(get().breakpoints[sessionId]?.[relativePath]))) return
      await sendBreakpoints(sessionId, relativePath, sorted)
    },

    detectDelve: async (sessionId) => {
      try {
        const info = await detectGoIDEDelve(sessionId)
        set((state) => ({ delve: { ...state.delve, [sessionId]: info } }))
        return info
      } catch (error) {
        set({ error: errorMessage(error) })
        useGoIDEStore.setState({ error: errorMessage(error) })
        return null
      }
    },

    installDelve: async (sessionId) => {
      try {
        await installGoIDEDelve(sessionId)
        useGoIDEStore.getState().updateLayout({ bottomOpen: true })
        useGoIDELspStore.getState().showToolWindow('run')
        return true
      } catch (error) {
        set({ error: errorMessage(error) })
        useGoIDEStore.setState({ error: errorMessage(error) })
        return false
      }
    },

    handleEvent: (event) => {
      if (!event.sessionId) return
      if (event.type === 'debug.state') {
        const info = event.payload as GoIDEDebugSession
        if (info?.id) applyState(info)
        return
      }
      if (event.type === 'debug.output') {
        const output = event.payload as GoIDEDebugOutput
        if (!output?.debugId || DELVE_NOISE.test(output.text)) return
        if (get().debuggers[output.debugId]) updateView(output.debugId, (view) => ({ console: appendLines(view.console, consoleCategory(output), output.text.replace(/\n$/, '')) }))
        return
      }
      if (event.type === 'debug.breakpoints') {
        const file = event.payload as GoIDEFileBreakpoints
        if (!file?.relativePath) return
        set((state) => ({ breakpoints: { ...state.breakpoints, [file.sessionId]: { ...state.breakpoints[file.sessionId], [file.relativePath]: file.breakpoints } } }))
      }
    },
  }
})
