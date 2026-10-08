import { accentTokens } from '@/lib/accentPalette'
import type { ITheme } from '@xterm/xterm'

/**
 * Temi xterm allineati ai token di `styles/globals.css` e al tema Monaco, così
 * il terminale non sembra un widget incollato dentro Go Studio. Lo sfondo è quello delle isole.
 */
const darkTheme: ITheme = {
  background: '#11171D',
  foreground: '#F8FAFC',
  cursor: '#7DD3FC',
  cursorAccent: '#11171D',
  selectionBackground: 'rgba(125, 211, 252, 0.25)',
  black: '#2E3447',
  red: '#F87171',
  green: '#4ADE80',
  yellow: '#FBBF24',
  blue: '#60A5FA',
  magenta: '#A855F7',
  cyan: '#22D3EE',
  white: '#E2E8F0',
  brightBlack: '#4B5563',
  brightRed: '#FCA5A5',
  brightGreen: '#86EFAC',
  brightYellow: '#FCD34D',
  brightBlue: '#93C5FD',
  brightMagenta: '#C084FC',
  brightCyan: '#67E8F9',
  brightWhite: '#F8FAFC',
}

const lightTheme: ITheme = {
  background: '#FFFFFF',
  foreground: '#151821',
  cursor: '#087D9B',
  cursorAccent: '#FFFFFF',
  selectionBackground: 'rgba(8, 125, 155, 0.18)',
  black: '#1F2333',
  red: '#B91C1C',
  green: '#15803D',
  yellow: '#A16207',
  blue: '#1D4ED8',
  magenta: '#7C2FF5',
  cyan: '#0E7490',
  white: '#475569',
  brightBlack: '#9AA1AF',
  brightRed: '#DC2626',
  brightGreen: '#16A34A',
  brightYellow: '#CA8A04',
  brightBlue: '#2563EB',
  brightMagenta: '#9333EA',
  brightCyan: '#0891B2',
  brightWhite: '#0F172A',
}

export function goStudioTerminalTheme(theme: 'light' | 'dark', customAccent?: string): ITheme {
  const base = theme === 'light' ? lightTheme : darkTheme
  const tokens = accentTokens(customAccent ?? '', theme)
  return tokens.accent ? { ...base, cursor: tokens.accent, selectionBackground: tokens['accent-glow'] } : base
}
