import { create } from 'zustand'
import { Events } from '@wailsio/runtime'
import {
  getLiveSnapshot, setLivePort, stepLiveSession, stopLiveSession,
  type DebugAction, type LiveEvent,
} from '@/lib/devsession-api'
import { applyLiveEvent, emptyModel, modelFromSnapshot, type LiveModel, type ServiceTarget } from './devSessionModel'

const PREFS_KEY = 'adomnia.devsession'

/** Progress of a Debug Request, shown in the response area of its tab. */
export interface DebugRequestProgress {
  step: 'service' | 'debugger' | 'ready' | 'sending'
  message: string
  error?: string
}

export interface DevSessionPrefs {
  /** Add X-AdOmnia-Request-ID to requests sent to a live service. */
  correlationHeader: boolean
  /** Open the Split Debug View when a request stops at a breakpoint. */
  autoSplitView: boolean
  /** Selected target per service name. */
  targets: Record<string, ServiceTarget>
  /** Services seen at least once: Debug Request is offered for them even when stopped. */
  knownServices: Record<string, { root: string }>
  /** Optional readiness path per service (/healthz): Debug Request waits for it. */
  healthPaths: Record<string, string>
}

const defaultPrefs: DevSessionPrefs = { correlationHeader: true, autoSplitView: true, targets: {}, knownServices: {}, healthPaths: {} }

function loadPrefs(): DevSessionPrefs {
  try {
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<DevSessionPrefs> | null
    return { ...defaultPrefs, ...(stored ?? {}), targets: { ...(stored?.targets ?? {}) }, knownServices: { ...(stored?.knownServices ?? {}) }, healthPaths: { ...(stored?.healthPaths ?? {}) } }
  } catch {
    return defaultPrefs
  }
}

function savePrefs(prefs: DevSessionPrefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* private mode: prefs stay in memory */ }
}

interface DevSessionState extends LiveModel {
  ready: boolean
  /** Session the debug bar follows when several are live. */
  focusedSessionId: string | null
  prefs: DevSessionPrefs
  progress: Record<string, DebugRequestProgress>
  /** Split Debug View: the tab whose request is shown next to the paused code. */
  splitTabId: string | null
  error: string
  apply: (event: LiveEvent) => void
  load: () => Promise<void>
  focus: (sessionId: string | null) => void
  step: (sessionId: string, action: DebugAction) => Promise<void>
  stop: (sessionId: string) => Promise<void>
  setPort: (sessionId: string, port: number) => Promise<void>
  setPrefs: (patch: Partial<DevSessionPrefs>) => void
  setTarget: (service: string, target: ServiceTarget) => void
  setProgress: (tabId: string, progress: DebugRequestProgress | null) => void
  openSplit: (tabId: string | null) => void
  clearError: () => void
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export const useDevSessionStore = create<DevSessionState>((set, get) => ({
  ...emptyModel(),
  ready: false,
  focusedSessionId: null,
  prefs: loadPrefs(),
  progress: {},
  splitTabId: null,
  error: '',
  apply: (event) => {
    set((state) => applyLiveEvent(state, event))
    const session = event.type === 'service.started' ? event.payload as { service?: string; projectRoot?: string } : null
    if (session?.service && !get().prefs.knownServices[session.service]) {
      get().setPrefs({ knownServices: { ...get().prefs.knownServices, [session.service]: { root: session.projectRoot ?? '' } } })
    }
  },
  load: async () => {
    try {
      const snapshot = await getLiveSnapshot()
      set({ ...modelFromSnapshot(snapshot), ready: true })
    } catch (error) {
      set({ ready: true, error: message(error) })
    }
  },
  focus: (sessionId) => set({ focusedSessionId: sessionId }),
  step: async (sessionId, action) => {
    try { await stepLiveSession(sessionId, action) } catch (error) { set({ error: message(error) }) }
  },
  stop: async (sessionId) => {
    try { await stopLiveSession(sessionId) } catch (error) { set({ error: message(error) }) }
  },
  setPort: async (sessionId, port) => {
    try { await setLivePort(sessionId, port) } catch (error) { set({ error: message(error) }) }
  },
  setPrefs: (patch) => {
    const prefs = { ...get().prefs, ...patch }
    savePrefs(prefs)
    set({ prefs })
  },
  setTarget: (service, target) => get().setPrefs({ targets: { ...get().prefs.targets, [service]: target } }),
  setProgress: (tabId, progress) => set((state) => {
    const { [tabId]: _dropped, ...rest } = state.progress
    return { progress: progress ? { ...rest, [tabId]: progress } : rest }
  }),
  openSplit: (tabId) => set({ splitTabId: tabId }),
  clearError: () => set({ error: '' }),
}))

/** Subscribes to backend events; call once at app start. */
export function startDevSessionSync(): () => void {
  const off = Events.On('devsession:event', (event) => {
    const data = event.data as LiveEvent | LiveEvent[] | undefined
    for (const item of Array.isArray(data) ? data : data ? [data] : []) useDevSessionStore.getState().apply(item)
  })
  void useDevSessionStore.getState().load()
  return off
}
