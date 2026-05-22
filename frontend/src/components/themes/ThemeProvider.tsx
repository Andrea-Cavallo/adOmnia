import { createContext, useCallback, useContext, useEffect } from 'react'
import type { Theme } from '@/stores/themes'
import { useThemesStore } from '@/stores/themes'
import { useSettingsStore } from '@/stores/settings'
import { getActiveThemeId, setActiveThemeId } from '@/lib/themes-api'
import { getAppIconForTheme } from '@/lib/brandAssets'
import { inferThemeMode, loadAvailableThemes } from '@/lib/themeCatalog'

interface ThemeContextValue {
  applyTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  applyTheme: () => undefined,
})

export function useThemeContext() {
  return useContext(ThemeContext)
}

function injectThemeVariables(theme: Theme) {
  const root = document.documentElement.style

  Object.entries(theme.colors).forEach(([key, value]) => {
    root.setProperty(`--color-${key}`, value)
  })

  if (theme.fonts.sans) root.setProperty('--font-sans', theme.fonts.sans)
  if (theme.fonts.mono) root.setProperty('--font-mono', theme.fonts.mono)
  if (theme.fonts.serif) root.setProperty('--font-serif', theme.fonts.serif)

  Object.entries(theme.spacing).forEach(([key, value]) => {
    root.setProperty(`--spacing-${key}`, value)
  })

  Object.entries(theme.radii).forEach(([key, value]) => {
    root.setProperty(`--radius-${key}`, value)
  })

  Object.entries(theme.shadows).forEach(([key, value]) => {
    root.setProperty(`--shadow-${key}`, value)
  })
}

function syncDocumentIcon(themeId: string) {
  const href = getAppIconForTheme(themeId)
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.href = href
}

function syncDocumentMode(theme: Theme) {
  const html = document.documentElement
  const mode = inferThemeMode(theme)
  html.classList.toggle('light', mode === 'light')
  html.classList.toggle('dark', mode === 'dark')
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { themes, activeThemeId, setThemes, setActiveThemeId: setStoreActiveId } = useThemesStore()
  const settingsThemeId = useSettingsStore((s) => s.settings.appearance.themeId)
  const settingsLoaded = useSettingsStore((s) => s.loaded)
  const updateAppearance = useSettingsStore((s) => s.updateAppearance)

  const applyTheme = useCallback((theme: Theme) => {
    injectThemeVariables(theme)
    syncDocumentMode(theme)
    syncDocumentIcon(theme.id)
    void setActiveThemeId(theme.id)
    setStoreActiveId(theme.id)
    updateAppearance({ themeId: theme.id, theme: inferThemeMode(theme) })
  }, [setStoreActiveId, updateAppearance])

  useEffect(() => {
    if (!settingsLoaded) return
    async function loadInitial() {
      const [allThemes, activeId] = await Promise.all([
        loadAvailableThemes(),
        getActiveThemeId(),
      ])
      setThemes(allThemes)

      const preferredId = settingsThemeId || activeId || 'builtin-dark'
      const active = allThemes.find((t) => t.id === preferredId)
        ?? allThemes.find((t) => t.id === activeId)
        ?? allThemes.find((t) => t.id === 'builtin-dark')
        ?? allThemes[0]
      if (active) {
        injectThemeVariables(active)
        syncDocumentMode(active)
        syncDocumentIcon(active.id)
        setStoreActiveId(active.id)
        if (active.id !== activeId) void setActiveThemeId(active.id)
        if (active.id !== settingsThemeId) {
          updateAppearance({ themeId: active.id, theme: inferThemeMode(active) })
        }
      }
    }
    loadInitial()
  }, [setThemes, setStoreActiveId, settingsLoaded, settingsThemeId, updateAppearance])

  useEffect(() => {
    if (!activeThemeId) return
    const active = themes.find((t) => t.id === activeThemeId)
    if (active) {
      injectThemeVariables(active)
      syncDocumentMode(active)
      syncDocumentIcon(activeThemeId)
      return
    }
    syncDocumentIcon(activeThemeId)
  }, [activeThemeId, themes])

  return (
    <ThemeContext.Provider value={{ applyTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
