import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Package, SquareFunction, Star } from 'lucide-react'
import type { GoIDEGoroutine, GoIDEGoroutineOverview } from '@/lib/goide-debug-api'
import { groupGoroutines } from './goStudioConcurrency'
import { StateDot, shortLocation, stateMeta } from './GoStudioDebugUi'

interface GoStudioGoroutineTreeProps {
  overview: GoIDEGoroutineOverview | null
  loading: boolean
  selectedId: number | null
  onSelect: (goroutine: GoIDEGoroutine) => void
}

/** Goroutine raggruppate per package e funzione di avvio: la struttura concorrente del programma a colpo d'occhio. */
export function GoStudioGoroutineTree({ overview, loading, selectedId, onSelect }: GoStudioGoroutineTreeProps) {
  const tree = useMemo(() => groupGoroutines(overview?.goroutines ?? []), [overview])
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
  return (
    <div role="tree" aria-label="Goroutines" className="min-h-0 flex-1 overflow-auto px-1.5 pb-2">
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
