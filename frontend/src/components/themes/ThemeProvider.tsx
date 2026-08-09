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

  // Themes own their accent. This used to be skipped and overwritten with a
  // fixed purple, which silently gutted every accent-defined theme (obsidian
  // -neon is *only* its neon-mint accent) and made the accent fields in the
  // advanced editor decorative. adOmnia's purple now lives where it belongs:
  // as the default theme's accent, not as a runtime override.
  Object.entries(theme.colors).forEach(([key, value]) => {
    root.setProperty(`--color-${key}`, value)
  })

  if (theme.fonts.sans) root.setProperty('--font-sans', theme.fonts.sans)
  if (theme.fonts.serif) root.setProperty('--font-serif', theme.fonts.serif)

  // Typography ownership:
  //   normal theme -> the user's "UI Font" setting wins (--font-ui).
  //   skin         -> the skin wins, because dictating the whole look is what
  //                   a skin is for; a handwriting skin in IBM Plex Mono is
  //                   not the skin.
  // Skins publish --skin-font-*, which globals.css and Tailwind read ahead of
  // --font-ui. useAppearance keeps writing --font-ui untouched, so leaving the
  // skin restores the user's choice with no extra bookkeeping.
  if (theme.meta?.skin) {
    if (theme.fonts.sans) root.setProperty('--skin-font-ui', theme.fonts.sans)
    if (theme.fonts.mono) root.setProperty('--skin-font-mono', theme.fonts.mono)
  } else {
    root.removeProperty('--skin-font-ui')
    root.removeProperty('--skin-font-mono')
  }

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

  // A skin is a theme that also needs surface treatment tokens cannot carry —
  // ruled paper, a spiral binding, a drawn border. Themes declare `meta.skin`
  // and the matching stylesheet keys off this attribute. Themes without one
  // clear it, so switching away removes the treatment.
  const skin = theme.meta?.skin
  if (skin) html.setAttribute('data-skin', skin)
  else html.removeAttribute('data-skin')
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
