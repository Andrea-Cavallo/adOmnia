import { useState, useEffect, useCallback, useRef } from 'react'
import { Moon, Palette, Sun } from 'lucide-react'
import { useTabsStore } from '@/stores/tabs'
import { useAppStore } from '@/stores/app'
import { useThemesStore } from '@/stores/themes'
import { useThemeContext } from '@/components/themes/ThemeProvider'
import { inferThemeMode } from '@/lib/themeCatalog'
import { cn } from '@/lib/utils'
import { useUiTranslation } from '@/lib/uiI18n'
import { AccentColorSetting } from '@/components/settings/AccentColorSetting'
import { useSettingsStore } from '@/stores/settings'
import { luminance, validAccent } from '@/lib/accentPalette'

const BASE_PRESETS = { dark: ['#000000', '#0B1020', '#111827', '#1C1917'], light: ['#FFFFFF', '#F8FAFC', '#FAF7F0', '#EEF2F7'] } as const

export function StatusBar() {
  const tr = useUiTranslation()
  const tabs = useTabsStore((s) => s.tabs)
  const activeTabId = useTabsStore((s) => s.activeTabId)
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

  const activeTab = tabs.find((t) => t.id === activeTabId)
  const response = activeTab?.response
  const activeTheme = themes.find((t) => t.id === activeThemeId)
  const currentMode = activeTheme ? inferThemeMode(activeTheme) : 'dark'

  type QuickMode = 'dark' | 'light'
  const currentQuickMode = currentMode
  const updateAppearance = useSettingsStore((s) => s.updateAppearance)
  // Each quick mode keeps its own base color: switching saves the current one and
  // restores the other, instead of falling back to the adOmnia default.
  const applyQuickMode = useCallback((mode: QuickMode, base?: string | null) => {
    const next = themes.find((t) => t.id === `builtin-${mode}`)
      ?? themes.find((t) => !['builtin-sketch', 'builtin-terminal-green'].includes(t.id) && inferThemeMode(t) === mode)
    if (!next) return
    const appearance = useSettingsStore.getState().settings.appearance
    const bases = { ...appearance.modeBases, [currentMode]: appearance.baseColor }
    if (base !== undefined) bases[mode] = base ?? undefined
    applyTheme(next)
    const baseColor = validAccent(bases[mode]) ? bases[mode] : undefined
    updateAppearance({ modeBases: bases, baseColor, theme: baseColor ? (luminance(baseColor) > 0.179 ? 'light' : 'dark') : mode })
  }, [themes, applyTheme, currentMode, updateAppearance])
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

  const [paletteMode, setPaletteMode] = useState<QuickMode | null>(null)
  const paletteOpen = paletteMode !== null
  const setPaletteOpen = (open: boolean) => { if (!open) setPaletteMode(null) }
  const modeBases = useSettingsStore((s) => s.settings.appearance.modeBases)
  const activeBase = useSettingsStore((s) => s.settings.appearance.baseColor)
  const accentColor = useSettingsStore((s) => s.settings.appearance.accentColor)
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
        {!response && !saveError && <span>{tr('Ready')}</span>}
        {saveError && <span className="text-error">{tr('Save error:')} {saveError}</span>}
      </div>
      <div className="flex items-center gap-2">
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
              <BaseColorPicker
                mode={paletteMode!}
                value={paletteMode === currentMode ? activeBase : modeBases?.[paletteMode!]}
                onChange={(color) => applyQuickMode(paletteMode!, color)}
              />
            </div>
          )}
          {([
            { mode: 'dark' as const, Icon: Moon, label: tr('Dark theme'), text: 'Dark' },
            { mode: 'light' as const, Icon: Sun, label: tr('Light theme'), text: 'White' },
          ]).map(({ mode, Icon, label, text }) => (
            <button
              key={mode}
              onClick={() => { applyQuickMode(mode, null); updateAppearance({ accentColor: undefined }) }}
              title={`${label} · ${tr('Default colors')}`}
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
          <button
            onClick={() => setPaletteMode((open) => (open ? null : currentMode))}
            title={tr('Accent and base color')}
            aria-label={tr('Custom colors')}
            aria-expanded={paletteOpen}
            className={cn(
              'h-6 px-2 gap-1.5 flex items-center justify-center rounded transition-colors',
              paletteOpen || accentColor || activeBase ? 'bg-surface-3 text-accent' : 'text-text-4 hover:bg-surface-3 hover:text-text-2',
            )}
          >
            <Palette size={11} /><span>{tr('Custom')}</span>
          </button>
        </div>
      </div>
    </footer>
  )
}

function BaseColorPicker({ mode, value, onChange }: { mode: 'dark' | 'light'; value?: string; onChange: (color: string | null) => void }) {
  const tr = useUiTranslation()
  const fallback = mode === 'dark' ? '#000000' : '#FFFFFF'
  return <div className="space-y-3 border-t border-border-1 py-4">
    <div className="flex items-center justify-between gap-3"><span className="text-xs font-medium text-text-1">{tr(mode === 'dark' ? 'Dark base color' : 'White base color')}</span><button type="button" onClick={() => onChange(null)} className="text-xs text-accent hover:underline">{tr('Use theme color')}</button></div>
    <div className="flex flex-wrap items-center gap-2">
      {BASE_PRESETS[mode].map(color => <button key={color} type="button" aria-label={color} aria-pressed={value?.toLowerCase() === color.toLowerCase()} onClick={() => onChange(color)} style={{ backgroundColor: color }} className="h-7 w-7 rounded-full border-2 border-surface-1 outline outline-1 outline-border-2 focus-visible:ring-2 focus-visible:ring-accent aria-pressed:ring-2 aria-pressed:ring-accent" />)}
      <input type="color" aria-label={tr('Base color')} value={validAccent(value) ? value : fallback} onChange={e => onChange(e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-border-2 bg-surface-1 p-1" />
    </div>
  </div>
}
