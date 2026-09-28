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

export function applyAdomniaMonacoTheme(m: typeof monaco): void {
  m.editor.defineTheme('adomnia-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
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
    },
  })
  m.editor.defineTheme('adomnia-light', {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: {
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
    },
  })
}

export { monaco }
