import { useThemesStore } from '@/stores/themes'
import { inferThemeMode } from '@/lib/themeCatalog'

const APP_ICON = '/icon.png'
const APP_ICON_WIN95 = '/icon95.png'
const APP_ICON_SKETCH = '/icon-sketch.png'

// Skins that ship their own drawing of the mark. The rendered logo is the most
// recognisable thing on the response panel, so a skin that redraws the whole
// product and then shows the stock 3D icon reads as unfinished.
const THEME_ICONS: Record<string, string> = {
  'builtin-win95': APP_ICON_WIN95,
  'builtin-sketch': APP_ICON_SKETCH,
}

export function getAppIconForTheme(themeId?: string, mode?: 'dark' | 'light') {
  if (themeId && THEME_ICONS[themeId]) return THEME_ICONS[themeId]
  if (mode) return mode === 'light' ? '/icon-black.png' : '/icon-white.png'
  if (themeId === 'builtin-light') return '/icon-black.png'
  if (themeId === 'builtin-dark') return '/icon-white.png'
  return APP_ICON
}

export function useAppIcon() {
  const activeThemeId = useThemesStore((s) => s.activeThemeId)
  const theme = useThemesStore((s) => s.themes.find(t => t.id === s.activeThemeId))
  return getAppIconForTheme(activeThemeId, theme ? inferThemeMode(theme) : undefined)
}

/**
 * The mark shown on the empty response panel, which spins while a request is
 * in flight. Themes keep the default artwork; skins that redraw the product
 * supply their own so the spinner belongs to the same drawing.
 */
export function useResponseLogo(fallback: string): string {
  const activeThemeId = useThemesStore((s) => s.activeThemeId)
  const icon = useAppIcon()
  return activeThemeId ? icon : fallback
}

/** True while a skin that redraws the product is active. */
export function useIsSketchSkin(): boolean {
  return useThemesStore((s) => s.activeThemeId) === 'builtin-sketch'
}
