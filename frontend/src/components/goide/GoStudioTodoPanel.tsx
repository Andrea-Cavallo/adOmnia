import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { requestProjectSearch, type GoIDESearchMatch } from '@/lib/goide-lsp-api'
import { useGoIDEStore } from '@/stores/goide'

/** Commenti TODO/FIXME/XXX/BUG in Go, YAML, shell e affini: solo dopo un marcatore di commento. */
export const TODO_PATTERN = String.raw`(?://|/\*|#)\s*(TODO|FIXME|XXX|BUG)\b`
const TODO_KEYWORD = /\b(TODO|FIXME|XXX|BUG)\b[:\s-]*(.*)$/
const KEYWORDS = ['TODO', 'FIXME', 'XXX', 'BUG'] as const
type TodoKeyword = (typeof KEYWORDS)[number]

export interface GoStudioTodoItem {
  keyword: TodoKeyword
  text: string
  match: GoIDESearchMatch
}

/** Estrae parola chiave e testo del commento da un risultato di ricerca. */
export function todoItemFor(match: GoIDESearchMatch): GoStudioTodoItem | null {
  const found = TODO_KEYWORD.exec(match.preview)
  if (!found) return null
  const text = found[2].replace(/\*\/\s*$/, '').trim()
  return { keyword: found[1] as TodoKeyword, text: text || '(no description)', match }
}

const KEYWORD_CLASS: Record<TodoKeyword, string> = {
  TODO: 'bg-accent/15 text-accent',
  FIXME: 'bg-danger/15 text-danger',
  XXX: 'bg-warning/15 text-warning',
  BUG: 'bg-danger/15 text-danger',
}

/** Finestra TODO: commenti da completare nel progetto, raggruppati per file e cliccabili. */
export const GoStudioTodoPanel = memo(function GoStudioTodoPanel({ sessionId }: { sessionId: string }) {
  const openLocation = useGoIDEStore((state) => state.openLocation)
  const [items, setItems] = useState<GoStudioTodoItem[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<TodoKeyword | 'all'>('all')

  const scan = useCallback(() => {
    setLoading(true)
    setError(null)
    let current = true
    const request = requestProjectSearch({ sessionId, pattern: TODO_PATTERN, regex: true, caseSensitive: true, wholeWord: false, include: [], exclude: [] })
    request.then((result) => { if (current) setItems(result.matches.map(todoItemFor).filter((item): item is GoStudioTodoItem => item !== null)) })
      // Una scansione annullata (pannello chiuso o nuova scansione) non è un errore da mostrare.
      .catch((reason: unknown) => { if (current && !String(reason).toLowerCase().includes('cancel')) setError(reason instanceof Error ? reason.message : String(reason)) })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false; void request.cancel() }
  }, [sessionId])

  useEffect(() => scan(), [scan])

  const visible = useMemo(() => (items ?? []).filter((item) => filter === 'all' || item.keyword === filter), [filter, items])
  const groups = useMemo(() => {
    const byFile = new Map<string, GoStudioTodoItem[]>()
    for (const item of visible) byFile.set(item.match.relativePath, [...(byFile.get(item.match.relativePath) ?? []), item])
    return [...byFile.entries()]
  }, [visible])
  const counts = useMemo(() => Object.fromEntries(KEYWORDS.map((keyword) => [keyword, (items ?? []).filter((item) => item.keyword === keyword).length])), [items])

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-0">
      <div role="toolbar" aria-label="TODO toolbar" className="flex h-8 shrink-0 items-center gap-1 border-b border-border-1 bg-surface-1 px-2">
        <button type="button" onClick={() => scan()} title="Rescan project" aria-label="Rescan project" className="grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3">{loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}</button>
        {(['all', ...KEYWORDS] as const).map((keyword) => (
          <button key={keyword} type="button" aria-pressed={filter === keyword} onClick={() => setFilter(keyword)}
            className={`h-6 rounded px-2 text-[10px] font-semibold ${filter === keyword ? 'bg-accent/15 text-text-1' : 'text-text-3 hover:bg-surface-3'}`}>
            {keyword === 'all' ? `All ${items?.length ?? 0}` : `${keyword} ${counts[keyword] ?? 0}`}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1 text-[11px]">
        {error && <p role="alert" className="px-3 py-2 text-danger">{error}</p>}
        {items && visible.length === 0 && !loading && <p className="px-3 py-2 text-text-4">No TODO or FIXME comments.</p>}
        {groups.map(([file, entries]) => (
          <div key={file}>
            <div className="px-3 pb-0.5 pt-1.5 font-mono text-[10px] text-text-3">{file} <span className="text-text-4">· {entries.length}</span></div>
            {entries.map((item) => (
              <button key={`${file}:${item.match.line}:${item.match.column}`} type="button" onClick={() => void openLocation(file, item.match.line, item.match.column)}
                className="flex w-full items-center gap-2 px-3 py-0.5 text-left hover:bg-surface-2">
                <span className="w-8 shrink-0 text-right font-mono text-[10px] text-text-4">{item.match.line}</span>
                <span className={`shrink-0 rounded px-1 text-[9px] font-semibold ${KEYWORD_CLASS[item.keyword]}`}>{item.keyword}</span>
                <span className="min-w-0 flex-1 truncate text-text-2">{item.text}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
})
