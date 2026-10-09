import { accentTokens } from './accentPalette'
import { useSettingsStore } from '@/stores/settings'
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

  // CSS chunks can arrive before their local font files. Monaco caches glyph
  // widths, so discard fallback-font measurements once the real fonts load.
  // Keep this in the lazy Monaco module, not the application's startup path.
  if (document.fonts) {
    const remeasure = () => monaco.editor.remeasureFonts()
    document.fonts.addEventListener('loadingdone', remeasure)
    void document.fonts.ready.then(remeasure)
  }
}

const DARK_COLORS: monaco.editor.IColors = {
  'editor.background': '#0B0F13',
  'editor.foreground': '#F8FAFC',
  'editorLineNumber.foreground': '#4B5563',
  'editorLineNumber.activeForeground': '#94A3B8',
  'editor.selectionBackground': '#7DD3FC33',
  'editor.lineHighlightBackground': '#18212B',
  'editorIndentGuide.background1': '#28313C',
  'editorGutter.background': '#0B0F13',
  'editorWidget.background': '#11171D',
  'editorWidget.border': '#28313C',
  'input.background': '#18212B',
  'dropdown.background': '#18212B',
}

const LIGHT_COLORS: monaco.editor.IColors = {
  'editor.background': '#FAFBFC',
  'editor.foreground': '#172331',
  'editorLineNumber.foreground': '#9AA1AF',
  'editorLineNumber.activeForeground': '#4B5563',
  'editor.selectionBackground': '#087D9B22',
  'editor.lineHighlightBackground': '#F1F5F8',
  'editorIndentGuide.background1': '#DBE1E8',
  'editorGutter.background': '#FAFBFC',
  'editorWidget.background': '#FFFFFF',
  'editorWidget.border': '#DBE1E8',
  'input.background': '#FFFFFF',
  'dropdown.background': '#FFFFFF',
}

let probe: CanvasRenderingContext2D | null | undefined

/** Resolves any CSS color (hex, rgb, oklch, color-mix…) to the #rrggbb Monaco requires. */
function cssToken(name: string): string | undefined {
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

/**
 * Editor surfaces follow the live theme tokens (theme + personal base color),
 * so Monaco never stays white/black while the chrome around it is tinted.
 * Only the active mode is sampled; the other mode keeps its static palette.
 */
function liveSurface(mode: 'dark' | 'light', island: boolean): monaco.editor.IColors {
  const active = document.documentElement.classList.contains('light') ? 'light' : 'dark'
  if (mode !== active) return {}
  const bg = cssToken(island ? '--color-surface-1' : '--color-surface-0')
  const raised = cssToken('--color-surface-2')
  const colors: monaco.editor.IColors = {}
  const set = (key: string, value: string | undefined) => { if (value) colors[key] = value }
  set('editor.background', bg)
  set('editorGutter.background', bg)
  set('minimap.background', bg)
  set('editor.lineHighlightBackground', raised)
  set('editorWidget.background', raised)
  set('editorHoverWidget.background', raised)
  set('editorSuggestWidget.background', raised)
  set('input.background', raised)
  set('dropdown.background', raised)
  set('editor.foreground', cssToken('--color-text-1'))
  set('editorLineNumber.foreground', cssToken('--color-text-3'))
  set('editorLineNumber.activeForeground', cssToken('--color-text-2'))
  set('editorWidget.border', cssToken('--color-border-1'))
  set('editorIndentGuide.background1', cssToken('--color-border-1'))
  return colors
}

function editorAccent(mode: 'dark' | 'light'): monaco.editor.IColors {
  const tokens = accentTokens(useSettingsStore.getState().settings.appearance.accentColor ?? '', mode)
  return tokens.accent ? { 'editor.selectionBackground': tokens.accent + '33', 'editorCursor.foreground': tokens.accent, 'focusBorder': tokens.accent } : {}
}

export function applyAdomniaMonacoTheme(m: typeof monaco): void {
  m.editor.defineTheme('adomnia-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: { ...DARK_COLORS, ...liveSurface('dark', false), ...editorAccent('dark') },
  })
  m.editor.defineTheme('adomnia-light', {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: { ...LIGHT_COLORS, ...liveSurface('light', false), ...editorAccent('light') },
  })
}

/**
 * Monaco has one theme for the whole page: every editor must follow the app
 * mode, or a single hardcoded dark editor turns Go Studio dark in White.
 */
export function useAdomniaEditorTheme(): 'adomnia-light' | 'adomnia-dark' {
  return useSettingsStore((state) => state.settings.appearance.theme === 'light' ? 'adomnia-light' : 'adomnia-dark')
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
  'editor.background': '#11171D',
  'editorGutter.background': '#11171D',
  'editor.lineHighlightBackground': '#222D39',
  'editor.lineHighlightBorder': '#00000000',
  'editorWidget.background': '#222D39',
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
  m.editor.defineTheme(GO_STUDIO_THEMES.dark, { base: 'vs-dark', inherit: true, rules: GO_SEMANTIC_RULES_DARK, colors: { ...GO_STUDIO_DARK_COLORS, ...liveSurface('dark', true), ...editorAccent('dark') } })
  m.editor.defineTheme(GO_STUDIO_THEMES.light, { base: 'vs', inherit: true, rules: GO_SEMANTIC_RULES_LIGHT, colors: { ...GO_STUDIO_LIGHT_COLORS, ...liveSurface('light', true), ...editorAccent('light') } })
}

useSettingsStore.subscribe((state, previous) => {
  if (state.settings.appearance.accentColor !== previous.settings.appearance.accentColor) applyGoStudioMonacoThemes(monaco)
})
// Redefining an active theme repaints every open editor immediately.
window.addEventListener('adomnia:theme-tokens', () => applyGoStudioMonacoThemes(monaco))

export { monaco }
