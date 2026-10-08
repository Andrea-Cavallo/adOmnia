export function validAccent(value?: string): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

function rgb(hex: string): number[] { return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) }
function hex(channels: number[]): string { return '#' + channels.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('') }
export function luminance(color: string): number {
  const values = rgb(color).map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4 })
  return values[0] * .2126 + values[1] * .7152 + values[2] * .0722
}
export function contrast(a: string, b: string): number {
  const x = luminance(a), y = luminance(b)
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05)
}
export function accentTokens(selected: string, mode: 'dark' | 'light', surface?: string): Record<string, string> {
  if (!validAccent(selected)) return {}
  const background = validAccent(surface) ? surface : mode === 'dark' ? '#11171D' : '#FFFFFF'
  const toward = luminance(background) < .179 ? 255 : 0
  let accent = selected.toUpperCase()
  for (let i = 0; contrast(accent, background) < 4.5 && i < 100; i++) accent = hex(rgb(accent).map(v => toward === 255 ? Math.ceil(v + (toward - v) * .07) : Math.floor(v + (toward - v) * .07)))
  const foreground = contrast(accent, '#FFFFFF') >= contrast(accent, '#000000') ? '#FFFFFF' : '#000000'
  const shift = (amount: number) => hex(rgb(accent).map(v => v + (toward - v) * amount))
  return { accent, 'accent-hover': accent, 'accent-light': accent, 'accent-dark': shift(-.08), 'accent-glow': accent + '26', 'on-accent': foreground }
}

export function accentHue(color: string): number {
  if (!validAccent(color)) return 190
  const [r, g, b] = rgb(color).map(v => v / 255)
  const high = Math.max(r, g, b), low = Math.min(r, g, b), delta = high - low
  if (!delta) return 190
  const hue = high === r ? (g - b) / delta : high === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  return (hue * 60 + 360) % 360
}
