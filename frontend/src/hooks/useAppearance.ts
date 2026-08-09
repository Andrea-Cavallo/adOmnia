import { useEffect } from 'react'
import { useSettingsStore } from '@/stores/settings'
import { getUIFontStack } from '@/lib/uiFonts'

const FONT_SIZE_MAP = { small: '12px', medium: '15px', large: '20px' } as const
const MONO_SIZE_MAP = { small: '11px', medium: '14px', large: '19px' } as const
const DENSITY_SCALE = { compact: '0.85', comfortable: '1', spacious: '1.2' } as const

export function typographyVariables(uiFont?: string, fontSize?: string, monoFontSize?: string): Record<string, string> {
  return {
    '--font-ui': getUIFontStack(uiFont),
    '--font-mono': getUIFontStack(uiFont),
    '--app-font-size': FONT_SIZE_MAP[fontSize as keyof typeof FONT_SIZE_MAP] ?? '15px',
    '--app-mono-size': MONO_SIZE_MAP[monoFontSize as keyof typeof MONO_SIZE_MAP] ?? '14px',
  }
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
    for (const [property, value] of Object.entries(
      typographyVariables(appearance.uiFont, appearance.fontSize, appearance.monoFontSize ?? appearance.fontSize),
    )) root.setProperty(property, value)
  }, [appearance.uiFont, appearance.fontSize, appearance.monoFontSize])

  useEffect(() => {
    const scale = DENSITY_SCALE[appearance.density] ?? '1'
    document.documentElement.style.setProperty('--density-scale', scale)
    const fontSize = FONT_SIZE_MAP[appearance.fontSize] ?? '15px'
    document.documentElement.style.fontSize = `calc(${fontSize} * ${scale})`
  }, [appearance.density, appearance.fontSize])

  // No accent override here. adOmnia's purple is the :root default in
  // globals.css, so an unthemed app still looks like adOmnia while an active
  // theme keeps its own accent instead of being repainted on every mount.
}
