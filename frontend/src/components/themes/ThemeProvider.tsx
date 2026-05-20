import { createContext, useCallback, useContext, useEffect } from 'react'
import type { Theme } from '@/stores/themes'
import { useThemesStore } from '@/stores/themes'
import { useSettingsStore } from '@/stores/settings'
import { getActiveThemeId, getBuiltinThemes, getThemes, setActiveThemeId } from '@/lib/themes-api'
import { getAppIconForTheme } from '@/lib/brandAssets'

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

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { themes, activeThemeId, setThemes, setActiveThemeId: setStoreActiveId } = useThemesStore()
  const appearanceTheme = useSettingsStore((s) => s.settings.appearance.theme)

  const applyTheme = useCallback((theme: Theme) => {
    injectThemeVariables(theme)
    syncDocumentIcon(theme.id)
    setActiveThemeId(theme.id)
    setStoreActiveId(theme.id)
  }, [setStoreActiveId])

  useEffect(() => {
    async function loadInitial() {
      const [userThemes, builtins, activeId] = await Promise.all([
        getThemes(),
        getBuiltinThemes(),
        getActiveThemeId(),
      ])
      // Include builtins in the lookup pool so builtin IDs resolve correctly
      const allThemes = [...userThemes, ...builtins]
      setThemes(userThemes)
      setStoreActiveId(activeId)

      const active = allThemes.find((t) => t.id === activeId)
        ?? builtins.find((t) => t.id === 'builtin-dark')
      if (active) {
        injectThemeVariables(active)
        syncDocumentIcon(active.id)
      }
    }
    loadInitial()
  }, [setThemes, setStoreActiveId])

  useEffect(() => {
    if (!activeThemeId) return
    const active = themes.find((t) => t.id === activeThemeId)
    if (active) {
      injectThemeVariables(active)
    }
    syncDocumentIcon(activeThemeId)
    // If not found in user themes, builtins are handled by loadInitial
  }, [activeThemeId, themes])

  useEffect(() => {
    if (activeThemeId && !['builtin-light', 'builtin-dark'].includes(activeThemeId)) return
    const targetId = appearanceTheme === 'light' ? 'builtin-light' : 'builtin-dark'
    getBuiltinThemes().then((builtins) => {
      const theme = builtins.find((t) => t.id === targetId)
      if (!theme) return
      injectThemeVariables(theme)
      syncDocumentIcon(theme.id)
      setStoreActiveId(targetId)
      void setActiveThemeId(targetId)
    }).catch(() => {})
  }, [appearanceTheme, activeThemeId, setStoreActiveId])

  return (
    <ThemeContext.Provider value={{ applyTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
