export const UI_FONTS = [
  { id: 'jetbrains-mono', label: 'JetBrains Mono', stack: "'JetBrains Mono', 'Cascadia Code', 'IBM Plex Mono', ui-monospace, monospace" },
  { id: 'fira-code', label: 'Fira Code', stack: "'Fira Code', 'JetBrains Mono', 'Cascadia Code', ui-monospace, monospace" },
  { id: 'ibm-plex-mono', label: 'IBM Plex Mono', stack: "'IBM Plex Mono', 'JetBrains Mono', 'Cascadia Code', ui-monospace, monospace" },
  { id: 'source-code-pro', label: 'Source Code Pro', stack: "'Source Code Pro', 'JetBrains Mono', 'Consolas', ui-monospace, monospace" },
  { id: 'cascadia-code', label: 'Cascadia Code', stack: "'Cascadia Code', 'Cascadia Mono', 'JetBrains Mono', ui-monospace, monospace" },
  { id: 'hack', label: 'Hack', stack: "'Hack', 'JetBrains Mono', 'Consolas', ui-monospace, monospace" },
  { id: 'space-mono', label: 'Space Mono', stack: "'Space Mono', 'IBM Plex Mono', 'JetBrains Mono', ui-monospace, monospace" },
  { id: 'roboto-mono', label: 'Roboto Mono', stack: "'Roboto Mono', 'JetBrains Mono', 'Consolas', ui-monospace, monospace" },
  { id: 'inter', label: 'Inter', stack: "'Inter', 'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif" },
  { id: 'geist', label: 'Geist', stack: "'Geist', 'Geist Sans', 'Inter', system-ui, sans-serif" },
  { id: 'recursive', label: 'Recursive', stack: "'Recursive', 'Inter', 'IBM Plex Sans', system-ui, sans-serif" },
  { id: 'ubuntu-mono', label: 'Ubuntu Mono', stack: "'Ubuntu Mono', 'JetBrains Mono', 'Consolas', ui-monospace, monospace" },
] as const

export type UIFontId = typeof UI_FONTS[number]['id']

export const DEFAULT_UI_FONT_ID: UIFontId = 'ibm-plex-mono'

export function getUIFontStack(id?: string) {
  return UI_FONTS.find((font) => font.id === id)?.stack
    ?? UI_FONTS.find((font) => font.id === DEFAULT_UI_FONT_ID)?.stack
    ?? "var(--font-sans)"
}
