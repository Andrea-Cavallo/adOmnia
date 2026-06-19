import { useEffect } from 'react'
import { useSettingsStore } from '@/stores/settings'
import { getUIFontStack } from '@/lib/uiFonts'

const FONT_SIZE_MAP = { small: '12px', medium: '15px', large: '20px' } as const
const MONO_SIZE_MAP = { small: '11px', medium: '14px', large: '19px' } as const
const DENSITY_SCALE = { compact: '0.85', comfortable: '1', spacious: '1.2' } as const

interface AccentPreset {
  accent: string; light: string; dark: string; hover: string; glow: string
}
const ACCENT_PRESETS: Record<string, AccentPreset> = {
  blue:   { accent: '#3B82F6', light: '#60A5FA', dark: '#1D4ED8', hover: '#4F8FF7', glow: 'rgba(59,130,246,0.18)' },
  purple: { accent: '#8B3DFF', light: '#A855F7', dark: '#5B21D6', hover: '#9B4FFF', glow: 'rgba(139,61,255,0.18)' },
  green:  { accent: '#10B981', light: '#34D399', dark: '#047857', hover: '#1FC996', glow: 'rgba(16,185,129,0.18)' },
  orange: { accent: '#F59E0B', light: '#FBBF24', dark: '#B45309', hover: '#FBA91B', glow: 'rgba(245,158,11,0.18)' },
  red:    { accent: '#EF4444', light: '#F87171', dark: '#B91C1C', hover: '#F75555', glow: 'rgba(239,68,68,0.18)' },
}
const ACCENT_VARS = ['--color-accent', '--color-accent-light', '--color-accent-dark', '--color-accent-hover', '--color-accent-glow'] as const

export function useAppearance(): void {
  const appearance = useSettingsStore((s) => s.settings.appearance)

  useEffect(() => {
    const html = document.documentElement
    if (appearance.theme === 'light') {
      html.classList.remove('dark')
      html.classList.add('light')
    } else {
      html.classList.add('dark')
      html.classList.remove('light')
    }
  }, [appearance.theme])

  useEffect(() => {
    const root = document.documentElement.style
    root.setProperty('--font-ui', getUIFontStack(appearance.uiFont))
    root.setProperty('--app-font-size', FONT_SIZE_MAP[appearance.fontSize] ?? '15px')
    root.setProperty(
      '--app-mono-size',
      MONO_SIZE_MAP[appearance.monoFontSize ?? appearance.fontSize] ?? '14px',
    )
  }, [appearance.uiFont, appearance.fontSize, appearance.monoFontSize])

  useEffect(() => {
    const scale = DENSITY_SCALE[appearance.density] ?? '1'
    document.documentElement.style.setProperty('--density-scale', scale)
    const fontSize = FONT_SIZE_MAP[appearance.fontSize] ?? '15px'
    document.documentElement.style.fontSize = `calc(${fontSize} * ${scale})`
  }, [appearance.density, appearance.fontSize])

  // Accent preset: override the theme's accent vars, or clear to let the theme win.
  useEffect(() => {
    const root = document.documentElement.style
    const preset = ACCENT_PRESETS[appearance.accentColorPreset]
    if (!preset) {
      for (const v of ACCENT_VARS) root.removeProperty(v)
      return
    }
    root.setProperty('--color-accent', preset.accent)
    root.setProperty('--color-accent-light', preset.light)
    root.setProperty('--color-accent-dark', preset.dark)
    root.setProperty('--color-accent-hover', preset.hover)
    root.setProperty('--color-accent-glow', preset.glow)
  }, [appearance.accentColorPreset])
}
