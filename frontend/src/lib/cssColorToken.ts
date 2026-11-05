/**
 * Resolves any CSS custom property (hex, rgb, oklch, color-mix…) to the
 * `#rrggbb` form canvas-based consumers such as Monaco and xterm require.
 * They cannot read CSS variables themselves, so the live palette has to be
 * sampled from the document on every repaint instead of hardcoded.
 */
let probe: CanvasRenderingContext2D | null | undefined

export function cssColorToken(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (!value) return undefined
  probe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!probe) return undefined
  probe.clearRect(0, 0, 1, 1)
  probe.fillStyle = '#000'
  probe.fillStyle = value
  probe.fillRect(0, 0, 1, 1)
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')
}
