import { useThemesStore } from '@/stores/themes'

export const APP_ICON = '/icon.png'
export const APP_ICON_WIN95 = '/icon95.png'
export const APP_WORDMARK = '/adOmnia-noback.png'

export function getAppIconForTheme(themeId?: string) {
  return themeId === 'builtin-win95' ? APP_ICON_WIN95 : APP_ICON
}

export function useAppIcon() {
  const activeThemeId = useThemesStore((s) => s.activeThemeId)
  return getAppIconForTheme(activeThemeId)
}
