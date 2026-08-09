import { useThemesStore } from '@/stores/themes'

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

export function getAppIconForTheme(themeId?: string) {
  return (themeId && THEME_ICONS[themeId]) ?? APP_ICON
}

export function useAppIcon() {
  const activeThemeId = useThemesStore((s) => s.activeThemeId)
  return getAppIconForTheme(activeThemeId)
}

/**
 * The mark shown on the empty response panel, which spins while a request is
 * in flight. Themes keep the default artwork; skins that redraw the product
 * supply their own so the spinner belongs to the same drawing.
 */
export function useResponseLogo(fallback: string): string {
  const activeThemeId = useThemesStore((s) => s.activeThemeId)
  return activeThemeId === 'builtin-sketch' ? APP_ICON_SKETCH : fallback
}

/** True while a skin that redraws the product is active. */
export function useIsSketchSkin(): boolean {
  return useThemesStore((s) => s.activeThemeId) === 'builtin-sketch'
}
