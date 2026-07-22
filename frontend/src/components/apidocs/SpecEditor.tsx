import { useEffect, useRef } from 'react'
import Editor, { loader, type BeforeMount, type OnMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import yamlWorker from 'monaco-yaml/yaml.worker?worker'
import { configureMonacoYaml } from 'monaco-yaml'
import { openapi } from '@apidevtools/openapi-schemas'

// adOmnia is local-first: load Monaco from the bundle, never a CDN.
;(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'json') return new jsonWorker()
    if (label === 'yaml') return new yamlWorker()
    return new editorWorker()
  },
}
loader.config({ monaco })

// OpenAPI 3.0 meta-schema drives schema-aware completion + hover for both YAML
// and JSON. ponytail: validation is OFF — the 3.0 schema would false-flag valid
// 3.1 docs (e.g. `openapi: 3.1.0`), and our own parser already owns validation.
const OPENAPI_SCHEMA_URI = 'https://spec.openapis.org/oas/3.0/schema'
const OPENAPI_SCHEMAS = [
  { uri: OPENAPI_SCHEMA_URI, fileMatch: ['*'], schema: openapi.v3 as object },
]

export type SpecLanguage = 'yaml' | 'json'

export interface EditorMarker {
  line: number
  column?: number
  message: string
}

interface SpecEditorProps {
  value: string
  language: SpecLanguage
  markers: EditorMarker[]
  onChange: (value: string) => void
  onCursor?: (line: number, column: number) => void
}

let providersRegistered = false

function registerProviders(m: typeof monaco): void {
  if (providersRegistered) return
  providersRegistered = true

  // Schema-aware IntelliSense for JSON (native worker) and YAML (monaco-yaml).
  m.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: false,
    enableSchemaRequest: false,
    schemas: OPENAPI_SCHEMAS,
  })
  configureMonacoYaml(m, {
    enableSchemaRequest: false,
    validate: false,
    completion: true,
    hover: true,
    schemas: OPENAPI_SCHEMAS,
  })

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

  // $ref target completion: offer schema names declared in THIS document — the
  // OpenAPI meta-schema types $ref as a plain string, so the language service
  // cannot suggest instance-local component names. This provider fills that gap.
  for (const lang of ['yaml', 'json'] as const) {
    m.languages.registerCompletionItemProvider(lang, {
      triggerCharacters: ['/', '#'],
      provideCompletionItems(model, position) {
        const line = model.getLineContent(position.lineNumber)
        if (!/\$ref\b/.test(line)) return { suggestions: [] }

        const word = model.getWordUntilPosition(position)
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        }
        const text = model.getValue()
        const names = new Set<string>()
        const block = text.match(/(?:components:[\s\S]*?schemas:|definitions:)([\s\S]*)/)
        if (block) {
          for (const match of block[1].matchAll(/^\s{2,}([A-Za-z0-9_.-]+):/gm)) names.add(match[1])
        }
        const prefix = text.includes('definitions:') ? '#/definitions/' : '#/components/schemas/'
        return {
          suggestions: Array.from(names).map((n) => ({
            label: `${prefix}${n}`,
            kind: m.languages.CompletionItemKind.Reference,
            insertText: `${prefix}${n}`,
            range,
          })),
        }
      },
    })
  }
}

export function SpecEditor({ value, language, markers, onChange, onCursor }: SpecEditorProps) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)

  const beforeMount: BeforeMount = (m) => registerProviders(m)

  const onMount: OnMount = (editor) => {
    editorRef.current = editor
    editor.onDidChangeCursorPosition((e) => onCursor?.(e.position.lineNumber, e.position.column))
  }

  // Re-apply error markers whenever they change and an editor exists.
  useEffect(() => {
    if (editorRef.current) applyMarkers(monaco, editorRef.current, markers)
  }, [markers])

  return (
    <Editor
      language={language}
      value={value}
      theme="adomnia-dark"
      beforeMount={beforeMount}
      onMount={onMount}
      onChange={(next) => onChange(next ?? '')}
      options={{
        fontSize: 12,
        fontFamily: "'Space Mono', ui-monospace, monospace",
        lineHeight: 20,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        insertSpaces: true,
        wordWrap: 'off',
        folding: true,
        renderLineHighlight: 'line',
        smoothScrolling: true,
        padding: { top: 8, bottom: 8 },
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
        bracketPairColorization: { enabled: true },
        quickSuggestions: { other: true, comments: false, strings: true },
      }}
    />
  )
}

function applyMarkers(
  m: typeof monaco,
  editor: monaco.editor.IStandaloneCodeEditor,
  markers: EditorMarker[],
): void {
  const model = editor.getModel()
  if (!model) return
  m.editor.setModelMarkers(
    model,
    'adomnia-openapi',
    markers.map((mk) => ({
      severity: m.MarkerSeverity.Error,
      message: mk.message,
      startLineNumber: Math.min(mk.line, model.getLineCount()),
      startColumn: mk.column ?? 1,
      endLineNumber: Math.min(mk.line, model.getLineCount()),
      endColumn: model.getLineMaxColumn(Math.min(mk.line, model.getLineCount())),
    })),
  )
}
