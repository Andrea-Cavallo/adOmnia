import { create } from 'zustand'
import type { DebugScenario, ScenarioEvidence } from '@/lib/devsession/debugScenario'

// ponytail: localStorage like the other API workspace stores; move to the .adomnia workspace export
// when scenarios need to travel with a team.
const STORAGE_KEY = 'adomnia.debugScenarios'

function load(): DebugScenario[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed as DebugScenario[] : []
  } catch {
    return []
  }
}

function save(scenarios: DebugScenario[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scenarios))
  } catch {
    // Quota or private mode: the scenarios stay in memory for this session.
  }
}

export interface ScenarioRunState {
  message: string
  error?: string
  done?: boolean
}

interface DebugScenariosState {
  scenarios: DebugScenario[]
  /** Progress of the runs in flight (or just finished), by scenario id. */
  runs: Record<string, ScenarioRunState>
  add: (scenario: DebugScenario) => void
  update: (id: string, patch: Partial<Omit<DebugScenario, 'id'>>) => void
  remove: (id: string) => void
  /** The new evidence becomes the last run, the old last run the term of comparison. */
  recordRun: (id: string, evidence: ScenarioEvidence) => void
  setRun: (id: string, run: ScenarioRunState | null) => void
}

export const useDebugScenariosStore = create<DebugScenariosState>((set, get) => {
  const commit = (scenarios: DebugScenario[]) => {
    save(scenarios)
    set({ scenarios })
  }
  return {
    scenarios: load(),
    runs: {},
    add: (scenario) => commit([scenario, ...get().scenarios]),
    update: (id, patch) => commit(get().scenarios.map((item) => (item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item))),
    remove: (id) => commit(get().scenarios.filter((item) => item.id !== id)),
    recordRun: (id, evidence) => commit(get().scenarios.map((item) => (item.id === id ? { ...item, previousRun: item.lastRun, lastRun: evidence } : item))),
    setRun: (id, run) => set((state) => {
      const { [id]: _, ...rest } = state.runs
      return { runs: run ? { ...rest, [id]: run } : rest }
    }),
  }
})
