import { useState } from 'react'
import { cn } from '@/lib/utils'

interface ScriptsEditorProps {
  pre: string
  post: string
  tests: string
  onChange: (scripts: { pre: string; post: string; tests: string }) => void
  initialTab?: ScriptTab
}

type ScriptTab = 'pre' | 'post' | 'tests'

export function ScriptsEditor({ pre, post, tests, onChange, initialTab = 'tests' }: ScriptsEditorProps) {
  const [tab, setTab] = useState<ScriptTab>(initialTab)

  const tabClass = (t: ScriptTab) =>
    cn('px-3 py-1.5 text-xs border-b-2 transition-colors', tab === t ? 'border-accent text-text-1' : 'border-transparent text-text-3 hover:text-text-2')

  const value = tab === 'pre' ? pre : tab === 'post' ? post : tests

  const handleChange = (v: string) => {
    if (tab === 'pre') onChange({ pre: v, post, tests })
    else if (tab === 'post') onChange({ pre, post: v, tests })
    else onChange({ pre, post, tests: v })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-2 pb-2">
      <div className="flex gap-1 border-b border-border-1">
        <button className={tabClass('pre')} onClick={() => setTab('pre')}>Pre-request</button>
        <button className={tabClass('post')} onClick={() => setTab('post')}>Post-response</button>
        <button className={tabClass('tests')} onClick={() => setTab('tests')}>Tests</button>
      </div>
      <div className="rounded border border-warning/25 bg-warning/10 px-3 py-2 text-[11px] leading-relaxed text-text-2">
        Scripts run locally for this workspace and can read or modify request, response, and environment data. Use code you trust.
      </div>
      <textarea
        aria-label={`${tab} JavaScript editor`}
        className="min-h-[240px] flex-1 p-3 bg-surface-2 border border-border-2 rounded font-mono text-xs text-text-1 placeholder:text-text-4 resize-none focus:border-accent outline-none"
        placeholder={
          tab === 'pre'
            ? '// Pre-request script (pm.* API compatible)\npm.environment.set("timestamp", Date.now());'
            : tab === 'post'
            ? '// Post-response script\nconst json = pm.response.json();\npm.environment.set("token", json.token);'
            : '// Test assertions\npm.test("Status is 200", () => {\n  pm.expect(pm.response.code).to.equal(200);\n});'
        }
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        spellCheck={false}
      />
    </div>
  )
}
