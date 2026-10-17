import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Loader2, RefreshCw } from 'lucide-react'
import { saveBase64File } from '@/lib/fileUtils'
import { todosToMarkdown } from '@/lib/code-studio/todoExport'
import { requestProjectSearch, type GoIDESearchMatch } from '@/lib/code-studio-lsp-api'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { lineCommentStart, lineCommentToken } from './codeStudioCommentTags'

/** Commenti TODO/FIXME/XXX/BUG in Go, YAML, shell e affini: solo dopo un marcatore di commento. */
export const TODO_PATTERN = String.raw`(?://|/\*|#)\s*(TODO|FIXME|XXX|BUG)\b`
const TODO_KEYWORD = /\b(TODO|FIXME|XXX|BUG)\b[:\s-]*(.*)$/
const KEYWORDS = ['TODO', 'FIXME', 'XXX', 'BUG'] as const
type TodoKeyword = (typeof KEYWORDS)[number]

export interface CodeStudioTodoItem {
  keyword: TodoKeyword
  text: string
  match: GoIDESearchMatch
}

/** Testo dopo il marcatore di commento, ignorando quelli dentro le stringhe ("// TODO" in una fixture non è un TODO). */
function commentBody(preview: string, relativePath: string): string | null {
  const token = lineCommentToken(relativePath)
  const start = [token, ...(token === '//' ? ['/*'] : [])].map((marker) => ({ marker, at: lineCommentStart(preview, marker) })).filter((hit) => hit.at >= 0).sort((a, b) => a.at - b.at)[0]
  if (!start) return null
  const body = preview.slice(start.at + start.marker.length)
  return /^[\s*/!-]*(?:TODO|FIXME|XXX|BUG)\b/.test(body) ? body : null
}

/** Estrae parola chiave e testo del commento da un risultato di ricerca. */
export function todoItemFor(match: GoIDESearchMatch): CodeStudioTodoItem | null {
  const body = commentBody(match.preview, match.relativePath ?? '')
  const found = body === null ? null : TODO_KEYWORD.exec(body)
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
export const CodeStudioTodoPanel = memo(function CodeStudioTodoPanel({ sessionId }: { sessionId: string }) {
  const openLocation = useCodeStudioStore((state) => state.openLocation)
  const project = useCodeStudioStore((state) => state.sessions.find((session) => session.id === sessionId)?.project)
  const [items, setItems] = useState<CodeStudioTodoItem[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<TodoKeyword | 'all'>('all')

  const scan = useCallback(() => {
    setLoading(true)
    setError(null)
    let current = true
    const request = requestProjectSearch({ sessionId, pattern: TODO_PATTERN, regex: true, caseSensitive: true, wholeWord: false, include: [], exclude: [] })
    request.then((result) => { if (current) setItems(result.matches.map(todoItemFor).filter((item): item is CodeStudioTodoItem => item !== null)) })
      // Una scansione annullata (pannello chiuso o nuova scansione) non è un errore da mostrare.
      .catch((reason: unknown) => { if (current && !String(reason).toLowerCase().includes('cancel')) setError(reason instanceof Error ? reason.message : String(reason)) })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false; void request.cancel() }
  }, [sessionId])

  useEffect(() => scan(), [scan])

  const exportMarkdown = useCallback(() => {
    if (!project || !items) return
    const projectRoot = project.rootPath ?? ''
    const projectName = projectRoot.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? 'project'
    const markdown = todosToMarkdown(
      items.map((item) => ({ keyword: item.keyword, text: item.text, relativePath: item.match.relativePath ?? '', line: item.match.line })),
      { projectName, projectRoot, units: project.units ?? [] },
    )
    const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(markdown)))
    saveBase64File(`TODO-${projectName}.md`, base64).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
  }, [items, project])

  const visible = useMemo(() => (items ?? []).filter((item) => filter === 'all' || item.keyword === filter), [filter, items])
  const groups = useMemo(() => {
    const byFile = new Map<string, CodeStudioTodoItem[]>()
    for (const item of visible) byFile.set(item.match.relativePath, [...(byFile.get(item.match.relativePath) ?? []), item])
    return [...byFile.entries()]
  }, [visible])
  const counts = useMemo(() => Object.fromEntries(KEYWORDS.map((keyword) => [keyword, (items ?? []).filter((item) => item.keyword === keyword).length])), [items])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div role="toolbar" aria-label="TODO toolbar" className="flex h-8 shrink-0 items-center gap-1 border-b border-border-1 px-2">
        <button type="button" onClick={() => scan()} title="Rescan project" aria-label="Rescan project" className="grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3">{loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}</button>
        {(['all', ...KEYWORDS] as const).map((keyword) => (
          <button key={keyword} type="button" aria-pressed={filter === keyword} onClick={() => setFilter(keyword)}
            className={`h-6 rounded px-2 text-[10px] font-semibold ${filter === keyword ? 'bg-accent/15 text-text-1' : 'text-text-3 hover:bg-surface-3'}`}>
            {keyword === 'all' ? `All ${items?.length ?? 0}` : `${keyword} ${counts[keyword] ?? 0}`}
          </button>
        ))}
        <button type="button" onClick={exportMarkdown} disabled={!items?.length} title="Export all TODOs as Markdown, grouped by module" aria-label="Export TODOs as Markdown"
          className="ml-auto flex h-6 items-center gap-1 rounded px-2 text-[10px] font-semibold text-text-3 hover:bg-surface-3 disabled:opacity-40"><Download size={11} />Export .md</button>
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
