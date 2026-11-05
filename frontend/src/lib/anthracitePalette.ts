import type { editor } from 'monaco-editor'
import type { ITheme } from '@xterm/xterm'

/**
 * Anthracite: every color here was measured on the reference IDE screenshot, so
 * do not round or "harmonize" them. Surfaces live in the theme tokens
 * (internal/themes/themes.go); this file holds what tokens cannot reach: the
 * canvas-based editor and terminal.
 */
export const ANTHRACITE_THEME_ID = 'builtin-anthracite'

export function anthraciteActive(): boolean {
  return typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === ANTHRACITE_THEME_ID
}

const SYNTAX = {
  keyword: 'CDABF0',
  type: '2FEFF3',
  fn: '5FDCF8',
  string: 'BCEC80',
  comment: '9AA9B8',
  parameter: 'F8D28F',
  property: 'DCC3F2',
  constant: 'F48FB5',
  annotation: 'FFE60A',
} as const

/** Applied after the default rules: on the same token, the later rule wins. */
export const ANTHRACITE_SYNTAX_RULES: editor.ITokenThemeRule[] = [
  { token: 'comment', foreground: SYNTAX.comment, fontStyle: 'italic' },
  { token: 'keyword', foreground: SYNTAX.keyword },
  { token: 'keyword.control', foreground: SYNTAX.keyword },
  { token: 'string', foreground: SYNTAX.string },
  { token: 'string.key.json', foreground: SYNTAX.type },
  { token: 'string.value.json', foreground: SYNTAX.string },
  { token: 'string.escape', foreground: SYNTAX.parameter },
  { token: 'number', foreground: SYNTAX.parameter },
  { token: 'attribute.name', foreground: SYNTAX.property },
  { token: 'attribute.value', foreground: SYNTAX.string },
  { token: 'tag', foreground: SYNTAX.fn },
  // Semantic tokens of the language servers.
  ...['type', 'class', 'interface', 'enum', 'struct', 'namespace'].map((token) => ({ token, foreground: SYNTAX.type })),
  { token: 'typeParameter', foreground: SYNTAX.type, fontStyle: 'italic' },
  ...['function', 'method'].map((token) => ({ token, foreground: SYNTAX.fn })),
  { token: 'parameter', foreground: SYNTAX.parameter },
  { token: 'property', foreground: SYNTAX.property },
  { token: 'javaVariable', foreground: SYNTAX.property },
  ...['variable.readonly', 'javaVariable.readonly', 'property.readonly.static', 'enumMember'].map((token) => ({ token, foreground: SYNTAX.constant })),
  { token: 'annotation', foreground: SYNTAX.annotation },
]

export const ANTHRACITE_EDITOR_COLORS: editor.IColors = {
  'editor.background': '#1C202A',
  'editorGutter.background': '#1C202A',
  'minimap.background': '#1C202A',
  'editor.foreground': '#EEF0F3',
  'editor.lineHighlightBackground': '#3B3F4A',
  'editor.lineHighlightBorder': '#00000000',
  'editor.selectionBackground': '#FFFFFF2E',
  'editorCursor.foreground': '#FFFFFF',
  'editorLineNumber.foreground': '#ACB4C2',
  'editorLineNumber.activeForeground': '#FFFFFF',
  'editorCodeLens.foreground': '#929AA4',
  'editorGutter.foldingControlForeground': '#A4AAB6',
  'editorIndentGuide.background1': '#3B3F4A',
  'editorIndentGuide.activeBackground1': '#5A5F6B',
  'editorLightBulb.foreground': '#FFE60A',
  'editorBracketHighlight.foreground1': '#FFE60A',
  'editorBracketHighlight.foreground2': '#E65C8E',
  'editorBracketHighlight.foreground3': '#5FDCF8',
  'editorBracketHighlight.foreground4': '#FFE60A',
  'editorBracketHighlight.foreground5': '#E65C8E',
  'editorBracketHighlight.foreground6': '#5FDCF8',
  'editorWidget.background': '#2B2F38',
  'editorHoverWidget.background': '#2B2F38',
  'editorSuggestWidget.background': '#2B2F38',
  'editorWidget.border': '#454951',
  'input.background': '#343842',
  'dropdown.background': '#343842',
  'focusBorder': '#E6E8EC',
}

export const ANTHRACITE_TERMINAL: ITheme = {
  background: '#22262F',
  foreground: '#E7EAEF',
  cursor: '#FFFFFF',
  cursorAccent: '#22262F',
  selectionBackground: 'rgba(255, 255, 255, 0.18)',
  black: '#343842',
  red: '#F0707A',
  green: '#20DF70',
  yellow: '#F8C709',
  blue: '#14B6EC',
  magenta: '#CDABF0',
  cyan: '#2FEFF3',
  white: '#E7EAEF',
  brightBlack: '#9AA9B8',
  brightRed: '#F48FB5',
  brightGreen: '#BCEC80',
  brightYellow: '#FFE60A',
  brightBlue: '#5FDCF8',
  brightMagenta: '#DCC3F2',
  brightCyan: '#7FF0F2',
  brightWhite: '#FFFFFF',
}
