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
import { useTabsStore } from '@/stores/tabs'
import { useAppStore } from '@/stores/app'
import { useDevLogsStore } from '@/stores/devLogs'
import { loadForgeCoreDemo } from '@/lib/demoWorkspace'
import { clearBackendDevLogs, getBackendDevLogs } from '@/lib/devlogs-api'
import { getBuiltinThemes, getExtendedBuiltinThemes, getThemes, setActiveThemeId } from '@/lib/themes-api'
import { useThemesStore } from '@/stores/themes'
import { importCollectionsFromText } from '@/lib/collectionTransfer'
import { getAppIconForTheme } from '@/lib/brandAssets'
import type { Theme } from '@/stores/themes'
import { getUIFontStack } from '@/lib/uiFonts'

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
        <div style={{ padding: 32, color: '#f87171', fontFamily: 'monospace', background: '#0f0f0f', minHeight: '100vh' }}>
          <h2 style={{ marginBottom: 12, fontSize: 16 }}>Something went wrong</h2>
          <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', opacity: 0.8 }}>{this.state.error.message}</pre>
          <pre style={{ fontSize: 11, marginTop: 12, whiteSpace: 'pre-wrap', opacity: 0.5 }}>{this.state.error.stack}</pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: 20, padding: '6px 16px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
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

function applyThemeVariables(theme: Theme) {
  const root = document.documentElement.style
  Object.entries(theme.colors).forEach(([key, value]) => root.setProperty(`--color-${key}`, value))
  Object.entries(theme.spacing).forEach(([key, value]) => root.setProperty(`--spacing-${key}`, value))
  Object.entries(theme.radii).forEach(([key, value]) => root.setProperty(`--radius-${key}`, value))
  Object.entries(theme.shadows).forEach(([key, value]) => root.setProperty(`--shadow-${key}`, value))
  if (theme.fonts.sans) root.setProperty('--font-sans', theme.fonts.sans)
  if (theme.fonts.mono) root.setProperty('--font-mono', theme.fonts.mono)
  if (theme.fonts.serif) root.setProperty('--font-serif', theme.fonts.serif)
}

function syncFavicon(themeId: string) {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.href = getAppIconForTheme(themeId)
}

function App() {
  const loadSettings = useSettingsStore((s) => s.load)
  const loadCollections = useCollectionsStore((s) => s.load)
  const loadEnvironments = useEnvironmentsStore((s) => s.load)
  const newTab = useTabsStore((s) => s.newTab)
  const appearance = useSettingsStore((s) => s.settings.appearance)
  const defaultStartupRail = useSettingsStore((s) => s.settings.general.defaultStartupRail)
  const devLogVisible = useAppStore((s) => s.devToolsVisible)
  const toggleDevTools = useAppStore((s) => s.toggleDevTools)
  const setActiveRail = useAppStore((s) => s.setActiveRail)
  const activeRail = useAppStore((s) => s.activeRail)
  const mergeBackendLogs = useDevLogsStore((s) => s.mergeBackendEntries)
  const activeThemeId = useThemesStore((s) => s.activeThemeId)
  const setStoreActiveThemeId = useThemesStore((s) => s.setActiveThemeId)
  const backendLogsClearedRef = useRef(false)
  const soapPreviousThemeRef = useRef<string | null>(null)

  // Apply theme (dark/light)
  useEffect(() => {
    const html = document.documentElement
    if (appearance.theme === 'light') {
      html.classList.remove('dark')
      html.classList.add('light')
    } else {
      html.classList.add('dark')
      html.classList.remove('light')
    }
    const targetThemeId = appearance.theme === 'light' ? 'builtin-light' : 'builtin-dark'
    getBuiltinThemes().then((themes) => {
      const theme = themes.find((t) => t.id === targetThemeId)
      if (!theme) return
      Object.entries(theme.colors).forEach(([key, value]) => {
        document.documentElement.style.setProperty(`--color-${key}`, value)
      })
      setStoreActiveThemeId(targetThemeId)
      void setActiveThemeId(targetThemeId)
    }).catch(() => {})
  }, [appearance.theme, setStoreActiveThemeId])

  useEffect(() => {
    let cancelled = false
    const applyThemeById = async (id: string) => {
      const [userThemes, builtins, extended] = await Promise.all([
        getThemes(),
        getBuiltinThemes(),
        getExtendedBuiltinThemes(),
      ])
      if (cancelled) return
      const theme = [...userThemes, ...builtins, ...extended].find((t) => t.id === id)
      if (!theme) return
      applyThemeVariables(theme)
      syncFavicon(theme.id)
      setStoreActiveThemeId(theme.id)
    }

    if (activeRail === 'soap') {
      if (!soapPreviousThemeRef.current) {
        soapPreviousThemeRef.current = activeThemeId || (appearance.theme === 'light' ? 'builtin-light' : 'builtin-dark')
      }
      void applyThemeById('builtin-win95')
      return () => {
        cancelled = true
      }
    }

    const previous = soapPreviousThemeRef.current
    if (previous) {
      soapPreviousThemeRef.current = null
      void applyThemeById(previous)
    }

    return () => {
      cancelled = true
    }
  }, [activeRail, activeThemeId, appearance.theme, setStoreActiveThemeId])

  useEffect(() => {
    localStorage.setItem('adomnia.defaultRail', defaultStartupRail)
  }, [defaultStartupRail])

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
  }, [loadSettings, loadCollections, loadEnvironments])

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
    if (collectionsEmpty && environmentsEmpty) {
      loadForgeCoreDemo()
    }
  }, [collectionsLoaded, environmentsLoaded, collectionsLoadError, environmentsLoadError])

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
    const errors: string[] = []

    for (const file of files) {
      try {
        const text = await file.text()
        const result = importCollectionsFromText(text)
        result.collections.forEach((c) => importCollection(c))
        totalImported += result.collections.length
      } catch (err: unknown) {
        errors.push(`${file.name}: ${err instanceof Error ? err.message : 'Import failed'}`)
      }
    }

    if (totalImported > 0) {
      setActiveRail('collections')
      setDropFeedback({ msg: `Imported ${totalImported} collection${totalImported > 1 ? 's' : ''} successfully.`, ok: true })
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
          <Titlebar />
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
              <div className="flex flex-col items-center gap-3 p-8 bg-surface-1 border-2 border-dashed border-accent rounded-2xl shadow-2xl">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" strokeLinecap="round" strokeLinejoin="round"/>
                  <polyline points="7 10 12 15 17 10" strokeLinecap="round" strokeLinejoin="round"/>
                  <line x1="12" y1="15" x2="12" y2="3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <p className="text-sm font-semibold text-text-1">Drop to import collection</p>
                <p className="text-[10px] text-text-3">Postman, Insomnia, Bruno, OpenAPI, adOmnia</p>
              </div>
            </div>
          )}

          {/* Import feedback toast */}
          {dropFeedback && (
            <div className={`absolute bottom-16 left-1/2 -translate-x-1/2 z-[9999] px-4 py-2 rounded-lg shadow-xl text-xs font-medium transition-all ${dropFeedback.ok ? 'bg-green-600/90 text-white' : 'bg-red-600/90 text-white'}`}>
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
