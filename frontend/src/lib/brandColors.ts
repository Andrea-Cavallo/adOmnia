function relativeLuminance(hex: string): number {
  const channel = (index: number) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
}

/** Rapporto di contrasto WCAG fra due colori esadecimali senza #. */
export function contrastRatio(foreground: string, background: string): number {
  const [light, dark] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}

/** Superfici dei temi scuro e chiaro (globals.css, --color-surface-0). */
const DARK_SURFACE = '05070D'
const LIGHT_SURFACE = 'F8FAFC'
/** Soglia WCAG per elementi grafici non testuali. */
const MIN_ICON_CONTRAST = 3

/**
 * Colore del marchio per tema: il colore ufficiale quando si legge, altrimenti il colore del testo
 * (currentColor). GitHub, Markdown o JSON sono neri e sparirebbero sul tema scuro; EditorConfig è
 * quasi bianco e sparirebbe su quello chiaro.
 */
export function brandColors(hex: string): { onDark: string; onLight: string } {
  return {
    onDark: contrastRatio(hex, DARK_SURFACE) >= MIN_ICON_CONTRAST ? `#${hex}` : 'currentColor',
    onLight: contrastRatio(hex, LIGHT_SURFACE) >= MIN_ICON_CONTRAST ? `#${hex}` : 'currentColor',
  }
}
