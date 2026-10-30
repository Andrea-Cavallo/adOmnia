import { accentTokens } from '@/lib/accentPalette'
import type { ITheme } from '@xterm/xterm'

/**
 * Temi xterm allineati ai token di `styles/globals.css` e al tema Monaco, così
 * il terminale non sembra un widget incollato dentro Code Studio. Lo sfondo è quello delle isole.
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

export function codeStudioTerminalTheme(theme: 'light' | 'dark', customAccent?: string, presetId?: string): ITheme {
  const selected = TERMINAL_THEMES.find((item) => item.id === presetId)
  if (selected && selected.id !== 'adomnia-dark' && selected.id !== 'adomnia-light') return { ...selected.colors }
  if (selected?.id === 'adomnia-light') return { ...lightTheme }
  const base = selected?.id === 'adomnia-dark' ? darkTheme : theme === 'light' ? lightTheme : darkTheme
  const tokens = accentTokens(customAccent ?? '', selected?.id === 'adomnia-dark' ? 'dark' : theme)
  return tokens.accent ? { ...base, cursor: tokens.accent, selectionBackground: tokens['accent-glow'] } : base
}


export interface TerminalThemePreset {
  id: string
  name: string
  colors: ITheme & { background: string; foreground: string }
  link: string
}
const ansiKeys = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'] as const
function preset(id: string, name: string, background: string, foreground: string, cursor: string, link: string, ansi: string[]): TerminalThemePreset {
  return { id, name, link, colors: { background, foreground, cursor, cursorAccent: background, selectionBackground: cursor + '40', selectionInactiveBackground: cursor + '24', ...Object.fromEntries(ansiKeys.map((key, index) => [key, ansi[index]])) } }
}
// Locally bundled palettes: no download or external theme service at runtime.
export const TERMINAL_THEMES: TerminalThemePreset[] = [
  { id: 'adomnia-dark', name: 'adOmnia Dark', colors: darkTheme as TerminalThemePreset['colors'], link: '#7DD3FC' },
  preset('adomnia-oled', 'adOmnia OLED', '#050507', '#E6E6EF', '#BC9CFF', '#67E8F9', ['#24242B','#F08090','#A6DCAF','#EACB8B','#91B9FF','#BC9CFF','#67E8F9','#D8D8E3','#737383','#FFA6B4','#C2EBC8','#F5DEAA','#B5D0FF','#D7C4FF','#A1F3FF','#FAFAFF']),
  preset('tokyo-night-oled', 'Tokyo Night OLED', '#08090D', '#C0CAF5', '#C0CAF5', '#7DCFFF', ['#15161E','#F7768E','#9ECE6A','#E0AF68','#7AA2F7','#BB9AF7','#7DCFFF','#A9B1D6','#565F89','#F7768E','#9ECE6A','#E0AF68','#7AA2F7','#BB9AF7','#7DCFFF','#C0CAF5']),
  preset('catppuccin-mocha', 'Catppuccin Mocha', '#1E1E2E', '#CDD6F4', '#F5E0DC', '#89DCEB', ['#45475A','#F38BA8','#A6E3A1','#F9E2AF','#89B4FA','#F5C2E7','#94E2D5','#BAC2DE','#585B70','#F38BA8','#A6E3A1','#F9E2AF','#89B4FA','#F5C2E7','#94E2D5','#A6ADC8']),
  preset('gruvbox-material', 'Gruvbox Material', '#282828', '#D4BE98', '#D4BE98', '#89B482', ['#3C3836','#EA6962','#A9B665','#D8A657','#7DAEA3','#D3869B','#89B482','#D4BE98','#928374','#EA6962','#A9B665','#D8A657','#7DAEA3','#D3869B','#89B482','#DDC7A1']),
  preset('rose-pine-moon', 'Rose Pine Moon', '#232136', '#E0DEF4', '#EA9A97', '#9CCFD8', ['#393552','#EB6F92','#3E8FB0','#F6C177','#9CCFD8','#C4A7E7','#EA9A97','#E0DEF4','#6E6A86','#EB6F92','#3E8FB0','#F6C177','#9CCFD8','#C4A7E7','#EA9A97','#E0DEF4']),
  preset('monochrome', 'Monochrome', '#101010', '#DEDEDE', '#FFFFFF', '#FFFFFF', ['#242424','#AFAFAF','#C0C0C0','#D1D1D1','#B7B7B7','#CCCCCC','#DADADA','#E2E2E2','#797979','#C7C7C7','#D6D6D6','#E8E8E8','#CECECE','#DDDDDD','#ECECEC','#FFFFFF']),
  preset('nord', 'Nord', '#2E3440', '#D8DEE9', '#D8DEE9', '#88C0D0', ['#3B4252','#BF616A','#A3BE8C','#EBCB8B','#81A1C1','#B48EAD','#88C0D0','#E5E9F0','#4C566A','#BF616A','#A3BE8C','#EBCB8B','#81A1C1','#B48EAD','#8FBCBB','#ECEFF4']),
  { id: 'adomnia-light', name: 'adOmnia Light', colors: lightTheme as TerminalThemePreset['colors'], link: '#087D9B' },
]
