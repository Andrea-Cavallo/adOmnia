import { create } from 'zustand'
import { subscribeGoIDEEvents, type GoIDEEvent } from '@/lib/goide-api'
import { startGoIDETests, listGoIDETestRuns, type GoIDETestResult, type GoIDETestRun, type GoIDETestRunRequest } from '@/lib/goide-tests-api'
import { requestForNode, rerunFailedRequest } from '@/components/goide/goStudioTestTree'
import { useGoIDEStore } from './goide'
import { useGoIDELspStore } from './goideLsp'

const MAX_RUNS_PER_SESSION = 10

interface GoIDETestsState {
  runs: Record<string, GoIDETestRun[]>
  selectedRun: Record<string, string | null>
  selectedNode: Record<string, string | null>
  onlyFailed: boolean
  /** Overlay di coverage nell'editor: si spegne senza toccare i file. */
  coverageVisible: boolean
  error: string | null
  start: (request: GoIDETestRunRequest) => Promise<void>
  rerunFailed: (sessionId: string) => Promise<void>
  rerunAll: (sessionId: string) => Promise<void>
  rerunNode: (sessionId: string, result: GoIDETestResult) => Promise<void>
  loadRuns: (sessionId: string) => Promise<void>
  selectRun: (sessionId: string, runId: string) => void
  selectNode: (sessionId: string, nodeId: string | null) => void
  toggleOnlyFailed: () => void
  toggleCoverage: () => void
  handleEvent: (event: GoIDEEvent) => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function upsert(runs: GoIDETestRun[], run: GoIDETestRun): GoIDETestRun[] {
  const others = runs.filter((item) => item.runId !== run.runId)
  return [run, ...others].sort((left, right) => right.startedAt.localeCompare(left.startedAt)).slice(0, MAX_RUNS_PER_SESSION)
}

/** Esecuzione selezionata nel pannello Tests, o la più recente della sessione. */
export function selectedTestRun(state: Pick<GoIDETestsState, 'runs' | 'selectedRun'>, sessionId: string): GoIDETestRun | null {
  const runs = state.runs[sessionId] ?? []
  const selected = state.selectedRun[sessionId]
  return runs.find((run) => run.runId === selected) ?? runs[0] ?? null
}

/** Coverage più recente della sessione, se l'overlay è attivo. */
export function visibleCoverage(state: Pick<GoIDETestsState, 'runs' | 'coverageVisible'>, sessionId: string) {
  if (!state.coverageVisible) return null
  return (state.runs[sessionId] ?? []).find((run) => run.coverage)?.coverage ?? null
}

let unsubscribe: (() => void) | null = null

export const useGoIDETestsStore = create<GoIDETestsState>((set, get) => ({
  runs: {},
  selectedRun: {},
  selectedNode: {},
  onlyFailed: false,
  coverageVisible: true,
  error: null,

  start: async (request) => {
    if (!unsubscribe) unsubscribe = subscribeGoIDEEvents((event) => get().handleEvent(event))
    set({ error: null })
    try {
      const run = await startGoIDETests(request)
      set((state) => ({
        runs: { ...state.runs, [run.sessionId]: upsert(state.runs[run.sessionId] ?? [], run) },
        selectedRun: { ...state.selectedRun, [run.sessionId]: run.runId },
        selectedNode: { ...state.selectedNode, [run.sessionId]: null },
      }))
      useGoIDEStore.getState().updateLayout({ bottomOpen: true })
      useGoIDELspStore.getState().showToolWindow('tests')
    } catch (error) {
      set({ error: errorMessage(error) })
      useGoIDEStore.setState({ error: errorMessage(error) })
    }
  },

  rerunFailed: async (sessionId) => {
    const run = selectedTestRun(get(), sessionId)
    const request = run ? rerunFailedRequest(run) : null
    if (!request) return set({ error: 'No failed tests to rerun.' })
    await get().start(request)
  },

  rerunAll: async (sessionId) => {
    const run = selectedTestRun(get(), sessionId)
    if (run) await get().start({ ...run.request })
  },

  rerunNode: async (sessionId, result) => {
    const run = selectedTestRun(get(), sessionId)
    if (run) await get().start(requestForNode(run, result))
  },

  loadRuns: async (sessionId) => {
    if (!unsubscribe) unsubscribe = subscribeGoIDEEvents((event) => get().handleEvent(event))
    try {
      const runs = await listGoIDETestRuns(sessionId)
      set((state) => ({ runs: { ...state.runs, [sessionId]: runs.slice(0, MAX_RUNS_PER_SESSION) } }))
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  },

  selectRun: (sessionId, runId) => set((state) => ({ selectedRun: { ...state.selectedRun, [sessionId]: runId }, selectedNode: { ...state.selectedNode, [sessionId]: null } })),
  selectNode: (sessionId, nodeId) => set((state) => ({ selectedNode: { ...state.selectedNode, [sessionId]: nodeId } })),
  toggleOnlyFailed: () => set((state) => ({ onlyFailed: !state.onlyFailed })),
  toggleCoverage: () => set((state) => ({ coverageVisible: !state.coverageVisible })),

  handleEvent: (event) => {
    if (event.type !== 'tests.updated' || !event.sessionId) return
    const run = event.payload as GoIDETestRun
    if (!run?.runId) return
    set((state) => ({ runs: { ...state.runs, [run.sessionId]: upsert(state.runs[run.sessionId] ?? [], run) } }))
  },
}))
