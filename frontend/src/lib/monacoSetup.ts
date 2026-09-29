import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/language/json/json.worker?worker'
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker'
import yamlWorker from 'monaco-yaml/yaml.worker?worker'

let loaderConfigured = false

export function configureMonacoLoader(): void {
  if (loaderConfigured) return
  loaderConfigured = true

  // adOmnia is local-first: all Monaco workers come from the local bundle.
  ;(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      if (label === 'json') return new jsonWorker()
      if (label === 'yaml') return new yamlWorker()
      if (label === 'javascript' || label === 'typescript') return new tsWorker()
      return new editorWorker()
    },
  }
  loader.config({ monaco })
}

const DARK_COLORS: monaco.editor.IColors = {
  'editor.background': '#05070D',
  'editor.foreground': '#F8FAFC',
  'editorLineNumber.foreground': '#4B5563',
  'editorLineNumber.activeForeground': '#94A3B8',
  'editor.selectionBackground': '#2563EB44',
  'editor.lineHighlightBackground': '#0E111A',
  'editorIndentGuide.background1': '#1F2333',
  'editorGutter.background': '#05070D',
  'editorWidget.background': '#0B0D14',
  'editorWidget.border': '#1F2333',
  'input.background': '#0E111A',
  'dropdown.background': '#0E111A',
}

const LIGHT_COLORS: monaco.editor.IColors = {
  'editor.background': '#F7F8FB',
  'editor.foreground': '#151821',
  'editorLineNumber.foreground': '#9AA1AF',
  'editorLineNumber.activeForeground': '#4B5563',
  'editor.selectionBackground': '#7C3AED22',
  'editor.lineHighlightBackground': '#EEF0F5',
  'editorIndentGuide.background1': '#D8DCE5',
  'editorGutter.background': '#F7F8FB',
  'editorWidget.background': '#FFFFFF',
  'editorWidget.border': '#D8DCE5',
  'input.background': '#FFFFFF',
  'dropdown.background': '#FFFFFF',
}

export function applyAdomniaMonacoTheme(m: typeof monaco): void {
  m.editor.defineTheme('adomnia-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: DARK_COLORS,
  })
  m.editor.defineTheme('adomnia-light', {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: LIGHT_COLORS,
  })
}

/** Semantic tokens di gopls: solo nei temi di Go Studio, così gli altri editor di adOmnia restano invariati. */
const GO_SEMANTIC_RULES_DARK: monaco.editor.ITokenThemeRule[] = [
  { token: 'parameter', foreground: 'E6B673' },
  { token: 'variable.readonly', foreground: 'C4A7FF' },
  { token: 'function', foreground: '7DD3FC' },
  { token: 'method', foreground: '7DD3FC' },
  { token: 'type', foreground: '5EEAD4' },
  { token: 'typeParameter', foreground: '5EEAD4', fontStyle: 'italic' },
  { token: 'namespace', foreground: 'A5B4FC' },
  { token: 'property', foreground: 'D8B4FE' },
]

const GO_SEMANTIC_RULES_LIGHT: monaco.editor.ITokenThemeRule[] = [
  { token: 'parameter', foreground: '9A5B00' },
  { token: 'variable.readonly', foreground: '6D28D9' },
  { token: 'function', foreground: '0369A1' },
  { token: 'method', foreground: '0369A1' },
  { token: 'type', foreground: '0F766E' },
  { token: 'typeParameter', foreground: '0F766E', fontStyle: 'italic' },
  { token: 'namespace', foreground: '4338CA' },
  { token: 'property', foreground: '7E22CE' },
]

export const GO_STUDIO_THEMES = { dark: 'adomnia-go-dark', light: 'adomnia-go-light' } as const

/** Sfondo dell'editor uguale alle isole di Go Studio (--gs-island in goStudioChrome.css). */
const GO_STUDIO_DARK_COLORS: monaco.editor.IColors = {
  ...DARK_COLORS,
  'editor.background': '#0B0D14',
  'editorGutter.background': '#0B0D14',
  'editor.lineHighlightBackground': '#131722',
  'editor.lineHighlightBorder': '#00000000',
  'editorWidget.background': '#131722',
}

const GO_STUDIO_LIGHT_COLORS: monaco.editor.IColors = {
  ...LIGHT_COLORS,
  'editor.background': '#FFFFFF',
  'editorGutter.background': '#FFFFFF',
  'editor.lineHighlightBackground': '#F1F5F9',
  'editor.lineHighlightBorder': '#00000000',
}

/** Temi di Go Studio: colori di adOmnia sullo sfondo delle isole, più le regole per i semantic tokens. */
export function applyGoStudioMonacoThemes(m: typeof monaco): void {
  applyAdomniaMonacoTheme(m)
  m.editor.defineTheme(GO_STUDIO_THEMES.dark, { base: 'vs-dark', inherit: true, rules: GO_SEMANTIC_RULES_DARK, colors: GO_STUDIO_DARK_COLORS })
  m.editor.defineTheme(GO_STUDIO_THEMES.light, { base: 'vs', inherit: true, rules: GO_SEMANTIC_RULES_LIGHT, colors: GO_STUDIO_LIGHT_COLORS })
}

export { monaco }
