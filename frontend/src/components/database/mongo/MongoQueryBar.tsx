import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Filter, History, Play, RotateCcw, Star, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { parseShellDoc } from './bson'
import { describeQuery, type MongoQueryEntry } from './queryHistory'
import { applyCompletion, barCompletions, type BarRoot } from './barComplete'
import type { SqlCompletion } from '../sqlComplete'

export interface MongoQueryState {
  filter: string
  project: string
  sort: string
  skip: string
  limit: string
  /** Optional read options (older saved queries lack them). */
  collation?: string
  hint?: string
  maxTimeMS?: string
}

export const EMPTY_MONGO_QUERY: MongoQueryState = { filter: '', project: '', sort: '', skip: '', limit: '20', collation: '', hint: '', maxTimeMS: '' }

interface MongoQueryBarProps {
  value: MongoQueryState
  running: boolean
  disabled: boolean
  onChange: (next: MongoQueryState) => void
  onFind: () => void
  onReset: () => void
  history?: { favorites: MongoQueryEntry[]; recent: MongoQueryEntry[] }
  onPickHistory?: (entry: MongoQueryEntry) => void
  onToggleFavorite?: (entry: MongoQueryEntry) => void
  onRemoveHistory?: (entry: MongoQueryEntry) => void
  /** Known field paths of the collection, for completion. */
  fields?: string[]
}

const NO_FIELDS: string[] = []

/** A hint is an index name or a key document. */
function hintError(text: string): string {
  const t = text.trim()
  if (!t || !t.startsWith('{')) return ''
  return docError(t, 'Hint')
}

/** Live syntax check, so a typo shows before Find. */
function docError(text: string, label: string): string {
  try { parseShellDoc(text, label); return '' } catch (e) { return e instanceof Error ? e.message : String(e) }
}

interface BarInputProps {
  label: string
  value: string
  placeholder: string
  onChange: (v: string) => void
  onEnter: () => void
  mono?: boolean
  className?: string
  error?: string
  /** Field-name / operator completion (Ctrl+Space forces it). */
  complete?: { root: BarRoot; fields: string[] }
}

function BarInput({ label, value, placeholder, onChange, onEnter, mono = true, className, error = '', complete }: BarInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [suggest, setSuggest] = useState<SqlCompletion | null>(null)
  const [active, setActive] = useState(0)

  const refresh = (text: string, caret: number, explicit = false) => {
    if (!complete) return
    setSuggest(barCompletions(text, caret, complete.root, complete.fields, explicit))
    setActive(0)
  }

  const pick = (itemLabel: string) => {
    const el = inputRef.current
    if (!el || !suggest) return
    const next = applyCompletion(value, el.selectionStart ?? value.length, suggest, itemLabel)
    onChange(next.text)
    setSuggest(null)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(next.caret, next.caret) })
  }

  const items = suggest?.items.slice(0, 12) ?? []

  return (
    <label title={error || undefined} className={cn('relative flex h-8 min-w-0 items-center rounded-md border bg-surface-0', error ? 'border-error/70 focus-within:border-error' : 'border-border-2 focus-within:border-accent/60', className)}>
      <span className={cn('flex h-full flex-none items-center whitespace-nowrap border-r border-border-1 px-2.5 text-[10.5px] font-semibold uppercase tracking-wider', error ? 'text-error' : 'text-text-3')}>{label}</span>
      <input
        ref={inputRef}
        value={value}
        spellCheck={false}
        onChange={(e) => { onChange(e.target.value); refresh(e.target.value, e.target.selectionStart ?? e.target.value.length) }}
        onBlur={() => setSuggest(null)}
        onKeyDown={(e) => {
          if (items.length) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % items.length); return }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + items.length) % items.length); return }
            if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); pick(items[active].label); return }
            if (e.key === 'Escape') { e.preventDefault(); setSuggest(null); return }
          }
          if (e.key === ' ' && e.ctrlKey) { e.preventDefault(); refresh(value, e.currentTarget.selectionStart ?? value.length, true); return }
          if (e.key === 'Enter') onEnter()
        }}
        placeholder={placeholder}
        aria-invalid={!!error}
        aria-autocomplete={complete ? 'list' : undefined}
        aria-expanded={complete ? items.length > 0 : undefined}
        role={complete ? 'combobox' : undefined}
        className={cn('h-full min-w-0 flex-1 bg-transparent px-2.5 text-[11.5px] text-text-1 outline-none placeholder:text-text-4', mono && 'font-mono')}
      />
      {items.length > 0 && (
        <div role="listbox" className="absolute left-0 top-9 z-30 max-h-64 min-w-[220px] overflow-y-auto rounded-md border border-border-2 bg-surface-2 py-1 shadow-2xl">
          {items.map((item, i) => (
            <div
              key={item.label}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(item.label) }}
              onMouseEnter={() => setActive(i)}
              className={cn('flex cursor-pointer items-center gap-2 px-2.5 py-1 font-mono text-[11.5px]', i === active ? 'bg-accent/15 text-text-1' : 'text-text-2')}
            >
              <span className={cn('w-3 flex-none text-center text-[9.5px] font-bold', item.kind === 'column' ? 'text-accent' : 'text-warning')}>{item.kind === 'column' ? 'F' : '$'}</span>
              <span className="truncate">{item.label}</span>
            </div>
          ))}
        </div>
      )}
    </label>
  )
}

export function MongoQueryBar({ value, running, disabled, onChange, onFind, onReset, history, onPickHistory, onToggleFavorite, onRemoveHistory, fields = NO_FIELDS }: MongoQueryBarProps) {
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const errors = { filter: docError(value.filter, 'Filter'), project: docError(value.project, 'Project'), sort: docError(value.sort, 'Sort'), collation: docError(value.collation ?? '', 'Collation'), hint: hintError(value.hint ?? '') }
  const firstError = errors.filter || errors.project || errors.sort || errors.collation || errors.hint
  const find = () => { if (!firstError) onFind() }
  const set = (patch: Partial<MongoQueryState>) => onChange({ ...value, ...patch })
  const hasOptions = !!(value.project.trim() || value.sort.trim() || value.skip.trim() || value.collation?.trim() || value.hint?.trim() || value.maxTimeMS?.trim())

  return (
    <div className="@container flex-none space-y-2 border-b border-border-1 bg-surface-1 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Filter size={13} className="flex-none text-text-4" />
        <BarInput label="Filter" value={value.filter} placeholder="{ field: 'value' }  ·  ObjectId('…'), ISODate('…') supported" onChange={(filter) => set({ filter })} onEnter={find} className="flex-1" error={errors.filter} complete={{ root: 'filter', fields }} />
        {history && (
          <div className="relative flex-none">
            <button type="button" onClick={() => setHistoryOpen((v) => !v)} aria-expanded={historyOpen} title="Recent and favorite queries" aria-label="Query history" className={cn('grid h-8 w-8 place-items-center rounded-md hover:bg-surface-2', historyOpen ? 'text-accent' : 'text-text-3 hover:text-text-1')}>
              <History size={14} />
            </button>
            {historyOpen && (
              <HistoryPopover
                history={history}
                onClose={() => setHistoryOpen(false)}
                onPick={(e) => { setHistoryOpen(false); onPickHistory?.(e) }}
                onToggleFavorite={(e) => onToggleFavorite?.(e)}
                onRemove={(e) => onRemoveHistory?.(e)}
              />
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => setOptionsOpen((v) => !v)}
          aria-expanded={optionsOpen}
          className={cn('flex h-8 flex-none items-center gap-1 whitespace-nowrap rounded-md px-2 text-[11.5px] hover:bg-surface-2', hasOptions ? 'text-accent' : 'text-text-3 hover:text-text-1')}
        >
          {optionsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Options
        </button>
        <button type="button" onClick={onReset} disabled={disabled} title="Reset query" aria-label="Reset query" className="flex h-8 flex-none items-center gap-1.5 rounded-md border border-border-2 px-2.5 text-[11.5px] text-text-2 hover:bg-surface-2 hover:text-text-1 disabled:opacity-40">
          <RotateCcw size={12} /> <span className="hidden @xl:inline">Reset</span>
        </button>
        <button type="button" onClick={find} disabled={disabled || running || !!firstError} title={firstError || 'Run query (Enter)'} className="flex h-8 flex-none items-center gap-1.5 rounded-md bg-accent px-3.5 text-[11.5px] font-semibold text-white hover:bg-accent-hover disabled:opacity-40">
          <Play size={11} fill="currentColor" /> Find
        </button>
      </div>
      {optionsOpen && (
        <div className="ml-[21px] grid grid-cols-2 gap-2 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_112px_112px]">
          <BarInput label="Project" value={value.project} placeholder="{ name: 1, _id: 0 }" onChange={(project) => set({ project })} onEnter={find} error={errors.project} complete={{ root: 'projection', fields }} />
          <BarInput label="Sort" value={value.sort} placeholder="{ _id: -1 }" onChange={(sort) => set({ sort })} onEnter={find} error={errors.sort} complete={{ root: 'sort', fields }} />
          <BarInput label="Skip" value={value.skip} placeholder="0" onChange={(skip) => set({ skip: skip.replace(/\D/g, '') })} onEnter={find} />
          <BarInput label="Limit" value={value.limit} placeholder="20" onChange={(limit) => set({ limit: limit.replace(/\D/g, '') })} onEnter={find} />
          <BarInput label="Collation" value={value.collation ?? ''} placeholder="{ locale: 'it', strength: 2 }" onChange={(collation) => set({ collation })} onEnter={find} error={errors.collation} />
          <BarInput label="Hint" value={value.hint ?? ''} placeholder="{ name: 1 } or index name" onChange={(hint) => set({ hint })} onEnter={find} error={errors.hint} />
          <BarInput label="Max ms" value={value.maxTimeMS ?? ''} placeholder="60000" onChange={(maxTimeMS) => set({ maxTimeMS: maxTimeMS.replace(/\D/g, '') })} onEnter={find} />
        </div>
      )}
    </div>
  )
}

interface HistoryPopoverProps {
  history: { favorites: MongoQueryEntry[]; recent: MongoQueryEntry[] }
  onClose: () => void
  onPick: (entry: MongoQueryEntry) => void
  onToggleFavorite: (entry: MongoQueryEntry) => void
  onRemove: (entry: MongoQueryEntry) => void
}

function HistoryPopover({ history, onClose, onPick, onToggleFavorite, onRemove }: HistoryPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [onClose])
  const empty = history.favorites.length === 0 && history.recent.length === 0
  const section = (title: string, list: MongoQueryEntry[]) => list.length > 0 && (
    <div>
      <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-text-4">{title}</div>
      {list.map((entry) => (
        <div key={entry.id} className="group/h flex items-center gap-1 px-1.5">
          <button type="button" onClick={() => onPick(entry)} className="min-w-0 flex-1 rounded px-1.5 py-1.5 text-left hover:bg-surface-3">
            {entry.name && <div className="truncate text-[11.5px] font-medium text-text-1">{entry.name}</div>}
            <div className="truncate font-mono text-[11px] text-text-2">{describeQuery(entry.query)}</div>
            <div className="text-[10px] text-text-4">{new Date(entry.at).toLocaleString()}</div>
          </button>
          <button type="button" onClick={() => onToggleFavorite(entry)} aria-label={entry.favorite ? 'Remove from favorites' : 'Add to favorites'} title={entry.favorite ? 'Remove from favorites' : 'Add to favorites'} className={cn('grid h-6 w-6 flex-none place-items-center rounded hover:bg-surface-3', entry.favorite ? 'text-warning' : 'text-text-4 opacity-0 focus:opacity-100 group-hover/h:opacity-100')}>
            <Star size={12} fill={entry.favorite ? 'currentColor' : 'none'} />
          </button>
          <button type="button" onClick={() => onRemove(entry)} aria-label="Remove from history" title="Remove" className="grid h-6 w-6 flex-none place-items-center rounded text-text-4 opacity-0 hover:bg-surface-3 hover:text-error focus:opacity-100 group-hover/h:opacity-100">
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
  return (
    <div ref={ref} role="dialog" aria-label="Query history" className="absolute right-0 top-9 z-30 max-h-[420px] w-[min(420px,80vw)] overflow-y-auto rounded-md border border-border-2 bg-surface-2 pb-1.5 shadow-2xl">
      {empty ? (
        <div className="px-3 py-4 text-center text-[11.5px] text-text-3">Queries you run on this collection show up here. Star one to keep it.</div>
      ) : (<>
        {section('Favorites', history.favorites)}
        {section('Recent', history.recent)}
      </>)}
    </div>
  )
}
