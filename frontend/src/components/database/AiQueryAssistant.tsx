import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Sparkles, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { suggestQueryWithAI, lineDiff, type AiSchemaTable } from './aiQuerySuggest'
import { interpret, type DbKind } from './queryInterpreter'

interface AiQueryAssistantProps {
  driver: DbKind
  /** Provider name from Settings, shown so the user knows where the request goes. */
  provider: string
  currentQuery: string
  schema: AiSchemaTable[]
  /** Puts the suggestion in the editor. Never runs it. */
  onInsert: (query: string) => void
  onClose: () => void
}

const RISK_STYLE = {
  read: 'bg-success/15 text-success',
  write: 'bg-warning/15 text-warning',
  destructive: 'bg-error/15 text-error',
} as const
const RISK_LABEL = { read: 'Read', write: 'Write', destructive: 'Destructive' } as const

const DIFF_STYLE = {
  same: 'text-text-3',
  add: 'bg-success/10 text-success',
  del: 'bg-error/10 text-error line-through decoration-error/40',
} as const
const DIFF_MARK = { same: ' ', add: '+', del: '-' } as const

export function AiQueryAssistant({ driver, provider, currentQuery, schema, onInsert, onClose }: AiQueryAssistantProps) {
  const [intent, setIntent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [suggestion, setSuggestion] = useState('')
  const intentRef = useRef<HTMLInputElement>(null)

  // The assistant opens on demand: the cursor starts in the field, without the `autoFocus` attribute.
  useEffect(() => { intentRef.current?.focus() }, [])

  const interpretation = useMemo(() => (suggestion ? interpret(driver, suggestion) : null), [driver, suggestion])
  const diff = useMemo(() => {
    const seen = new Map<string, number>()
    return (suggestion ? lineDiff(currentQuery, suggestion) : []).map((line) => {
      const base = `${line.kind}:${line.text}`
      const occurrence = seen.get(base) ?? 0
      seen.set(base, occurrence + 1)
      return { ...line, key: `${base}#${occurrence}` }
    })
  }, [currentQuery, suggestion])

  const ask = async () => {
    setBusy(true)
    setError('')
    setSuggestion('')
    try {
      setSuggestion(await suggestQueryWithAI({ driver, intent, currentQuery, schema }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Ask AI for a query" className="!flex-none border-b border-border-1 bg-surface-1 px-3 py-2">
      <div className="flex items-center gap-2">
        <Sparkles size={13} className="flex-none text-accent" />
        <input
          ref={intentRef}
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void ask(); if (e.key === 'Escape') onClose() }}
          placeholder="Describe the query you need, e.g. “customers with no orders in 2025”"
          aria-label="What should the query do?"
          className="h-7 min-w-0 flex-1 rounded-md border border-border-2 bg-surface-2 px-2.5 text-[11.5px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent/60"
        />
        <button
          onClick={() => void ask()}
          disabled={busy || !intent.trim()}
          className="flex h-7 flex-none items-center gap-1.5 rounded-md bg-accent px-3 text-[11.5px] font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Suggest
        </button>
        <button onClick={onClose} aria-label="Close Ask AI" className="grid h-7 w-7 flex-none place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1"><X size={13} /></button>
      </div>
      <p className="mt-1 pl-6 text-[10.5px] text-text-4">
        Sends table and column names and the current query to {provider}. No result rows. Nothing runs until you run it.
      </p>

      {error && <div role="alert" className="mt-2 rounded border border-error/30 bg-error/10 px-2.5 py-1.5 text-[11px] text-error">{error}</div>}

      {suggestion && interpretation && (
        <div className="mt-2 rounded-md border border-border-2 bg-surface-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-border-1 px-2.5 py-1.5 text-[11px]">
            <span className={cn('rounded px-1.5 py-px text-[10px] font-semibold', RISK_STYLE[interpretation.risk])}>{RISK_LABEL[interpretation.risk]}</span>
            <span className="min-w-0 flex-1 truncate text-text-2" title={interpretation.summary}>{interpretation.summary}</span>
            {interpretation.issues.slice(0, 3).map((issue) => (
              <span key={issue} className="rounded border border-border-2 bg-surface-2 px-1.5 py-px text-[10px] text-text-3">{issue}</span>
            ))}
          </div>
          <pre className="max-h-44 overflow-auto px-2.5 py-2 font-mono text-[11.5px] leading-[18px]">
            {diff.map((line) => (
              <div key={line.key} className={cn('whitespace-pre', DIFF_STYLE[line.kind])}>
                <span aria-hidden className="mr-2 select-none text-text-4">{DIFF_MARK[line.kind]}</span>{line.text || ' '}
              </div>
            ))}
          </pre>
          <div className="flex justify-end gap-2 border-t border-border-1 px-2.5 py-1.5">
            <button onClick={() => setSuggestion('')} className="h-7 rounded-md border border-border-2 px-3 text-[11.5px] text-text-2 hover:bg-surface-3">Discard</button>
            <button onClick={() => { onInsert(suggestion); setSuggestion('') }} className="h-7 rounded-md bg-accent px-3 text-[11.5px] font-semibold text-white hover:bg-accent-hover">Insert in editor</button>
          </div>
        </div>
      )}
    </section>
  )
}
