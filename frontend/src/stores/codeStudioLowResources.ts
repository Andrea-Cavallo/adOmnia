import { settleResourceStops } from '@/lib/code-studio/resourceStops'
import { applySuspended, readPausedServices, writePausedServices, type PausableService } from '@/lib/code-studio/pausedServices'
import { setRustLowResources } from '@/lib/code-studio-api'
import { create } from 'zustand'
import { useCodeStudioStore } from './codeStudio'
import { useCodeStudioLspStore } from './codeStudioLsp'
import { useIdeLanguageServersStore } from './ideLanguageServers'
import { useCopilotStore } from './copilot'
import { useMilkStore } from './milk'
import { useClaudeCodeStore } from './claudeCode'
import { studioToast } from './codeStudioToast'

const AGENTS = { Copilot: useCopilotStore, milk: useMilkStore, 'Claude Code': useClaudeCodeStore } as const
const SNAPSHOT_KEY = 'adomnia.codeStudio.lowResources.restore.v1'
interface RestoreState {
  version: 1
  mode: 'normal' | 'auto'
  agents: Partial<Record<keyof typeof AGENTS, boolean>>
  staticcheck: boolean
  vulncheck: boolean
}
function readRestore(): RestoreState | null {
  try {
    const saved = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) ?? 'null') as RestoreState | null
    if (!saved || saved.version !== 1 || !['normal', 'auto'].includes(saved.mode) || typeof saved.staticcheck !== 'boolean' || typeof saved.vulncheck !== 'boolean' || !saved.agents || typeof saved.agents !== 'object') return null
    if (Object.entries(saved.agents).some(([key, value]) => !(key in AGENTS) || typeof value !== 'boolean')) return null
    return saved
  } catch { return null }
}
interface LowResourcesState {
  busy: boolean
  error: string | null
  restore: RestoreState | null
  /** What Low-Resource Mode pauses; everything else keeps running. */
  paused: PausableService[]
  setPaused: (services: PausableService[]) => Promise<void>
  activate: () => Promise<void>
  deactivate: (mode?: 'normal' | 'auto') => Promise<void>
  toggle: () => Promise<void>
}

/** Suspend optional work while keeping completion, navigation, diagnostics, runs and debug available. */
export const useCodeStudioLowResources = create<LowResourcesState>((set, get) => {
  const report = (failures: string[]) => {
    if (!failures.length) return false
    const error = `Low resources: ${failures.join('; ')}`
    set({ error })
    useCodeStudioStore.setState({ error })
    return true
  }
  /**
   * RS-9.5: l'opzione "Low resources" di rust-analyzer — proc-macro e build script (la parte più
   * pesante del server) spengono e riaccendono senza riavviarlo, per ogni sessione Rust del
   * progetto. Il resto dell'editor, la Run e il debug restano attivi.
   */
  const rustAnalyses = (enabled: boolean) => {
    const sessions = useCodeStudioStore.getState().sessions.filter(session => (session.project.units ?? []).some(unit => unit.language === 'rust'))
    return settleResourceStops(sessions.map(session => ({
      label: `${session.project.name}: rust-analyzer`,
      stop: async () => { await setRustLowResources(session.id, enabled) },
    })))
  }
  const restartAnalyses = async (legacy = false) => {
    const lsp = useCodeStudioLspStore.getState()
    const failures = await settleResourceStops(useCodeStudioStore.getState().sessions.map(session => ({
      label: `${session.project.name}: gopls`, stop: async () => {
        if (legacy) useCodeStudioLspStore.setState(state => ({ userStopped: { ...state.userStopped, [session.id]: false } }))
        if (lsp.status[session.id]?.state === 'ready') await lsp.restart(session.id, false)
        else await lsp.ensureStarted(session.id)
        const detail = useCodeStudioLspStore.getState().activity[session.id]
        if (detail?.error) throw new Error(detail.detail ?? detail.label)
      },
    })))
    // The previous implementation stopped every language server. Repair that state on exit.
    if (legacy) {
      for (const [sessionId, servers] of Object.entries(useIdeLanguageServersStore.getState().servers)) {
        for (const language of Object.keys(servers)) {
          useIdeLanguageServersStore.setState(state => ({ servers: { ...state.servers, [sessionId]: { ...state.servers[sessionId], [language]: { ...state.servers[sessionId][language], userStopped: false } } } }))
          // oxlint-disable-next-line eslint/no-await-in-loop -- language servers restart one at a time to avoid a CPU spike while leaving low-resource mode
          await useIdeLanguageServersStore.getState().ensureStarted(sessionId, language)
        }
      }
    }
    return failures
  }
  const initialRestore = readRestore()
  const initialPaused = readPausedServices()
  // A reload while Low-Resource Mode is on must keep the editor providers paused.
  applySuspended(initialRestore ? initialPaused : [])
  return {
    busy: false, error: null, restore: initialRestore, paused: initialPaused,
    setPaused: async (services) => {
      writePausedServices(services)
      set({ paused: services })
      // Already on: apply the new choice by restoring and pausing again.
      if (!get().busy && (get().restore || useCodeStudioLspStore.getState().preferences.resourceMode === 'low')) {
        await get().deactivate()
        await get().activate()
      }
    },
    activate: async () => {
      if (get().busy || get().restore) return
      // A low mode without a restore snapshot belongs to the earlier editor-only/stop-all mode.
      if (useCodeStudioLspStore.getState().preferences.resourceMode === 'low') { await get().deactivate(); return }
      set({ busy: true, error: null })
      try {
        const lsp = useCodeStudioLspStore.getState()
        const restore: RestoreState = { version: 1, mode: lsp.preferences.resourceMode === 'auto' ? 'auto' : 'normal', agents: {}, staticcheck: lsp.settings.staticcheck, vulncheck: lsp.settings.vulncheck }
        const paused = get().paused
        const agents = paused.includes('ai') ? Object.entries(AGENTS) : []
        const failures = await settleResourceStops(agents.map(([label, store]) => ({ label, stop: async () => {
          if (!store.getState().settings) await store.getState().ensure()
          const settings = store.getState().settings
          if (!settings) throw new Error(store.getState().error ?? 'Cannot read assistant settings')
          restore.agents[label as keyof typeof AGENTS] = settings.enabled
        } })))
        if (report(failures)) return
        // Only flags are persisted, never credentials or chat contents. Save before suspending anything.
        localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(restore))
        set({ restore })
        lsp.updatePreferences({ resourceMode: 'low' })
        applySuspended(paused)
        const pauseAnalyses = paused.includes('analyses')
        if (pauseAnalyses) {
          for (const session of useCodeStudioStore.getState().sessions) lsp.cancelLint(session.id)
          await lsp.updateSettings(null, { staticcheck: false, vulncheck: false })
        }
        const stops = await settleResourceStops(agents.map(([label, store]) => ({ label, stop: async () => {
          if (store.getState().settings?.enabled && !await store.getState().setEnabled(false)) throw new Error(store.getState().error ?? 'Could not suspend assistant')
        } })))
        const analyses = pauseAnalyses && (restore.staticcheck || restore.vulncheck) ? await restartAnalyses() : []
        // RS-9.5: con "Low resources" anche rust-analyzer perde proc-macro e build script.
        const rust = pauseAnalyses ? await rustAnalyses(true) : []
        if (!report([...stops, ...analyses, ...rust])) studioToast(`Low resources enabled. ${paused.length ? 'Paused: ' + paused.join(', ') + '.' : 'Nothing is paused.'} Everything else, Run and Debug remain available.`)
      } catch (error) { report([String(error)]) } finally { set({ busy: false }) }
    },
    deactivate: async (mode) => {
      if (get().busy) return
      set({ busy: true, error: null })
      applySuspended([])
      try {
        const restore = get().restore
        const lsp = useCodeStudioLspStore.getState()
        const legacy = !restore && lsp.preferences.resourceMode === 'low'
        const analysisChanged = restore && (lsp.settings.staticcheck !== restore.staticcheck || lsp.settings.vulncheck !== restore.vulncheck)
        lsp.updatePreferences({ resourceMode: mode ?? restore?.mode ?? 'normal' })
        if (restore) await lsp.updateSettings(null, { staticcheck: restore.staticcheck, vulncheck: restore.vulncheck })
        const agents = await settleResourceStops(Object.entries(restore?.agents ?? {}).map(([label, enabled]) => ({ label, stop: async () => {
          const store = AGENTS[label as keyof typeof AGENTS]
          if (!store.getState().settings) await store.getState().ensure()
          if (store.getState().settings?.enabled !== enabled && !await store.getState().setEnabled(enabled)) throw new Error(store.getState().error ?? 'Could not restore assistant')
        } })))
        const analyses = legacy || analysisChanged ? await restartAnalyses(legacy) : []
        // RS-9.5: ripristino dell'analisi pesante di rust-analyzer (proc-macro e build script).
        const rust = await rustAnalyses(false)
        if (report([...agents, ...analyses, ...rust])) return // Keep the snapshot for Retry.
        localStorage.removeItem(SNAPSHOT_KEY)
        set({ restore: null })
        studioToast('Normal resources restored. Previously enabled assistants and analyses are available again.')
      } catch (error) { report([String(error)]) } finally { set({ busy: false }) }
    },
    toggle: async () => {
      if (get().restore || useCodeStudioLspStore.getState().preferences.resourceMode === 'low') await get().deactivate()
      else await get().activate()
    },
  }
})
