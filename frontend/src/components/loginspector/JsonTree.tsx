import { useMemo, useState } from 'react'
import { Braces, Check, ChevronRight, Copy, Route, Search, WrapText, X } from 'lucide-react'
import { cn } from '@/lib/utils'

type JsonKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'

interface TreeRow {
  path: string
  key: string
  depth: number
  kind: JsonKind
  expandable: boolean
  childCount: number
  value: unknown
}

const KIND_COLOR: Record<JsonKind, string> = {
  object: 'var(--color-text-2)',
  array: 'var(--color-text-2)',
  string: 'var(--color-json-string)',
  number: 'var(--color-json-number)',
  boolean: 'var(--color-json-bool)',
  null: 'var(--color-json-null)',
}

function kindOf(value: unknown): JsonKind {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'object'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return 'string'
}

function childEntries(value: unknown): [string, unknown][] {
  if (Array.isArray(value)) return value.map((item, index) => [String(index), item])
  if (value && typeof value === 'object') return Object.entries(value as Record<string, unknown>)
  return []
}

function joinPath(parentPath: string, key: string, parentIsArray: boolean): string {
  if (parentIsArray) return `${parentPath}[${key}]`
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${parentPath}.${key}` : `${parentPath}["${key}"]`
}

function preview(value: unknown, kind: JsonKind): string {
  if (kind === 'string') return JSON.stringify(value)
  if (kind === 'null') return 'null'
  if (kind === 'object' || kind === 'array') return ''
  return String(value)
}

function flatten(
  value: unknown,
  path: string,
  key: string,
  depth: number,
  expanded: Set<string>,
  out: TreeRow[],
): void {
  const kind = kindOf(value)
  const entries = childEntries(value)
  out.push({
    path,
    key,
    depth,
    kind,
    expandable: entries.length > 0,
    childCount: entries.length,
    value,
  })
  if (!entries.length || !expanded.has(path)) return
  const isArray = kind === 'array'
  for (const [childKey, childValue] of entries) {
    flatten(childValue, joinPath(path, childKey, isArray), childKey, depth + 1, expanded, out)
  }
}

function collectPaths(value: unknown, path: string, out: Set<string>, budget = { left: 20000 }): void {
  const entries = childEntries(value)
  if (!entries.length || budget.left <= 0) return
  out.add(path)
  budget.left--
  const isArray = Array.isArray(value)
  for (const [childKey, childValue] of entries) {
    collectPaths(childValue, joinPath(path, childKey, isArray), out, budget)
  }
}

/** Flat list of every leaf whose key or value matches, used while searching. */
function searchRows(value: unknown, path: string, key: string, depth: number, needle: string, out: TreeRow[]): void {
  const kind = kindOf(value)
  const entries = childEntries(value)
  const haystack = `${key} ${kind === 'object' || kind === 'array' ? '' : String(value)}`.toLowerCase()
  if (haystack.includes(needle)) {
    out.push({ path, key, depth: 0, kind, expandable: false, childCount: entries.length, value })
  }
  const isArray = kind === 'array'
  for (const [childKey, childValue] of entries) {
    searchRows(childValue, joinPath(path, childKey, isArray), childKey, depth + 1, needle, out)
  }
}

interface JsonTreeProps {
  value: unknown
  /** Shown above the tree, e.g. the event id. */
  title?: string
  className?: string
}

export function JsonTree({ value, title, className }: JsonTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['$']))
  const [search, setSearch] = useState('')
  const [wrap, setWrap] = useState(false)
  const [raw, setRaw] = useState(false)
  const [copied, setCopied] = useState('')

  const pretty = useMemo(() => {
    try {
      return JSON.stringify(value, null, 2) ?? 'null'
    } catch {
      return 'Unserializable value'
    }
  }, [value])

  const rows = useMemo(() => {
    const out: TreeRow[] = []
    const needle = search.trim().toLowerCase()
    if (needle) searchRows(value, '$', '$', 0, needle, out)
    else flatten(value, '$', '$', 0, expanded, out)
    return out
  }, [value, expanded, search])

  const copy = (text: string, token: string) => {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(token)
        window.setTimeout(() => setCopied(''), 1200)
      },
      () => setCopied(''),
    )
  }

  const toggle = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const expandAll = () => {
    const all = new Set<string>()
    collectPaths(value, '$', all)
    setExpanded(all)
  }

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', className)}>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border-1 bg-surface-1 px-2 py-1.5">
        <div className="relative min-w-[140px] flex-1">
          <Search size={11} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-4" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Find key or value..."
            className="h-6 w-full rounded border border-border-2 bg-surface-0 pl-6 pr-6 font-mono text-[11px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              title="Clear search"
              className="absolute right-1 top-1/2 -translate-y-1/2 text-text-4 hover:text-text-1"
            >
              <X size={11} />
            </button>
          )}
        </div>
        <ToolbarButton onClick={expandAll} disabled={raw} label="Expand all" />
        <ToolbarButton onClick={() => setExpanded(new Set(['$']))} disabled={raw} label="Collapse" />
        <ToolbarToggle active={wrap} onClick={() => setWrap((v) => !v)} title="Word wrap"><WrapText size={12} /></ToolbarToggle>
        <ToolbarToggle active={raw} onClick={() => setRaw((v) => !v)} title="Raw JSON"><Braces size={12} /></ToolbarToggle>
        <button
          onClick={() => copy(pretty, 'all')}
          title="Copy the whole JSON"
          className="flex h-6 items-center gap-1 rounded border border-border-2 px-2 text-[10px] text-text-3 hover:border-accent/40 hover:text-text-1"
        >
          {copied === 'all' ? <Check size={11} className="text-success" /> : <Copy size={11} />}
          Copy JSON
        </button>
      </div>

      {raw ? (
        <pre
          className={cn(
            'min-h-0 flex-1 overflow-auto bg-surface-0 px-3 py-2 font-mono text-[11px] leading-[1.5] text-text-2',
            wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre',
          )}
        >
          {pretty}
        </pre>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto bg-surface-0 py-1">
          {rows.length === 0 ? (
            <p className="px-3 py-6 text-center text-[11px] text-text-4">No matching node</p>
          ) : (
            rows.map((row) => (
              <JsonTreeRow
                key={row.path}
                row={row}
                expanded={expanded.has(row.path)}
                wrap={wrap}
                searching={Boolean(search.trim())}
                copiedToken={copied}
                onToggle={() => toggle(row.path)}
                onCopyValue={() => copy(
                  row.expandable ? JSON.stringify(row.value, null, 2) : String(row.kind === 'string' ? row.value : preview(row.value, row.kind)),
                  `v:${row.path}`,
                )}
                onCopyPath={() => copy(row.path, `p:${row.path}`)}
              />
            ))
          )}
        </div>
      )}
      {title && <div className="shrink-0 border-t border-border-1 px-2 py-1 text-[10px] text-text-4">{title}</div>}
    </div>
  )
}

function ToolbarButton({ onClick, label, disabled }: { onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="h-6 rounded border border-border-2 px-2 text-[10px] text-text-3 hover:border-accent/40 hover:text-text-1 disabled:opacity-40"
    >
      {label}
    </button>
  )
}

function ToolbarToggle({ active, onClick, title, children }: { active: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'grid h-6 w-6 place-items-center rounded border transition-colors',
        active ? 'border-accent/50 bg-accent/20 text-accent-light' : 'border-border-2 text-text-4 hover:text-text-1',
      )}
    >
      {children}
    </button>
  )
}

interface JsonTreeRowProps {
  row: TreeRow
  expanded: boolean
  wrap: boolean
  searching: boolean
  copiedToken: string
  onToggle: () => void
  onCopyValue: () => void
  onCopyPath: () => void
}

function JsonTreeRow({ row, expanded, wrap, searching, copiedToken, onToggle, onCopyValue, onCopyPath }: JsonTreeRowProps) {
  const meta = row.kind === 'array' ? `[${row.childCount}]` : row.kind === 'object' ? `{${row.childCount}}` : ''
  return (
    <div
      className="group flex items-start gap-1.5 py-[2px] pr-2 font-mono text-[11px] hover:bg-surface-1"
      style={{ paddingLeft: (searching ? 0 : row.depth) * 14 + 6 }}
    >
      <button
        onClick={onToggle}
        disabled={!row.expandable}
        aria-label={row.expandable ? (expanded ? 'Collapse' : 'Expand') : undefined}
        className="mt-[2px] grid h-3 w-3 shrink-0 place-items-center text-text-4 disabled:opacity-0"
      >
        <ChevronRight size={10} className={cn('transition-transform', expanded && 'rotate-90')} />
      </button>

      <span className="shrink-0 text-[var(--color-json-key)]" title={searching ? row.path : undefined}>
        {searching ? row.path : row.key}
      </span>
      {meta && <span className="shrink-0 text-text-4">{meta}</span>}

      {!row.expandable && (
        <span
          className={cn('min-w-0 flex-1', wrap ? 'break-all whitespace-pre-wrap' : 'truncate')}
          style={{ color: KIND_COLOR[row.kind] }}
        >
          {preview(row.value, row.kind)}
        </span>
      )}

      <span className="ml-auto flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button onClick={onCopyValue} title="Copy value" className="text-text-4 hover:text-text-1">
          {copiedToken === `v:${row.path}` ? <Check size={11} className="text-success" /> : <Copy size={11} />}
        </button>
        <button onClick={onCopyPath} title={`Copy JSONPath (${row.path})`} className="text-text-4 hover:text-accent-light">
          {copiedToken === `p:${row.path}` ? <Check size={11} className="text-success" /> : <Route size={11} />}
        </button>
      </span>
    </div>
  )
}
