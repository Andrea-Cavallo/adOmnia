import type { editor } from 'monaco-editor'

export function codeStudioSyntaxRules(light: boolean): editor.ITokenThemeRule[] {
  return [
    { token: 'comment', foreground: light ? '596574' : '96A2AE', fontStyle: '' },
    { token: 'keyword', foreground: light ? '7C3AAD' : 'C9A7EB' },
    { token: 'keyword.control', foreground: light ? '7C3AAD' : 'C9A7EB' },
    { token: 'string', foreground: light ? '386D21' : 'B6D991' },
    { token: 'string.escape', foreground: light ? '9A5016' : 'E6B673' },
    { token: 'number', foreground: light ? '9A5016' : 'E6B673' },
    { token: 'invalid', foreground: light ? 'B42332' : 'FF8994', fontStyle: 'underline' },
  ]
}

export function codeStudioGutterColors(light: boolean): editor.IColors {
  return {
    'editorLineNumber.foreground': light ? '#647184' : '#8593A2',
    'editorLineNumber.activeForeground': light ? '#172331' : '#EDF2F7',
    'editorGutter.foldingControlForeground': light ? '#647184' : '#A4AFBC',
    'editorIndentGuide.activeBackground1': light ? '#8997A8' : '#637183',
    'editorError.foreground': light ? '#B42332' : '#FF8994',
    'editorWarning.foreground': light ? '#956000' : '#E6B673',
    'editorInfo.foreground': light ? '#0369A1' : '#7DD3FC',
    'editorOverviewRuler.errorForeground': light ? '#B42332' : '#FF8994',
    'editorOverviewRuler.warningForeground': light ? '#956000' : '#E6B673',
    'editor.lineHighlightBorder': '#00000000',
  }
}
