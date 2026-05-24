import { useEffect, useRef, useState, useCallback, Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Titlebar } from '@/components/layout/Titlebar'
import { Rail } from '@/components/layout/Rail'
import { Sidebar } from '@/components/layout/Sidebar'
import { MainArea } from '@/components/layout/MainArea'
import { StatusBar } from '@/components/layout/StatusBar'
import { ThemeProvider } from '@/components/themes/ThemeProvider'
import { DevLogOverlay } from '@/components/ui/DevLogOverlay'
import { useSettingsStore } from '@/stores/settings'
import { useCollectionsStore } from '@/stores/collections'
import { useEnvironmentsStore } from '@/stores/environments'
import { useHostsStore } from '@/stores/hosts'
import { useTabsStore } from '@/stores/tabs'
import { useAppStore } from '@/stores/app'
import { useDevLogsStore } from '@/stores/devLogs'
import { clearBackendDevLogs, getBackendDevLogs } from '@/lib/devlogs-api'
import { importCollectionsFromText } from '@/lib/collectionTransfer'
import { migrateCollections } from '@/stores/collections'
import { getUIFontStack } from '@/lib/uiFonts'
import { GetStartupWindowChrome } from '@/wailsjs/go/main/App'
import { UploadCloud } from 'lucide-react'

type WindowChromeMode = 'app' | 'app-xwayland' | 'system'
import { loadDefaultPostmanDemo } from '@/lib/demoWorkspace'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-surface-0 p-8 font-mono text-error">
          <h2 className="mb-3 text-base font-semibold">Something went wrong</h2>
          <p className="max-w-xl text-xs leading-5 text-text-2">
            adOmnia hit a recoverable UI error. Your local data was not sent anywhere.
            Try recovering this view, or reload the app if the problem keeps happening.
          </p>
          <pre className="mt-3 whitespace-pre-wrap text-xs text-error/80">{this.state.error.message}</pre>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-5 h-8 rounded-md bg-accent px-4 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
          >
            Try to recover
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

const FONT_SIZE_MAP = { small: '12px', medium: '15px', large: '20px' } as const
const MONO_SIZE_MAP = { small: '11px', medium: '14px', large: '19px' } as const
const DENSITY_SCALE = { compact: '0.85', comfortable: '1', spacious: '1.2' } as const

function App() {
  const loadSettings = useSettingsStore((s) => s.load)
  const settingsLoaded = useSettingsStore((s) => s.loaded)
  const loadCollections = useCollectionsStore((s) => s.load)
  const loadEnvironments = useEnvironmentsStore((s) => s.load)
  const loadHosts = useHostsStore((s) => s.load)
  const loadTabs = useTabsStore((s) => s.load)
  const newTab = useTabsStore((s) => s.newTab)
  const setActiveTab = useTabsStore((s) => s.setActiveTab)
  const appearance = useSettingsStore((s) => s.settings.appearance)
  const showWelcomeOnEmptyWorkspace = useSettingsStore((s) => s.settings.general.showWelcomeOnEmptyWorkspace)
  const devLogVisible = useAppStore((s) => s.devToolsVisible)
  const toggleDevTools = useAppStore((s) => s.toggleDevTools)
  const setActiveRail = useAppStore((s) => s.setActiveRail)
  const mergeBackendLogs = useDevLogsStore((s) => s.mergeBackendEntries)
  const backendLogsClearedRef = useRef(false)
  const [activeWindowChrome, setActiveWindowChrome] = useState<WindowChromeMode | null>(null)

  useEffect(() => {
    let cancelled = false
    const loadStartupWindowChrome = async () => {
      try {
        const mode = await GetStartupWindowChrome()
        if (!cancelled) {
          setActiveWindowChrome(mode === 'system' ? 'system' : mode === 'app-xwayland' ? 'app-xwayland' : 'app')
        }
      } catch {
        // Browser-only fallback is handled after settings finish loading.
      }
    }
    void loadStartupWindowChrome()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (activeWindowChrome === null && settingsLoaded) {
      setActiveWindowChrome(appearance.windowChrome ?? 'app')
    }
  }, [activeWindowChrome, appearance.windowChrome, settingsLoaded])

  useEffect(() => {
    const html = document.documentElement
    if (appearance.theme === 'light') {
      html.classList.remove('dark')
      html.classList.add('light')
    } else {
      html.classList.add('dark')
      html.classList.remove('light')
    }
  }, [appearance.theme])

  useEffect(() => {
    const handler = (event: Event) => {
      const rail = (event as CustomEvent).detail
      if (typeof rail === 'string') setActiveRail(rail as Parameters<typeof setActiveRail>[0])
    }
    document.addEventListener('adomnia:set-rail', handler)
    return () => document.removeEventListener('adomnia:set-rail', handler)
  }, [setActiveRail])

  // Apply font size
  useEffect(() => {
    const root = document.documentElement.style
    root.setProperty('--font-ui', getUIFontStack(appearance.uiFont))
    root.setProperty('--app-font-size', FONT_SIZE_MAP[appearance.fontSize] ?? '15px')
    root.setProperty('--app-mono-size', MONO_SIZE_MAP[appearance.monoFontSize ?? appearance.fontSize] ?? '14px')
  }, [appearance.uiFont, appearance.fontSize, appearance.monoFontSize])

  // Apply density scale
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--density-scale',
      DENSITY_SCALE[appearance.density] ?? '1',
    )
  }, [appearance.density])

  // Global font and density
  useEffect(() => {
    const fontSize = FONT_SIZE_MAP[appearance.fontSize] ?? '15px'
    const scale = DENSITY_SCALE[appearance.density] ?? '1'
    document.documentElement.style.fontSize = `calc(${fontSize} * ${scale})`
  }, [appearance.fontSize, appearance.density])

  const collectionsLoaded = useCollectionsStore((s) => s.loaded)
  const environmentsLoaded = useEnvironmentsStore((s) => s.loaded)
  const collectionsLoadError = useCollectionsStore((s) => s.loadError)
  const environmentsLoadError = useEnvironmentsStore((s) => s.loadError)

  useEffect(() => {
    loadSettings()
    loadCollections()
    loadEnvironments()
    loadHosts()
  }, [loadSettings, loadCollections, loadEnvironments, loadHosts])

  useEffect(() => {
    if (settingsLoaded) void loadTabs()
  }, [settingsLoaded, loadTabs])

  useEffect(() => {
    let cancelled = false
    const syncBackendLogs = async () => {
      try {
        const entries = await getBackendDevLogs()
        if (!cancelled) mergeBackendLogs(entries)
        if (!backendLogsClearedRef.current) {
          backendLogsClearedRef.current = true
          void clearBackendDevLogs()
        }
      } catch {
        // Dev logs must never break the app shell.
      }
    }
    void syncBackendLogs()
    const id = window.setInterval(syncBackendLogs, 1500)
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
    if (collectionsEmpty && environmentsEmpty && loadDefaultPostmanDemo()) {
      setActiveRail('collections')
      return
    }
    if (collectionsEmpty && environmentsEmpty && showWelcomeOnEmptyWorkspace) {
      setActiveRail('welcome')
    }
  }, [collectionsLoaded, environmentsLoaded, collectionsLoadError, environmentsLoadError, showWelcomeOnEmptyWorkspace, setActiveRail])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault()
        newTab()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        document.dispatchEvent(new CustomEvent('adomnia:save-active-tab'))
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        setActiveRail('settings')
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '1') {
        e.preventDefault()
        setActiveRail('collections')
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        useAppStore.getState().toggleSidebar()
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        toggleDevTools()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [newTab, setActiveRail, toggleDevTools])

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      // button 3 = back, button 4 = forward (side mouse buttons)
      if (e.button !== 3 && e.button !== 4) return
      e.preventDefault()
      const { tabs, activeTabId } = useTabsStore.getState()
      if (tabs.length < 2) return
      const idx = tabs.findIndex((t) => t.id === activeTabId)
      if (idx === -1) return
      if (e.button === 3) {
        const prev = tabs[idx - 1]
        if (prev) setActiveTab(prev.id)
      } else {
        const next = tabs[idx + 1]
        if (next) setActiveTab(next.id)
      }
    }
    window.addEventListener('mousedown', handleMouseDown)
    return () => window.removeEventListener('mousedown', handleMouseDown)
  }, [setActiveTab])

  // ── Global drag-and-drop collection import ──────────────────────────────────
  const importCollection = useCollectionsStore((s) => s.importCollection)
  const [dragOver, setDragOver] = useState(false)
  const [dropFeedback, setDropFeedback] = useState<{ msg: string; ok: boolean } | null>(null)
  const dragCounter = useRef(0)

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current++
    if (e.dataTransfer.types.includes('Files')) setDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current--
    if (dragCounter.current <= 0) { dragCounter.current = 0; setDragOver(false) }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    dragCounter.current = 0

    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.name.endsWith('.json') || f.name.endsWith('.yaml') || f.name.endsWith('.yml') || f.name.endsWith('.adomnia')
    )
    if (!files.length) {
      setDropFeedback({ msg: 'No collection file detected. Drop .json, .yaml or .adomnia files.', ok: false })
      setTimeout(() => setDropFeedback(null), 3000)
      return
    }

    let totalImported = 0
    let workspaceImported = false
    const errors: string[] = []

    for (const file of files) {
      try {
        const text = await file.text()
        // Detect full workspace bundle (version:2 internal format or adomnia-workspace format)
        let parsed: Record<string, unknown> | null = null
        try { parsed = JSON.parse(text) as Record<string, unknown> } catch { /* not JSON */ }
        const isWorkspace = parsed !== null &&
          Array.isArray(parsed.collections) &&
          (parsed.version === 2 || parsed.format === 'adomnia-workspace')

        if (isWorkspace && parsed) {
          if (Array.isArray(parsed.openTabs)) {
            useTabsStore.setState({ tabs: parsed.openTabs as never, activeTabId: (parsed.activeTabId as string | null) ?? (parsed.openTabs as {id:string}[])[0]?.id ?? null })
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          useCollectionsStore.setState({ collections: migrateCollections(parsed.collections as any[]), loaded: true })
          useCollectionsStore.getState().save()
          if (Array.isArray(parsed.environments)) {
            useEnvironmentsStore.setState({ environments: parsed.environments as never, activeEnvId: (parsed.activeEnvId as string | null) ?? null, loaded: true })
            useEnvironmentsStore.getState().save()
          }
          if (parsed.settings) {
            useSettingsStore.setState({ settings: parsed.settings as never, loaded: true })
            useSettingsStore.getState().save()
          }
          if (Array.isArray(parsed.flows)) localStorage.setItem('adomnia.flows.v1', JSON.stringify(parsed.flows))
          if (parsed.dockerLab) localStorage.setItem('adomnia.dockerlab.last', JSON.stringify(parsed.dockerLab))
          if (parsed.websocket) localStorage.setItem('adomnia.websocket', JSON.stringify(parsed.websocket))
          totalImported += (parsed.collections as unknown[]).length
          workspaceImported = true
        } else {
          const result = importCollectionsFromText(text)
          result.collections.forEach((c) => importCollection(c))
          totalImported += result.collections.length
        }
      } catch (err: unknown) {
        errors.push(`${file.name}: ${err instanceof Error ? err.message : 'Import failed'}`)
      }
    }

    if (totalImported > 0) {
      setActiveRail('collections')
      const label = workspaceImported ? 'Workspace imported' : `Imported ${totalImported} collection${totalImported > 1 ? 's' : ''}`
      setDropFeedback({ msg: `${label} successfully.`, ok: true })
    } else {
      setDropFeedback({ msg: errors[0] || 'Import failed.', ok: false })
    }
    setTimeout(() => setDropFeedback(null), 3500)
  }, [importCollection, setActiveRail])

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <div
          className="h-screen w-screen flex flex-col overflow-hidden bg-surface-0 relative"
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {activeWindowChrome !== 'system' && <Titlebar />}
          <div className="flex flex-1 min-h-0">
            <Rail />
            <Sidebar />
            <ErrorBoundary>
              <MainArea />
            </ErrorBoundary>
          </div>
          <StatusBar />

          {/* Drop overlay */}
          {dragOver && (
            <div className="absolute inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-none">
              <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-accent bg-surface-1 p-8 shadow-2xl">
                <UploadCloud size={48} strokeWidth={1.5} className="text-accent" />
                <p className="text-sm font-semibold text-text-1">Drop to import collection</p>
                <p className="text-[10px] text-text-3">Postman, Insomnia, Bruno, OpenAPI, adOmnia</p>
              </div>
            </div>
          )}

          {/* Import feedback toast */}
          {dropFeedback && (
            <div className={`absolute bottom-16 left-1/2 z-[9999] -translate-x-1/2 rounded-md border px-4 py-2 text-xs font-medium shadow-xl transition-all ${dropFeedback.ok ? 'border-success/30 bg-success/15 text-success' : 'border-error/30 bg-error/15 text-error'}`}>
              {dropFeedback.msg}
            </div>
          )}
        </div>
        <DevLogOverlay visible={devLogVisible} onClose={toggleDevTools} />
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default App
