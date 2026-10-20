import { expect, it } from 'vitest'
import { codeStudioTerminalTheme, TERMINAL_THEMES } from './codeStudioTerminalTheme'
import { terminalAppearance } from '@/lib/code-studio/terminalAppearance'
it('bundles nine complete independent terminal palettes', () => {
 expect(TERMINAL_THEMES).toHaveLength(9)
 expect(new Set(TERMINAL_THEMES.map((item) => item.id)).size).toBe(9)
 for (const preset of TERMINAL_THEMES) {
  const colors = codeStudioTerminalTheme('dark', undefined, preset.id)
  for (const key of ['background','foreground','cursor','cursorAccent','selectionBackground','black','red','green','yellow','blue','magenta','cyan','white','brightBlack','brightRed','brightGreen','brightYellow','brightBlue','brightMagenta','brightCyan','brightWhite'] as const) expect(colors[key], `${preset.name}/${key}`).toBeTruthy()
  expect(preset.link).toMatch(/^#[a-f0-9]{6}$/i)
  expect(colors.background).not.toBe(colors.foreground)
 }
})
it('keeps explicit palettes independent of app mode and returns new objects', () => {
 const original = TERMINAL_THEMES.find((item) => item.id === 'nord')!.colors.background
 const theme = codeStudioTerminalTheme('light', '#ff0000', 'nord')
 expect(theme.background).toBe(original)
 theme.background = '#ff0000'
 expect(TERMINAL_THEMES.find((item) => item.id === 'nord')!.colors.background).toBe(original)
 expect(codeStudioTerminalTheme('light', undefined, 'adomnia-dark').background).toBe('#11171D')
 expect(codeStudioTerminalTheme('dark', undefined, 'adomnia-light').background).toBe('#FFFFFF')
})
it('loads legacy settings and bounds malformed imported values', () => {
 expect(terminalAppearance()).toMatchObject({ preset: 'adomnia-dark', fontSize: 13, scrollback: 5000 })
 expect(terminalAppearance({ fontSize: Infinity, lineHeight: -10, scrollback: 1e9, letterSpacing: NaN, cursorStyle: 'invalid' as never })).toMatchObject({ fontSize: 13, lineHeight: 1, scrollback: 20000, letterSpacing: 0, cursorStyle: 'bar' })
})
