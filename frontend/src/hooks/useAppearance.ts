import { useEffect } from 'react'
import { useSettingsStore } from '@/stores/settings'
import { getUIFontStack } from '@/lib/uiFonts'

const FONT_SIZE_MAP = { small: '12px', medium: '15px', large: '20px' } as const
const MONO_SIZE_MAP = { small: '11px', medium: '14px', large: '19px' } as const
const DENSITY_SCALE = { compact: '0.85', comfortable: '1', spacious: '1.2' } as const

const PURPLE_ACCENT = {
  accent: '#8B3DFF', light: '#A855F7', dark: '#5B21D6', hover: '#9B4FFF', glow: 'rgba(139,61,255,0.18)',
}

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

  // adOmnia's product accent is intentionally fixed: black surfaces + purple actions/selections.
  useEffect(() => {
    const root = document.documentElement.style
    root.setProperty('--color-accent', PURPLE_ACCENT.accent)
    root.setProperty('--color-accent-light', PURPLE_ACCENT.light)
    root.setProperty('--color-accent-dark', PURPLE_ACCENT.dark)
    root.setProperty('--color-accent-hover', PURPLE_ACCENT.hover)
    root.setProperty('--color-accent-glow', PURPLE_ACCENT.glow)
  }, [])
}
