export interface TerminalAppearance {
  preset: string
  fontSize: number
  fontFamily: string
  lineHeight: number
  letterSpacing: number
  cursorStyle: 'block' | 'underline' | 'bar'
  cursorBlink: boolean
  scrollback: number
}
export const DEFAULT_TERMINAL_APPEARANCE: TerminalAppearance = {
  preset: 'adomnia-dark', fontSize: 13, fontFamily: '', lineHeight: 1.35, letterSpacing: 0,
  cursorStyle: 'bar', cursorBlink: true, scrollback: 5000,
}
const bound = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
/** Older settings omit this optional block; malformed imported values cannot break xterm. */
export function terminalAppearance(value?: Partial<TerminalAppearance> | null): TerminalAppearance {
  const d = DEFAULT_TERMINAL_APPEARANCE
  return { preset: typeof value?.preset === 'string' ? value.preset : d.preset,
    fontFamily: typeof value?.fontFamily === 'string' ? value.fontFamily.slice(0, 200) : d.fontFamily,
    fontSize: bound(value?.fontSize, d.fontSize, 10, 24), lineHeight: bound(value?.lineHeight, d.lineHeight, 1, 1.8),
    letterSpacing: bound(value?.letterSpacing, d.letterSpacing, -1, 3), scrollback: Math.round(bound(value?.scrollback, d.scrollback, 1000, 20000)),
    cursorStyle: value?.cursorStyle === 'block' || value?.cursorStyle === 'underline' ? value.cursorStyle : 'bar',
    cursorBlink: typeof value?.cursorBlink === 'boolean' ? value.cursorBlink : d.cursorBlink }
}
