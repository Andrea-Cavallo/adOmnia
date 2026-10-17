import { buildStartupBackupSnapshot, persistStartupBackup, type StartupBackupSnapshot } from '@/lib/startupBackup'
import { useEffect, useRef, useState } from 'react'
import { useSettingsStore } from '@/stores/settings'
import { useCollectionsStore } from '@/stores/collections'
import { useEnvironmentsStore } from '@/stores/environments'
import { useHostsStore } from '@/stores/hosts'
import { useTabsStore } from '@/stores/tabs'
import { useAppStore } from '@/stores/app'
import { normalizeRailItem, type RailItem } from '@/lib/navigation'
import { loadUiSessionMemento } from '@/lib/uiSessionMemento'
import { useDevLogsStore } from '@/stores/devLogs'
import { getBackendDevLogsSince, clearBackendDevLogs } from '@/lib/devlogs-api'
import { visibleInterval } from '@/lib/visiblePolling'
import { requestPersistentStorage } from '@/lib/storageMaintenance'
import { GetStartupWindowChrome, LoadBootstrapState, LoadBootstrapStateV2 } from '@/wailsjs/go/main/App'
import { markStartup, recordStartupBootstrap } from '@/lib/startupPerformance'
import { scheduleStartupIdle } from '@/lib/startupIdle'

async function timedStartupLoad(load: () => void | Promise<void>): Promise<number> {
  const startedAt = performance.now()
  await load()
  return Math.round((performance.now() - startedAt) * 10) / 10
}

type WindowChromeMode = 'app' | 'app-xwayland' | 'system'

export interface AppInitResult {
  activeWindowChrome: WindowChromeMode | null
  commandPaletteOpen: boolean
  setCommandPaletteOpen: (open: boolean | ((prev: boolean) => boolean)) => void
  firstStableFrame: boolean
}

export function useAppInit(): AppInitResult {
  const [activeWindowChrome, setActiveWindowChrome] = useState<WindowChromeMode | null>(null)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [firstStableFrame, setFirstStableFrame] = useState(false)

  const loadSettings     = useSettingsStore((s) => s.load)
  const settingsLoaded   = useSettingsStore((s) => s.loaded)
  const appearance       = useSettingsStore((s) => s.settings.appearance)
  const showWelcomeOnEmpty = useSettingsStore((s) => s.settings.general.showWelcomeOnEmptyWorkspace)
  const startupBehavior = useSettingsStore((s) => s.settings.general.startupBehavior)
  const defaultStartupRail = useSettingsStore((s) => s.settings.general.defaultStartupRail)
  const backupWorkspaceOnStartup = useSettingsStore((s) => s.settings.general.backupWorkspaceOnStartup)
  const loadCollections  = useCollectionsStore((s) => s.load)
  const loadEnvironments = useEnvironmentsStore((s) => s.load)
  const loadHosts        = useHostsStore((s) => s.load)
  const loadTabs         = useTabsStore((s) => s.load)
  const loadDeferredTabs = useTabsStore((s) => s.loadDeferred)
  const setActiveRail    = useAppStore((s) => s.setActiveRail)
  const mergeBackendLogs = useDevLogsStore((s) => s.mergeBackendEntries)

  const collectionsLoaded      = useCollectionsStore((s) => s.loaded)
  const environmentsLoaded     = useEnvironmentsStore((s) => s.loaded)
  const hostsLoaded            = useHostsStore((s) => s.loaded)
  const tabsLoaded             = useTabsStore((s) => s.loaded)
  const collectionsLoadError   = useCollectionsStore((s) => s.loadError)
  const environmentsLoadError  = useEnvironmentsStore((s) => s.loadError)

  const backendLogsClearedRef = useRef(false)
  const startupRailAppliedRef = useRef(false)
  const startupMementoRef = useRef(loadUiSessionMemento())
  const explicitStartupRailRef = useRef<RailItem | null>(null)
  const backupDoneRef = useRef(false)
  const bootstrapStartedRef = useRef(false)
  const gatewayRestoredRef = useRef(false)
  const pendingBackupRef = useRef<StartupBackupSnapshot | null>(null)

  useEffect(() => {
    const ready = () => setFirstStableFrame(true)
    window.addEventListener('adomnia:first-stable-frame', ready, { once: true })
    return () => window.removeEventListener('adomnia:first-stable-frame', ready)
  }, [])

  // Capture the immutable Zustand snapshot as soon as the stores are coherent.
  // Serialization and backend I/O are deferred until after the first
  // stable frame, but later store mutations replace these references and cannot
  // alter the captured startup snapshot.
  useEffect(() => {
    if (pendingBackupRef.current || backupDoneRef.current) return
    if (!settingsLoaded) return
    if (!backupWorkspaceOnStartup) return
    if (!collectionsLoaded || !environmentsLoaded) return
    if (collectionsLoadError || environmentsLoadError) return
    pendingBackupRef.current = buildStartupBackupSnapshot({
      collections: useCollectionsStore.getState().collections,
      environments: useEnvironmentsStore.getState().environments,
      activeEnvId: useEnvironmentsStore.getState().activeEnvId,
    })
  }, [
    settingsLoaded,
    backupWorkspaceOnStartup,
    collectionsLoaded,
    environmentsLoaded,
    collectionsLoadError,
    environmentsLoadError,
  ])

  useEffect(() => {
    if (!firstStableFrame || backupDoneRef.current || !pendingBackupRef.current) return
    const snapshot = pendingBackupRef.current
    return scheduleStartupIdle(() => {
      backupDoneRef.current = true
      void persistStartupBackup(snapshot)
    })
  }, [firstStableFrame])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const mode = await GetStartupWindowChrome()
        if (!cancelled) {
          markStartup('startup:backend-ready')
          setActiveWindowChrome(
            mode === 'system' ? 'system' : mode === 'app-xwayland' ? 'app-xwayland' : 'app',
          )
        }
      } catch {
        // Fallback handled below
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  // Every window (main and detached Code Studio) reads the same flag to draw its own titlebar.
  useEffect(() => {
    useAppStore.getState().setAppWindowChrome(activeWindowChrome !== null && activeWindowChrome !== 'system')
  }, [activeWindowChrome])

  useEffect(() => {
    if (activeWindowChrome === null && settingsLoaded) {
      setActiveWindowChrome(appearance.windowChrome ?? 'system')
    }
  }, [activeWindowChrome, appearance.windowChrome, settingsLoaded])

  useEffect(() => {
    if (settingsLoaded) markStartup('startup:settings-loaded')
    if (collectionsLoaded) markStartup('startup:collections-loaded')
    if (environmentsLoaded) markStartup('startup:environments-loaded')
    if (hostsLoaded) markStartup('startup:hosts-loaded')
    if (tabsLoaded) markStartup('startup:tabs-loaded')
  }, [settingsLoaded, collectionsLoaded, environmentsLoaded, hostsLoaded, tabsLoaded])

  useEffect(() => {
    const handler = (event: Event) => {
      const rail = normalizeRailItem((event as CustomEvent).detail)
      if (rail) {
        explicitStartupRailRef.current = rail
        setActiveRail(rail)
      }
    }
    document.addEventListener('adomnia:set-rail', handler)
    return () => document.removeEventListener('adomnia:set-rail', handler)
  }, [setActiveRail])

  useEffect(() => {
    if (bootstrapStartedRef.current) return
    bootstrapStartedRef.current = true

    const bootstrap = async () => {
      try {
        const state = await LoadBootstrapStateV2()
        if (state.version !== 2) throw new Error(`Unsupported bootstrap version: ${state.version}`)
        markStartup('startup:bootstrap-v2-received')
        const [settingsDecodeMs, collectionsDecodeMs, environmentsDecodeMs, hostsDecodeMs] = await Promise.all([
          timedStartupLoad(() => loadSettings(state.settings)),
          timedStartupLoad(() => loadCollections(
            undefined,
            state.collectionsSchema === 3 ? state.collectionsIndex : undefined,
            state.collectionsSchema === 3 ? state.activeCollectionWorkspace : undefined,
          )),
          timedStartupLoad(() => loadEnvironments(state.environments)),
          timedStartupLoad(() => loadHosts(state.hosts)),
        ])
        const tabsDecodeMs = await timedStartupLoad(() => loadTabs(state.tabs))
        recordStartupBootstrap({
          version: state.version,
          total: state.payloadBytes.total,
          settings: state.payloadBytes.settings,
          collections: state.payloadBytes.collectionsIndex + state.payloadBytes.activeCollectionWorkspace,
          environments: state.payloadBytes.environments,
          hosts: state.payloadBytes.hosts,
          tabs: state.payloadBytes.tabs,
          settingsDecodeMs,
          collectionsDecodeMs,
          environmentsDecodeMs,
          hostsDecodeMs,
          tabsDecodeMs,
        })
        markStartup('startup:bootstrap-v2-applied')
        return
      } catch {
        // Continue with the string envelope supported by older builds.
      }

      try {
        const state = await LoadBootstrapState()
        if (state.version !== 1) throw new Error(`Unsupported bootstrap version: ${state.version}`)
        await Promise.all([
          loadSettings(state.settings),
          loadCollections(
            state.collections,
            state.collectionsSchema === 3 ? state.collectionsIndex : undefined,
            state.collectionsSchema === 3 ? state.activeCollectionWorkspace : undefined,
          ),
          loadEnvironments(state.environments),
          loadHosts(state.hosts),
        ])
        await loadTabs(state.tabs)
      } catch {
        await Promise.all([loadSettings(), loadCollections(), loadEnvironments(), loadHosts()])
        await loadTabs()
      }
    }

    void bootstrap()
  }, [loadSettings, loadCollections, loadEnvironments, loadHosts, loadTabs])

  useEffect(() => {
    if (!firstStableFrame) return
    return scheduleStartupIdle(() => {
      void Promise.all([
        requestPersistentStorage(),
        loadDeferredTabs(),
      ])
    })
  }, [firstStableFrame, loadDeferredTabs])

  // Input latency is measured only while a performance scenario recording is
  // active (docs/PERFORMANCE.md); the module is otherwise completely inert.
  useEffect(() => {
    if (!firstStableFrame) return
    return scheduleStartupIdle(() => {
      void import('@/lib/inputLatency')
        .then(({ maybeStartInputLatencyCapture }) => maybeStartInputLatencyCapture())
        .catch(() => undefined)
    })
  }, [firstStableFrame])

  useEffect(() => {
    if (!settingsLoaded || !firstStableFrame || gatewayRestoredRef.current) return
    const ai = useSettingsStore.getState().settings.ai
    if (!ai.enabled || !ai.gatewayEnabled) return
    gatewayRestoredRef.current = true
    return scheduleStartupIdle(() => {
      // A locked Vault or unavailable provider must not delay the desktop
      // shell. The Settings status remains stopped and lets the user retry.
      void import('@/lib/aiEngine').then(({ restoreAIGateway }) => restoreAIGateway()).catch(() => undefined)
    })
  }, [firstStableFrame, settingsLoaded])

  useEffect(() => {
    if (!firstStableFrame) return
    let cancelled = false
    // Byte già letti del file dei log: ogni giro legge solo le righe nuove.
    let offset = 0
    const sync = async () => {
      try {
        const chunk = await getBackendDevLogsSince(offset)
        if (cancelled) return
        offset = chunk.next
        mergeBackendLogs(chunk.entries)
        if (!backendLogsClearedRef.current) {
          backendLogsClearedRef.current = true
          await clearBackendDevLogs()
          offset = 0
        }
      } catch {
        // Dev logs must never break the shell
      }
    }
    void sync()
    const stop = visibleInterval(() => { void sync() }, 1500)
    return () => {
      cancelled = true
      stop()
    }
  }, [firstStableFrame, mergeBackendLogs])

  // Resolve startup navigation exactly once. The persisted rail has already
  // hydrated the Zustand store synchronously, so returning users never render
  // Welcome before their actual destination. Async state is only needed for
  // the first-run/empty-workspace fallback.
  useEffect(() => {
    if (startupRailAppliedRef.current) return
    if (!settingsLoaded || !collectionsLoaded || !environmentsLoaded) return

    startupRailAppliedRef.current = true
    const explicitRail = explicitStartupRailRef.current
    // Re-read only when startup began without a memento: a very fast user
    // navigation before async stores finish loading must win over fallbacks.
    const restoredRail = (startupMementoRef.current ?? loadUiSessionMemento())?.activeRail ?? null
    const configuredRail = normalizeRailItem(defaultStartupRail) ?? 'collections'
    const collectionsEmpty = useCollectionsStore.getState().collections.length === 0
    const environmentsEmpty = useEnvironmentsStore.getState().environments.length === 0

    const startupRail = explicitRail
      ?? (startupBehavior === 'fixed' ? configuredRail : null)
      ?? restoredRail
      ?? (collectionsEmpty && environmentsEmpty && showWelcomeOnEmpty ? 'welcome' : configuredRail)

    setActiveRail(startupRail)
  }, [
    settingsLoaded,
    collectionsLoaded,
    environmentsLoaded,
    startupBehavior,
    defaultStartupRail,
    showWelcomeOnEmpty,
    setActiveRail,
  ])

  return { activeWindowChrome, commandPaletteOpen, setCommandPaletteOpen, firstStableFrame }
}
