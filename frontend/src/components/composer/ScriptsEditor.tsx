import { useState } from 'react'
import Editor, { type BeforeMount } from '@monaco-editor/react'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { applyAdomniaMonacoTheme, configureMonacoLoader, monaco } from '@/lib/monacoSetup'

interface ScriptsEditorProps {
  pre: string
  post: string
  tests: string
  onChange: (scripts: { pre: string; post: string; tests: string }) => void
  initialTab?: ScriptTab
}

type ScriptTab = 'pre' | 'post' | 'tests'

interface ScriptDiagnostic {
  line: number
  column: number
  message: string
}

let javascriptDefaultsConfigured = false

function configureJavaScript(m: typeof monaco): void {
  applyAdomniaMonacoTheme(m)
  if (javascriptDefaultsConfigured) return
  javascriptDefaultsConfigured = true

  // Scripts intentionally expose a dynamic pm.* API. Syntax diagnostics catch
  // malformed JavaScript without showing misleading "pm is not defined" errors.
  m.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSyntaxValidation: false,
    noSemanticValidation: true,
  })
  m.typescript.javascriptDefaults.setCompilerOptions({
    allowNonTsExtensions: true,
    target: m.typescript.ScriptTarget.ES2020,
  })
}

configureMonacoLoader()

export function ScriptsEditor({ pre, post, tests, onChange, initialTab = 'tests' }: ScriptsEditorProps) {
  const [tab, setTab] = useState<ScriptTab>(initialTab)
  const [diagnostic, setDiagnostic] = useState<ScriptDiagnostic | null>(null)

  const tabClass = (t: ScriptTab) =>
    cn('px-3 py-1.5 text-xs border-b-2 transition-colors', tab === t ? 'border-accent text-text-1' : 'border-transparent text-text-3 hover:text-text-2')

  const value = tab === 'pre' ? pre : tab === 'post' ? post : tests

  const handleChange = (next: string) => {
    if (tab === 'pre') onChange({ pre: next, post, tests })
    else if (tab === 'post') onChange({ pre, post: next, tests })
    else onChange({ pre, post, tests: next })
  }

  const handleTabChange = (next: ScriptTab) => {
    setTab(next)
    setDiagnostic(null)
  }

  const beforeMount: BeforeMount = (m) => configureJavaScript(m)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-2 pb-2">
      <div className="flex gap-1 border-b border-border-1">
        <button className={tabClass('pre')} onClick={() => handleTabChange('pre')}>Pre-request</button>
        <button className={tabClass('post')} onClick={() => handleTabChange('post')}>Post-response</button>
        <button className={tabClass('tests')} onClick={() => handleTabChange('tests')}>Tests</button>
      </div>
      <div className="rounded border border-warning/25 bg-warning/10 px-3 py-2 text-[11px] leading-relaxed text-text-2">
        Scripts run locally for this workspace and can read or modify request, response, and environment data. Use code you trust.
      </div>
      {diagnostic && (
        <div role="alert" className="flex items-start gap-2 rounded border border-error/40 bg-error/10 px-3 py-2 text-[11px] leading-relaxed text-error">
          <AlertTriangle className="mt-0.5 shrink-0" size={14} aria-hidden="true" />
          <span>
            <span className="font-semibold">JavaScript syntax error</span>
            {` · Line ${diagnostic.line}, column ${diagnostic.column}: ${diagnostic.message}`}
          </span>
        </div>
      )}
      <div className="min-h-[240px] flex-1 overflow-hidden rounded border border-border-2 bg-[#05070D] focus-within:border-accent">
        <Editor
          path={`inmemory://adomnia/request-scripts/${tab}.js`}
          language="javascript"
          value={value}
          theme="adomnia-dark"
          beforeMount={beforeMount}
          onChange={(next) => handleChange(next ?? '')}
          onValidate={(markers) => {
            const issue = markers.find((marker) => marker.severity === monaco.MarkerSeverity.Error)
            setDiagnostic(issue ? {
              line: issue.startLineNumber,
              column: issue.startColumn,
              message: issue.message.replace(/\s+/g, ' '),
            } : null)
          }}
          options={{
            fontSize: 12,
            fontFamily: "'Space Mono', ui-monospace, monospace",
            lineHeight: 20,
            minimap: { enabled: false },
            automaticLayout: true,
            scrollBeyondLastLine: false,
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
      </div>
    </div>
  )
}
