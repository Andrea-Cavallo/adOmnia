import { useState, useEffect, useCallback, useRef } from 'react'
import { FolderKanban, Moon, Sun } from 'lucide-react'
import { useCollectionsStore } from '@/stores/collections'
import { useTabsStore } from '@/stores/tabs'
import { useAppStore } from '@/stores/app'
import { useThemesStore } from '@/stores/themes'
import { useThemeContext } from '@/components/themes/ThemeProvider'
import { inferThemeMode } from '@/lib/themeCatalog'
import { cn } from '@/lib/utils'
import { useUiTranslation } from '@/lib/uiI18n'
import { AccentColorSetting } from '@/components/settings/AccentColorSetting'

export function StatusBar() {
  const tr = useUiTranslation()
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

  type QuickMode = 'dark' | 'light'
  const currentQuickMode = currentMode
  const applyQuickMode = useCallback((mode: QuickMode) => {
    const next = themes.find((t) => t.id === `builtin-${mode}`)
      ?? themes.find((t) => !['builtin-sketch', 'builtin-terminal-green'].includes(t.id) && inferThemeMode(t) === mode)
    if (next) applyTheme(next)
  }, [themes, applyTheme])
  const toggleTheme = useCallback(() => applyQuickMode(currentMode === 'dark' ? 'light' : 'dark'), [currentMode, applyQuickMode])

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

  const [paletteOpen, setPaletteOpen] = useState(false)
  const appearanceRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!paletteOpen) return
    const close = (event: MouseEvent) => { if (!appearanceRef.current?.contains(event.target as Node)) setPaletteOpen(false) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setPaletteOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', onKey) }
  }, [paletteOpen])

  return (
    <footer className="flex h-7 items-center justify-between border-t border-border-1 bg-surface-1 px-2.5 text-[10px] text-text-3 select-none">
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
        {!response && !saveError && <span>{tr('Ready')}</span>}
        {saveError && <span className="text-error">{tr('Save error:')} {saveError}</span>}
        {responseHistory.length > 0 && (
          <button
            onClick={() => setActiveRail('history')}
            title={tr('Open Request History')}
            className="flex items-center gap-1 text-text-4 hover:text-text-2 transition-colors"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />
            {tr('history')} {responseHistory.length} {tr('reqs')}
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        {activeWorkspace && (
          <>
            <button
              onClick={() => setActiveRail('collections')}
              title={tr('Open active workspace')}
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
            title={tr('Mock Server running — click to open')}
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
            title={tr('Proxy running — click to open')}
            className="flex items-center gap-1 text-[10px] text-info hover:text-info/80 transition-colors"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-info inline-block animate-pulse" />
            Proxy
          </button>
        )}
        {(mockRunning || proxyRunning) && (
          <span className="h-3 w-px bg-border-2" />
        )}
        {/* Quick appearance buttons make the available skins discoverable; the
            keyboard shortcut cycles the same set. */}
        <div ref={appearanceRef} className="relative flex items-center gap-0.5" role="group" aria-label={tr('Appearance')}>
          {paletteOpen && (
            <div role="dialog" aria-label={tr('Accent color')} className="absolute bottom-full right-0 z-50 mb-2 w-72 rounded-lg border border-border-2 bg-surface-1 px-3 text-text-1 shadow-xl [&>div]:border-b-0">
              <AccentColorSetting />
            </div>
          )}
          {([
            { mode: 'dark' as const, Icon: Moon, label: tr('Dark theme'), text: 'Dark' },
            { mode: 'light' as const, Icon: Sun, label: tr('Light theme'), text: 'White' },
          ]).map(({ mode, Icon, label, text }) => (
            <button
              key={mode}
              onClick={() => applyQuickMode(mode)}
              onContextMenu={(event) => { event.preventDefault(); setPaletteOpen((open) => !open) }}
              title={`${label} · ${tr('Right-click: accent color')}`}
              aria-label={label}
              aria-pressed={currentQuickMode === mode}
              className={cn(
                'h-6 px-2 gap-1.5 flex items-center justify-center rounded transition-colors',
                currentQuickMode === mode
                  ? 'bg-surface-3 text-accent'
                  : 'text-text-4 hover:bg-surface-3 hover:text-text-2',
              )}
            >
              <Icon size={11} /><span>{text}</span>
            </button>
          ))}
        </div>
      </div>
    </footer>
  )
}
