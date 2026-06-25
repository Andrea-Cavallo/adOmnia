import { useEffect, useRef, useState } from 'react'
import { useSettingsStore } from '@/stores/settings'
import { useCollectionsStore } from '@/stores/collections'
import { useEnvironmentsStore } from '@/stores/environments'
import { useHostsStore } from '@/stores/hosts'
import { useTabsStore } from '@/stores/tabs'
import { useAppStore } from '@/stores/app'
import { useDevLogsStore } from '@/stores/devLogs'
import { getBackendDevLogs, clearBackendDevLogs } from '@/lib/devlogs-api'
import { requestPersistentStorage } from '@/lib/storageMaintenance'
import { GetStartupWindowChrome } from '@/wailsjs/go/main/App'

type WindowChromeMode = 'app' | 'app-xwayland' | 'system'

export interface AppInitResult {
  activeWindowChrome: WindowChromeMode | null
  commandPaletteOpen: boolean
  setCommandPaletteOpen: (open: boolean | ((prev: boolean) => boolean)) => void
}

export function useAppInit(): AppInitResult {
  const [activeWindowChrome, setActiveWindowChrome] = useState<WindowChromeMode | null>(null)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)

  const loadSettings     = useSettingsStore((s) => s.load)
  const settingsLoaded   = useSettingsStore((s) => s.loaded)
  const appearance       = useSettingsStore((s) => s.settings.appearance)
  const showWelcomeOnEmpty = useSettingsStore((s) => s.settings.general.showWelcomeOnEmptyWorkspace)
  const defaultStartupRail = useSettingsStore((s) => s.settings.general.defaultStartupRail)
  const backupWorkspaceOnStartup = useSettingsStore((s) => s.settings.general.backupWorkspaceOnStartup)
  const loadCollections  = useCollectionsStore((s) => s.load)
  const loadEnvironments = useEnvironmentsStore((s) => s.load)
  const loadHosts        = useHostsStore((s) => s.load)
  const loadTabs         = useTabsStore((s) => s.load)
  const setActiveRail    = useAppStore((s) => s.setActiveRail)
  const mergeBackendLogs = useDevLogsStore((s) => s.mergeBackendEntries)

  const collectionsLoaded      = useCollectionsStore((s) => s.loaded)
  const environmentsLoaded     = useEnvironmentsStore((s) => s.loaded)
  const collectionsLoadError   = useCollectionsStore((s) => s.loadError)
  const environmentsLoadError  = useEnvironmentsStore((s) => s.loadError)

  const backendLogsClearedRef = useRef(false)
  const startupRailAppliedRef = useRef(false)
  const backupDoneRef = useRef(false)

  // One-shot workspace backup on startup: snapshot the loaded collections and
  // environments before the session can overwrite them.
  useEffect(() => {
    if (backupDoneRef.current) return
    if (!backupWorkspaceOnStartup) return
    if (!collectionsLoaded || !environmentsLoaded) return
    if (collectionsLoadError || environmentsLoadError) return
    backupDoneRef.current = true
    try {
      const snapshot = {
        format: 'adomnia-workspace-backup',
        version: '1.0',
        backedUpAt: new Date().toISOString(),
        collections: useCollectionsStore.getState().collections,
        environments: useEnvironmentsStore.getState().environments,
      }
      localStorage.setItem('adomnia.workspace.backup', JSON.stringify(snapshot))
    } catch {
      // A failed backup must never block startup.
    }
  }, [
    backupWorkspaceOnStartup,
    collectionsLoaded,
    environmentsLoaded,
    collectionsLoadError,
    environmentsLoadError,
  ])

  // Apply the configured startup rail once, when settings first load.
  // The welcome-screen effect below can still override it for an empty workspace.
  useEffect(() => {
    if (!settingsLoaded || startupRailAppliedRef.current) return
    startupRailAppliedRef.current = true
    if (defaultStartupRail) {
      setActiveRail(defaultStartupRail as Parameters<typeof setActiveRail>[0])
    }
  }, [settingsLoaded, defaultStartupRail, setActiveRail])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const mode = await GetStartupWindowChrome()
        if (!cancelled) {
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

  useEffect(() => {
    if (activeWindowChrome === null && settingsLoaded) {
      setActiveWindowChrome(appearance.windowChrome ?? 'system')
    }
  }, [activeWindowChrome, appearance.windowChrome, settingsLoaded])

  useEffect(() => {
    const handler = (event: Event) => {
      const rail = (event as CustomEvent).detail
      if (typeof rail === 'string') setActiveRail(rail as Parameters<typeof setActiveRail>[0])
    }
    document.addEventListener('adomnia:set-rail', handler)
    return () => document.removeEventListener('adomnia:set-rail', handler)
  }, [setActiveRail])

  useEffect(() => {
    loadSettings()
    loadCollections()
    loadEnvironments()
    loadHosts()
    // Request persistent storage once — larger quota, no eviction under pressure.
    void requestPersistentStorage()
  }, [loadSettings, loadCollections, loadEnvironments, loadHosts])

  useEffect(() => {
    if (settingsLoaded) void loadTabs()
  }, [settingsLoaded, loadTabs])

  useEffect(() => {
    let cancelled = false
    const sync = async () => {
      try {
        const entries = await getBackendDevLogs()
        if (!cancelled) mergeBackendLogs(entries)
        if (!backendLogsClearedRef.current) {
          backendLogsClearedRef.current = true
          void clearBackendDevLogs()
        }
      } catch {
        // Dev logs must never break the shell
      }
    }
    void sync()
    const id = window.setInterval(sync, 1500)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [mergeBackendLogs])

  useEffect(() => {
    if (!collectionsLoaded || !environmentsLoaded) return
    if (collectionsLoadError || environmentsLoadError) return
    const collectionsEmpty = useCollectionsStore.getState().collections.length === 0
    const environmentsEmpty = useEnvironmentsStore.getState().environments.length === 0
    if (collectionsEmpty && environmentsEmpty && showWelcomeOnEmpty) {
      setActiveRail('welcome')
    }
  }, [
    collectionsLoaded,
    environmentsLoaded,
    collectionsLoadError,
    environmentsLoadError,
    showWelcomeOnEmpty,
    setActiveRail,
  ])

  return { activeWindowChrome, commandPaletteOpen, setCommandPaletteOpen }
}
