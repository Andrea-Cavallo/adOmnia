import type { ReactNode } from 'react'
import { Clock, Database, Plus, RefreshCw, Search, Star, Table2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { relativeTime, type HistoryItem, type SchemaItem } from './dbShared'

interface RightRailProps {
  isMongo: boolean
  favorites: string[]
  history: HistoryItem[]
  schemaItems: SchemaItem[]
  schemaDb: string
  schemaLoading: boolean
  schemaError: string
  schemaSearch: string
  currentQuery: string
  onAddFavorite: () => void
  onPickQuery: (q: string) => void
  onClearHistory: () => void
  onRefreshSchema: () => void
  onSchemaSearch: (s: string) => void
  onPickCollection: (name: string) => void
  onCreateObject: () => void
}

function SectionHeader({ icon, title, action }: { icon: ReactNode; title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3.5 py-2.5">
      <div className="flex items-center gap-2 text-[12px] font-semibold text-text-1">
        <span className="text-text-3">{icon}</span> {title}
      </div>
      {action}
    </div>
  )
}

function queryLabel(q: string): string {
  const trimmed = q.trim().replace(/\s+/g, ' ')
  return trimmed.length > 46 ? trimmed.slice(0, 46) + '…' : trimmed || 'Empty query'
}

export function RightRail(props: RightRailProps) {
  const {
    isMongo, favorites, history,
    schemaItems, schemaDb, schemaLoading, schemaError, schemaSearch, currentQuery,
    onAddFavorite, onPickQuery,
    onClearHistory, onRefreshSchema, onSchemaSearch, onPickCollection, onCreateObject,
  } = props

  const isFav = favorites.includes(currentQuery)
  const filteredSchema = schemaItems.filter((s) => !schemaSearch.trim() || s.name.toLowerCase().includes(schemaSearch.toLowerCase()))

  return (
    <aside className="flex w-[280px] flex-none flex-col overflow-y-auto border-l border-border-1 bg-surface-1">
      {/* ── Favorites ─────────────────────────────────────────────────── */}
      <SectionHeader
        icon={<Star size={14} />}
        title="Favorites"
        action={
          <button onClick={onAddFavorite} className={cn('grid h-6 w-6 place-items-center rounded-md hover:bg-surface-2', isFav ? 'text-accent' : 'text-text-3 hover:text-text-1')}>
            <Plus size={14} />
          </button>
        }
      />
      <div className="px-3.5 pb-3.5">
        {favorites.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border-2 px-3 py-4 text-center">
            <div className="text-[11.5px] text-text-3">No favorites yet</div>
            <div className="mt-0.5 text-[10.5px] text-text-4">Star queries to access them quickly.</div>
          </div>
        ) : (
          <div className="space-y-1">
            {favorites.slice(0, 8).map((q) => (
              <button
                key={q}
                onClick={() => onPickQuery(q)}
                className="flex w-full items-center gap-2 rounded-md border border-border-1 bg-surface-2 px-2.5 py-1.5 text-left transition-colors hover:border-accent/40"
              >
                <Star size={11} className="flex-none text-accent" fill="currentColor" />
                <span className="truncate font-mono text-[10.5px] text-text-2">{queryLabel(q)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="h-px bg-border-1" />

      {/* ── History ───────────────────────────────────────────────────── */}
      <SectionHeader
        icon={<Clock size={14} />}
        title="History"
        action={history.length > 0 ? (
          <button onClick={onClearHistory} className="text-[11px] text-accent hover:text-accent-light">Clear</button>
        ) : undefined}
      />
      <div className="px-3.5 pb-3.5">
        {history.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border-2 px-3 py-4 text-center text-[11.5px] text-text-3">Query history is empty.</div>
        ) : (
          <div className="space-y-0.5">
            {history.slice(0, 6).map((item, i) => (
              <button
                key={i}
                onClick={() => onPickQuery(item.query)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
              >
                <Clock size={11} className="flex-none text-text-4" />
                <span className="min-w-0 flex-1 truncate text-[11px] text-text-2">{item.label || queryLabel(item.query)}</span>
                <span className="flex-none text-[10px] text-text-4">{relativeTime(item.ts)}</span>
              </button>
            ))}
            {history.length > 6 && (
              <div className="px-2 pt-1 text-[11px] text-accent">View all history</div>
            )}
          </div>
        )}
      </div>

      <div className="h-px bg-border-1" />

      {/* ── Schema Explorer ───────────────────────────────────────────── */}
      <SectionHeader
        icon={<Database size={14} />}
        title="Schema Explorer"
        action={
          <button onClick={onRefreshSchema} className="grid h-6 w-6 place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text-1" title="Refresh">
            <RefreshCw size={12} className={schemaLoading ? 'animate-spin' : ''} />
          </button>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col px-3.5 pb-4">
        <div className="mb-2 flex h-7 items-center gap-2 rounded-md border border-border-2 bg-surface-2 px-2.5 text-[11.5px] text-text-2">
          <Database size={12} className="text-text-4" />
          <span className="truncate">{schemaDb || 'No database'}</span>
        </div>
        <div className="relative mb-2">
          <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-4" />
          <input
            value={schemaSearch}
            onChange={(e) => onSchemaSearch(e.target.value)}
            placeholder={isMongo ? 'Search collections' : 'Search tables'}
            className="h-7 w-full rounded-md border border-border-2 bg-surface-2 pl-7 pr-2 text-[11px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent/50"
          />
        </div>

        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {filteredSchema.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border-2 px-3 py-4 text-center text-[11px] text-text-3">
              {schemaLoading ? 'Loading...' : schemaError || 'Refresh to load schema.'}
            </div>
          ) : (
            filteredSchema.map((item) => (
              <button
                key={item.name}
                onClick={() => onPickCollection(item.name)}
                className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/10"
              >
                <Table2 size={13} className="flex-none text-text-4 group-hover:text-accent" />
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-text-2 group-hover:text-text-1">{item.name}</span>
                {item.count != null && (
                  <span className="flex-none rounded bg-surface-3 px-1.5 py-px text-[10px] tabular-nums text-text-3">{item.count}</span>
                )}
              </button>
            ))
          )}
        </div>

        <button onClick={onCreateObject} className="mt-2 flex items-center gap-1.5 text-[11.5px] font-medium text-accent hover:text-accent-light">
          <Plus size={13} /> {isMongo ? 'New Collection' : 'New Table'}
        </button>
      </div>
    </aside>
  )
}
