import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlignLeft, ChevronDown, FilePlus2, Play, Save, Terminal, X, Zap, CheckCircle2, AlertCircle, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  caretPosition, highlightedJson, highlightedSql, jsonValidity,
  type QueryTab,
} from './dbShared'
import { sqlCompletions, type SqlCompletion, type SqlCompletionItem, type SqlSchema } from './sqlComplete'

interface QueryEditorProps {
  tabs: QueryTab[]
  activeTabId: string
  query: string
  isMongo: boolean
  dangerous: boolean
  varsCount: number
  limit: number
  timeoutMs: number
  running: boolean
  focusToken: number
  /** table → columns, drives SQL completion (empty until the schema is loaded). */
  schema: SqlSchema
  onSelectTab: (id: string) => void
  onAddTab: () => void
  onCloseTab: (id: string) => void
  onChangeQuery: (q: string) => void
  onSetLimit: (n: number) => void
  onSetTimeout: (ms: number) => void
  onRun: (explain: boolean) => void
  onFormat: () => void
  onSave: () => void
}

const LINE_HEIGHT = 21
const PAD = 12
const KIND_STYLE: Record<SqlCompletionItem['kind'], string> = {
  table: 'text-accent',
  column: 'text-success',
  keyword: 'text-text-3',
}

function charWidth(el: HTMLElement): number {
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return 7.5
  ctx.font = getComputedStyle(el).font
  return ctx.measureText('0000000000').width / 10 || 7.5
}

const LIMIT_OPTIONS = [100, 200, 500, 1000, 5000]
const TIMEOUT_OPTIONS = [10000, 30000, 60000, 120000]

function ToolButton({ icon, label, onClick, disabled, active }: { icon: ReactNode; label: string; onClick?: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11.5px] font-medium transition-colors disabled:opacity-40',
        active ? 'bg-accent/15 text-accent' : 'text-text-2 hover:bg-surface-2 hover:text-text-1'
      )}
    >
      {icon} {label}
    </button>
  )
}

export function QueryEditor(props: QueryEditorProps) {
  const {
    tabs, activeTabId, query, isMongo, dangerous, varsCount, limit, timeoutMs, running, focusToken, schema,
    onSelectTab, onAddTab, onCloseTab, onChangeQuery, onSetLimit, onSetTimeout, onRun, onFormat, onSave,
  } = props

  const taRef = useRef<HTMLTextAreaElement>(null)
  const [caret, setCaret] = useState({ line: 1, col: 1 })
  const [runMenu, setRunMenu] = useState(false)
  const [completion, setCompletion] = useState<(SqlCompletion & { caret: number }) | null>(null)
  const [selected, setSelected] = useState(0)
  const lineCount = Math.max(query.split('\n').length, 1)
  const validity = isMongo ? jsonValidity(query) : null

  useEffect(() => {
    taRef.current?.focus()
  }, [focusToken])

  const updateCaret = () => {
    const el = taRef.current
    if (el) setCaret(caretPosition(query, el.selectionStart))
  }

  const suggest = (value: string, caretAt: number, explicit = false) => {
    const next = isMongo ? null : sqlCompletions(value, caretAt, schema, explicit)
    setCompletion(next && { ...next, caret: caretAt })
    setSelected(0)
  }

  const accept = (item: SqlCompletionItem) => {
    const el = taRef.current
    if (!completion || !el) return
    const next = query.slice(0, completion.start) + item.label + query.slice(completion.caret)
    const pos = completion.start + item.label.length
    onChangeQuery(next)
    setCompletion(null)
    requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = pos; el.focus(); updateCaret() })
  }

  const popupStyle = (() => {
    const el = taRef.current
    if (!completion || !el) return undefined
    const at = caretPosition(query, completion.start)
    const top = PAD + at.line * LINE_HEIGHT - el.scrollTop
    const left = Math.max(4, PAD + (at.col - 1) * charWidth(el) - el.scrollLeft)
    const flip = top + 200 > el.clientHeight && top > 220
    return flip ? { left, bottom: el.clientHeight - top + LINE_HEIGHT + 2 } : { left, top: top + 2 }
  })()

  return (
    <div className="flex min-h-0 flex-col border-b border-border-1 bg-surface-1">
      {/* ── tab bar + primary actions ─────────────────────────────────── */}
      <div className="flex h-11 flex-none items-center gap-1 border-b border-border-1 px-2">
        <div role="tablist" aria-label="Query tabs" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId
            return (
              <div
                key={tab.id}
                className={cn(
                  'group flex h-8 items-center gap-2 rounded-md border px-3 text-[12px] transition-colors focus-within:ring-2 focus-within:ring-accent',
                  isActive
                    ? 'border-accent/60 bg-accent/10 text-text-1 shadow-[inset_0_-2px_0_var(--color-accent)]'
                    : 'border-transparent text-text-3 hover:bg-surface-2 hover:text-text-2'
                )}
              >
                <button type="button" role="tab" aria-selected={isActive} onClick={() => onSelectTab(tab.id)} className="flex min-w-0 items-center gap-2 outline-none">
                  <Terminal size={12} className={isActive ? 'text-accent' : 'text-text-4'} />
                  <span className="max-w-[140px] truncate">{tab.name}</span>
                  {isActive && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                </button>
                {tabs.length > 1 && (
                  <button
                    aria-label={`Close ${tab.name}`}
                    onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id) }}
                    className="grid h-4 w-4 place-items-center rounded text-text-4 opacity-0 hover:bg-surface-4 hover:text-text-1 group-hover:opacity-100 group-focus-within:opacity-100"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            )
          })}
          <button aria-label="Add query tab" title="Add query tab" onClick={onAddTab} className="grid h-7 w-7 flex-none place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text-1">
            <Plus size={14} />
          </button>
        </div>

        <div className="flex flex-none items-center gap-1">
          <ToolButton icon={<FilePlus2 size={13} />} label="New Query" onClick={onAddTab} />
          <ToolButton icon={<Save size={13} />} label="Save" onClick={onSave} />
          <ToolButton icon={<AlignLeft size={13} />} label="Format" onClick={onFormat} />
          <div className="relative flex">
            <button
              onClick={() => onRun(false)}
              disabled={running}
              className="flex h-7 items-center gap-1.5 rounded-l-md bg-accent pl-3 pr-2.5 text-[11.5px] font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              <Play size={12} fill="currentColor" /> Run
            </button>
            <button
              onClick={() => setRunMenu((v) => !v)}
              disabled={running}
              className="grid h-7 w-6 place-items-center rounded-r-md border-l border-white/20 bg-accent text-white hover:bg-accent-hover disabled:opacity-50"
            >
              <ChevronDown size={13} />
            </button>
            {runMenu && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setRunMenu(false)} />
                <div className="absolute right-0 top-full z-30 mt-1 w-40 overflow-hidden rounded-md border border-border-2 bg-surface-3 py-1 shadow-xl">
                  <button onClick={() => { onRun(false); setRunMenu(false) }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11.5px] text-text-2 hover:bg-surface-4 hover:text-text-1">
                    <Play size={12} /> Run query
                  </button>
                  <button onClick={() => { onRun(true); setRunMenu(false) }} disabled={isMongo} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11.5px] text-text-2 hover:bg-surface-4 hover:text-text-1 disabled:opacity-40">
                    <Zap size={12} /> Explain plan
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── secondary toolbar ─────────────────────────────────────────── */}
      <div className="flex h-9 flex-none items-center gap-1 border-b border-border-1 px-2">
        <ToolButton icon={<Play size={12} fill="currentColor" />} label="Run" onClick={() => onRun(false)} disabled={running} active />
        <ToolButton icon={<Zap size={12} />} label="Explain" onClick={() => onRun(true)} disabled={running || isMongo} />
        <ToolButton icon={<AlignLeft size={12} />} label="Format" onClick={onFormat} />
        <div className="ml-1 flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] text-text-3">
          Variables <span className="rounded bg-accent/15 px-1.5 py-px font-semibold text-accent">{varsCount}</span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-text-3">
            Auto Limit
            <select
              value={limit}
              onChange={(e) => onSetLimit(Number(e.target.value))}
              className="h-7 rounded-md border border-border-2 bg-surface-2 pl-2 pr-1 text-[11px] text-text-1 outline-none focus:border-accent/50"
            >
              {LIMIT_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-text-3">
            Timeout
            <select
              value={timeoutMs}
              onChange={(e) => onSetTimeout(Number(e.target.value))}
              className="h-7 rounded-md border border-border-2 bg-surface-2 pl-2 pr-1 text-[11px] text-text-1 outline-none focus:border-accent/50"
            >
              {TIMEOUT_OPTIONS.map((ms) => <option key={ms} value={ms}>{ms / 1000}s</option>)}
            </select>
          </label>
        </div>
      </div>

      {/* ── editor ────────────────────────────────────────────────────── */}
      <div className="flex min-h-[200px] flex-1 overflow-hidden bg-surface-0">
        <div
          className="flex-none select-none border-r border-border-1 bg-surface-1 pt-3 text-right"
          style={{ width: 46, fontFamily: 'var(--font-mono, ui-monospace)', fontSize: 12.5, lineHeight: '21px' }}
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i} className="pr-3 text-text-4">{i + 1}</div>
          ))}
        </div>
        <div className="relative flex-1 overflow-auto">
          <pre
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-visible whitespace-pre px-3 py-3 font-mono text-[12.5px]"
            style={{ tabSize: 2, lineHeight: '21px' }}
          >
            {isMongo ? highlightedJson(query) : highlightedSql(query)}
            {'\n'}
          </pre>
          <textarea
            ref={taRef}
            value={query}
            onChange={(e) => { onChangeQuery(e.target.value); updateCaret(); suggest(e.target.value, e.target.selectionStart) }}
            onKeyUp={updateCaret}
            onClick={() => { updateCaret(); setCompletion(null) }}
            onBlur={() => setCompletion(null)}
            onScroll={() => setCompletion((c) => c && { ...c })}
            spellCheck={false}
            aria-label="Database query editor"
            placeholder={isMongo ? 'Enter a MongoDB JSON operation...' : 'Enter a SQL query...'}
            className="absolute inset-0 h-full w-full resize-none bg-transparent px-3 py-3 font-mono text-[12.5px] text-transparent caret-accent outline-none placeholder:text-text-4"
            style={{ tabSize: 2, lineHeight: '21px' }}
            aria-autocomplete="list"
            aria-expanded={!!completion}
            onKeyDown={(e) => {
              if (completion) {
                const n = completion.items.length
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  setSelected((i) => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
                  return
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  if (!e.ctrlKey && !e.metaKey) {
                    e.preventDefault()
                    accept(completion.items[Math.min(selected, n - 1)])
                    return
                  }
                }
                if (e.key === 'Escape') { e.preventDefault(); setCompletion(null); return }
              }
              if (e.key === ' ' && e.ctrlKey) {
                e.preventDefault()
                suggest(query, e.currentTarget.selectionStart, true)
                return
              }
              if (e.key === 'Tab') {
                e.preventDefault()
                const t = e.currentTarget
                const start = t.selectionStart
                const end = t.selectionEnd
                onChangeQuery(query.slice(0, start) + '  ' + query.slice(end))
                requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = start + 2 })
              }
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                onRun(false)
              }
            }}
          />
          {completion && popupStyle && (
            <div
              role="listbox"
              aria-label="SQL suggestions"
              className="absolute z-20 max-h-[200px] w-64 overflow-y-auto rounded-md border border-border-2 bg-surface-3 py-1 shadow-xl"
              style={popupStyle}
            >
              {completion.items.map((item, i) => (
                <div
                  key={`${item.kind}:${item.label}:${item.detail ?? ''}`}
                  role="option"
                  aria-selected={i === selected}
                  ref={i === selected ? (node) => node?.scrollIntoView({ block: 'nearest' }) : undefined}
                  onMouseDown={(e) => { e.preventDefault(); accept(item) }}
                  onMouseEnter={() => setSelected(i)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 px-2.5 py-1 font-mono text-[11.5px]',
                    i === selected ? 'bg-accent/15 text-text-1' : 'text-text-2'
                  )}
                >
                  <span className={cn('w-3 flex-none text-center text-[10px] font-bold uppercase', KIND_STYLE[item.kind])}>{item.kind[0]}</span>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.detail && <span className="flex-none truncate text-[10px] text-text-4">{item.detail}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── status bar ────────────────────────────────────────────────── */}
      <div className="flex h-7 flex-none items-center gap-2 border-t border-border-1 px-3 text-[11px]">
        {validity ? (
          validity.ok ? (
            <span className="flex items-center gap-1.5 text-success"><CheckCircle2 size={12} /> JSON is valid</span>
          ) : (
            <span className="flex items-center gap-1.5 text-error"><AlertCircle size={12} /> {validity.message}</span>
          )
        ) : dangerous ? (
          <span className="flex items-center gap-1.5 text-error"><AlertCircle size={12} /> Destructive statement</span>
        ) : (
          <span className="flex items-center gap-1.5 text-text-4"><CheckCircle2 size={12} /> Ready</span>
        )}
        <span className="ml-auto text-text-4">Ln {caret.line}, Col {caret.col}</span>
        <span className="rounded border border-border-2 bg-surface-2 px-1.5 py-px text-[10px] font-medium text-text-3">{isMongo ? 'JSON' : 'SQL'}</span>
      </div>
    </div>
  )
}
