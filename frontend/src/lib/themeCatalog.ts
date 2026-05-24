import type { Theme } from '@/stores/themes'
import {
  getBuiltinThemes,
  getExtendedBuiltinThemes,
  getThemes,
  scanProjectThemesDirectory,
  scanSkinsDirectory,
} from '@/lib/themes-api'

export function dedupeThemes(themes: Theme[]): Theme[] {
  const seen = new Map<string, Theme>()
  for (const theme of themes) {
    if (!theme?.id) continue
    seen.set(theme.id, theme)
  }
  return Array.from(seen.values())
}

export async function loadAvailableThemes(): Promise<Theme[]> {
  const [builtins, extended, projectThemes, userThemes, skinThemes] = await Promise.all([
    getBuiltinThemes(),
    getExtendedBuiltinThemes(),
    scanProjectThemesDirectory(),
    getThemes(),
    scanSkinsDirectory(),
  ])
  return dedupeThemes([...builtins, ...extended, ...projectThemes, ...userThemes, ...skinThemes])
}

export function inferThemeMode(theme?: Theme | null): 'dark' | 'light' {
  if (!theme) return 'dark'
  const metaMode = theme.meta?.mode?.toLowerCase()
  if (metaMode === 'light' || metaMode === 'dark') return metaMode
  if (theme.id.includes('light') || theme.name.toLowerCase().includes('light')) return 'light'
  const surface = theme.colors?.['surface-0'] ?? ''

  if (surface.startsWith('#')) {
    const hex = surface.slice(1)
    const full = hex.length === 3
      ? hex.split('').map((ch) => ch + ch).join('')
      : hex
    if (full.length === 6) {
      const r = parseInt(full.slice(0, 2), 16)
      const g = parseInt(full.slice(2, 4), 16)
      const b = parseInt(full.slice(4, 6), 16)
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
      return luminance > 0.58 ? 'light' : 'dark'
    }
  }

  const oklchMatch = surface.match(/oklch\(([\d.]+)%\s/)
  if (oklchMatch) {
    return parseFloat(oklchMatch[1]) > 60 ? 'light' : 'dark'
  }

  const rgbMatch = surface.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/)
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10)
    const g = parseInt(rgbMatch[2], 10)
    const b = parseInt(rgbMatch[3], 10)
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    return luminance > 0.58 ? 'light' : 'dark'
  }

  return 'dark'
}
