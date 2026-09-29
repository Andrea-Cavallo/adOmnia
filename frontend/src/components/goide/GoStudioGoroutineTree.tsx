import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Layers, Package, Search, SquareFunction, Star } from 'lucide-react'
import type { GoIDEGoroutine, GoIDEGoroutineOverview } from '@/lib/goide-debug-api'
import { groupByStack, groupGoroutines, isBlocked } from './goStudioConcurrency'
import { StateDot, shortLocation, stateMeta } from './GoStudioDebugUi'

interface GoStudioGoroutineTreeProps {
  overview: GoIDEGoroutineOverview | null
  loading: boolean
  selectedId: number | null
  onSelect: (goroutine: GoIDEGoroutine) => void
}

/** Goroutine raggruppate per package e funzione di avvio: la struttura concorrente del programma a colpo d'occhio. */
type GroupMode = 'origin' | 'stack'
type StateFilter = 'all' | 'blocked' | 'running'

const FILTERS: ReadonlyArray<{ id: StateFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'running', label: 'Running' },
]

function matches(goroutine: GoIDEGoroutine, filter: StateFilter, query: string): boolean {
  if (filter === 'blocked' && !isBlocked(goroutine.state)) return false
  if (filter === 'running' && goroutine.state !== 'running') return false
  if (!query) return true
  const text = `#${goroutine.id} ${goroutine.state} ${goroutine.blockedOn ?? ''} ${goroutine.location?.name ?? ''} ${goroutine.origin?.name ?? ''}`.toLowerCase()
  return text.includes(query.toLowerCase())
}

export function GoStudioGoroutineTree({ overview, loading, selectedId, onSelect }: GoStudioGoroutineTreeProps) {
  const [mode, setMode] = useState<GroupMode>('origin')
  const [filter, setFilter] = useState<StateFilter>('all')
  const [query, setQuery] = useState('')
  const visible = useMemo(() => (overview?.goroutines ?? []).filter((goroutine) => matches(goroutine, filter, query.trim())), [filter, overview, query])
  const tree = useMemo(() => groupGoroutines(visible), [visible])
  const stacks = useMemo(() => (mode === 'stack' ? groupByStack(visible) : []), [mode, visible])
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(['runtime']))
  const toggle = (key: string) => setCollapsed((current) => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  if (!overview) {
    return <p className="px-3 py-2 text-[11.5px] text-text-4">{loading ? 'Reading goroutines…' : 'Pause the program or hit a breakpoint to see its goroutines.'}</p>
  }
  const toolbar = (
    <div className="flex shrink-0 flex-col gap-1.5 px-2 pb-1.5">
      <label className="flex h-7 items-center gap-1.5 rounded-lg bg-surface-0 px-2 text-text-4 focus-within:ring-1 focus-within:ring-accent">
        <Search size={12} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter: id, function, channel…" aria-label="Filter goroutines" className="min-w-0 flex-1 bg-transparent text-[11.5px] text-text-1 outline-none" />
      </label>
      <div className="flex items-center gap-1">
        {FILTERS.map((item) => (
          <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)} className={`h-6 rounded-md px-2 text-[11px] ${filter === item.id ? 'bg-[var(--gs-raised)] font-semibold text-text-1' : 'text-text-3 hover:text-text-1'}`}>{item.label}</button>
        ))}
        <button type="button" onClick={() => setMode(mode === 'origin' ? 'stack' : 'origin')} aria-pressed={mode === 'stack'} title={mode === 'stack' ? 'Grouped by identical stack: click to group by starting function' : 'Group goroutines with an identical stack'} className={`ml-auto flex h-6 items-center gap-1 rounded-md px-2 text-[11px] ${mode === 'stack' ? 'bg-accent/15 text-accent' : 'text-text-3 hover:text-text-1'}`}><Layers size={11} />{mode === 'stack' ? 'By stack' : 'By origin'}</button>
      </div>
    </div>
  )

  if (mode === 'stack') {
    return (
      <>
        {toolbar}
        <div role="tree" aria-label="Goroutines by stack" className="min-h-0 flex-1 overflow-auto px-1.5 pb-2">
          {stacks.map((group) => {
            const open = !collapsed.has(group.key)
            return (
              <div key={group.key}>
                <button type="button" role="treeitem" aria-expanded={open} onClick={() => toggle(group.key)} title={group.key.split('|').join('\n')} className="flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left hover:bg-surface-2">
                  {open ? <ChevronDown size={12} className="text-text-4" /> : <ChevronRight size={12} className="text-text-4" />}
                  <StateDot state={group.state} />
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-text-1">{group.top}</span>
                  <span className="shrink-0 font-mono text-[11px] text-text-4">{shortLocation(group.location?.relativePath, group.location?.line)}</span>
                  <span className="rounded-full bg-surface-3 px-1.5 text-[10.5px] text-text-2">×{group.goroutines.length}</span>
                </button>
                {open && group.goroutines.map((goroutine) => <GoroutineRow key={goroutine.id} goroutine={goroutine} selected={goroutine.id === selectedId} onSelect={() => onSelect(goroutine)} />)}
              </div>
            )
          })}
          {stacks.length === 0 && <p className="px-2 py-1 text-[11.5px] text-text-4">No goroutine matches the filter.</p>}
        </div>
      </>
    )
  }

  return (
    <>
    {toolbar}
    <div role="tree" aria-label="Goroutines" className="min-h-0 flex-1 overflow-auto px-1.5 pb-2">
      {tree.length === 0 && <p className="px-2 py-1 text-[11.5px] text-text-4">No goroutine matches the filter.</p>}
      {tree.map((entry) => {
        const pkgOpen = !collapsed.has(entry.pkg)
        return (
          <div key={entry.pkg}>
            <button type="button" role="treeitem" aria-expanded={pkgOpen} onClick={() => toggle(entry.pkg)} className="flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[12px] text-text-2 hover:bg-surface-2">
              {pkgOpen ? <ChevronDown size={13} className="text-text-4" /> : <ChevronRight size={13} className="text-text-4" />}
              <Package size={13} className="text-text-3" />
              <span className="min-w-0 flex-1 truncate font-medium">{entry.pkg}</span>
              <span className="text-[11px] text-text-4">{entry.total}</span>
            </button>
            {pkgOpen && entry.groups.map((group) => {
              const groupOpen = !collapsed.has(group.key)
              return (
                <div key={group.key} className="ml-3 border-l border-border-1 pl-1.5">
                  <button type="button" role="treeitem" aria-expanded={groupOpen} onClick={() => toggle(group.key)} title={`Goroutines started in ${group.key}`} className="flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left hover:bg-surface-2">
                    {groupOpen ? <ChevronDown size={12} className="text-text-4" /> : <ChevronRight size={12} className="text-text-4" />}
                    <SquareFunction size={13} className="text-info" />
                    <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-text-1">{group.name}()</span>
                    {group.blocked > 0 && <span className="rounded-full bg-warning/15 px-1.5 text-[10.5px] text-warning" title={`${group.blocked} blocked`}>{group.blocked}</span>}
                    <span className="text-[11px] text-text-4">{group.goroutines.length}</span>
                  </button>
                  {groupOpen && group.goroutines.map((goroutine) => (
                    <GoroutineRow key={goroutine.id} goroutine={goroutine} selected={goroutine.id === selectedId} onSelect={() => onSelect(goroutine)} />
                  ))}
                </div>
              )
            })}
          </div>
        )
      })}
      {overview.truncated && <p className="px-2 py-1 text-[11px] text-warning">Showing the first 1000 goroutines.</p>}
    </div>
    </>
  )
}

function GoroutineRow({ goroutine, selected, onSelect }: { goroutine: GoIDEGoroutine; selected: boolean; onSelect: () => void }) {
  const meta = stateMeta(goroutine.state)
  return (
    <button type="button" role="treeitem" aria-selected={selected} onClick={onSelect}
      title={`${goroutine.name}\n${meta.label}${goroutine.blockedOn ? ` on ${goroutine.blockedOn}` : ''}`}
      className={`ml-4 flex h-7 w-[calc(100%-1rem)] items-center gap-2 rounded-md px-2 text-left text-[12px] ${selected ? 'go-studio-tree-row-selected' : 'text-text-2 hover:bg-surface-2'}`}>
      <StateDot state={goroutine.state} />
      <span className="shrink-0 font-mono text-text-1">#{goroutine.id}</span>
      {goroutine.current && <Star size={11} className="shrink-0 fill-accent text-accent" aria-label="Current goroutine" />}
      <span className={`shrink-0 text-[11px] ${meta.tone}`}>{meta.label}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-3">{goroutine.blockedOn || shortLocation(goroutine.location?.relativePath, goroutine.location?.line)}</span>
    </button>
  )
}
