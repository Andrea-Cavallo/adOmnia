import { useState, useEffect, useCallback } from 'react'
import { FolderKanban, Moon, Sun } from 'lucide-react'
import { useCollectionsStore } from '@/stores/collections'
import { useTabsStore } from '@/stores/tabs'
import { useAppStore } from '@/stores/app'
import { useThemesStore } from '@/stores/themes'
import { useThemeContext } from '@/components/themes/ThemeProvider'
import { inferThemeMode } from '@/lib/themeCatalog'
import { cn } from '@/lib/utils'

export function StatusBar() {
  const tabs = useTabsStore((s) => s.tabs)
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const responseHistory = useTabsStore((s) => s.responseHistory)
  const workspaces = useCollectionsStore((s) => s.workspaces)
  const activeWorkspaceId = useCollectionsStore((s) => s.activeWorkspaceId)
  const mockRunning = useAppStore((s) => s.mockRunning)
  const proxyRunning = useAppStore((s) => s.proxyRunning)
  const setActiveRail = useAppStore((s) => s.setActiveRail)
  const themes = useThemesStore((s) => s.themes)
  const activeThemeId = useThemesStore((s) => s.activeThemeId)
  const { applyTheme } = useThemeContext()
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent<string>).detail
      setSaveError(msg)
      setTimeout(() => setSaveError(null), 5000)
    }
    window.addEventListener('adomnia:save-error', handler)
    return () => window.removeEventListener('adomnia:save-error', handler)
  }, [])

  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId)
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const response = activeTab?.response
  const activeTheme = themes.find((t) => t.id === activeThemeId)
  const currentMode = activeTheme ? inferThemeMode(activeTheme) : 'dark'

  const toggleTheme = useCallback(() => {
    const targetMode = currentMode === 'dark' ? 'light' : 'dark'
    // Try same-family opposite theme first (e.g., builtin-dark → builtin-light)
    const family = activeThemeId?.replace(/-dark$|-light$/, '') ?? ''
    const sameFamily = themes.find(
      (t) => t.id !== activeThemeId && t.id.startsWith(family) && inferThemeMode(t) === targetMode
    )
    const fallback = themes.find((t) => inferThemeMode(t) === targetMode)
    const next = sameFamily ?? fallback
    if (next) applyTheme(next)
  }, [currentMode, activeThemeId, themes, applyTheme])

  // Ctrl+Shift+L — toggle dark/light theme
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        toggleTheme()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [toggleTheme])

  return (
    <footer className="flex h-5 items-center justify-between border-t border-border-1 bg-surface-1 px-2.5 text-[10px] text-text-3 select-none">
      <div className="flex items-center gap-3">
        {response && !response.error && (
          <>
            <span className={response.status >= 400 ? 'text-error' : response.status >= 200 ? 'text-success' : 'text-text-3'}>
              {response.status} {response.statusText}
            </span>
            <span>{response.ms} ms</span>
            <span>{response.size < 1024 ? `${response.size} B` : `${(response.size / 1024).toFixed(1)} KB`}</span>
          </>
        )}
        {response?.error && <span className="text-error">{response.error.code}</span>}
        {!response && !saveError && <span>Ready</span>}
        {saveError && <span className="text-error">Save error: {saveError}</span>}
        {responseHistory.length > 0 && (
          <button
            onClick={() => setActiveRail('history')}
            title="Open Request History"
            className="flex items-center gap-1 text-text-4 hover:text-text-2 transition-colors"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />
            history {responseHistory.length} reqs
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        {activeWorkspace && (
          <>
            <button
              onClick={() => setActiveRail('collections')}
              title="Open active workspace"
              className="flex max-w-44 items-center gap-1 text-text-4 transition-colors hover:text-text-2"
            >
              <FolderKanban size={10} className="shrink-0 text-accent" />
              <span className="truncate">{activeWorkspace.name}</span>
            </button>
            <span className="h-3 w-px bg-border-2" />
          </>
        )}
        {/* Mock running indicator — click to navigate */}
        {mockRunning && (
          <button
            onClick={() => setActiveRail('mock')}
            title="Mock Server running — click to open"
            className="flex items-center gap-1 text-[10px] text-success hover:text-success/80 transition-colors"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-success inline-block animate-pulse" />
            Mock
          </button>
        )}
        {/* Proxy running indicator — click to navigate */}
        {proxyRunning && (
          <button
            onClick={() => setActiveRail('proxy')}
            title="Proxy running — click to open"
            className="flex items-center gap-1 text-[10px] text-info hover:text-info/80 transition-colors"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-info inline-block animate-pulse" />
            Proxy
          </button>
        )}
        {(mockRunning || proxyRunning) && (
          <span className="h-3 w-px bg-border-2" />
        )}
        {/* Dark / Light toggle */}
        <button
          onClick={toggleTheme}
          title={`Switch to ${currentMode === 'dark' ? 'light' : 'dark'} theme (Ctrl+Shift+L)`}
          className={cn(
            'h-5 w-5 flex items-center justify-center rounded hover:bg-surface-3 transition-colors',
            'text-text-4 hover:text-text-2',
          )}
        >
          {currentMode === 'dark' ? <Sun size={11} /> : <Moon size={11} />}
        </button>
      </div>
    </footer>
  )
}
