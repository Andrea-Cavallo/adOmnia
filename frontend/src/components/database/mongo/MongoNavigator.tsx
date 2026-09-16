import { useState } from 'react'
import { ChevronDown, ChevronRight, Database, FolderPlus, Loader2, RefreshCw, Search, Table2, Trash2 } from 'lucide-react'
import { confirm } from '@/lib/confirmDialog'
import { cn } from '@/lib/utils'
import { isValidDbObjectName } from '../dbShared'

export interface MongoDbNode {
  name: string
  collections: { name: string; count: number | null }[] | null
  loading: boolean
  error: string
}

interface MongoNavigatorProps {
  databases: MongoDbNode[]
  expanded: string[]
  loading: boolean
  error: string
  selected: { db: string; collection: string } | null
  onRefresh: () => void
  onToggle: (db: string) => void
  onSelect: (db: string, collection: string) => void
  onCreateCollection: (db: string, name: string) => Promise<void>
  onDropCollection: (db: string, name: string) => Promise<void>
}

export function MongoNavigator(props: MongoNavigatorProps) {
  const { databases, expanded, loading, error, selected, onRefresh, onToggle, onSelect, onCreateCollection, onDropCollection } = props
  const [search, setSearch] = useState('')
  const [creatingIn, setCreatingIn] = useState('')
  const [newName, setNewName] = useState('')
  const [createError, setCreateError] = useState('')

  const q = search.trim().toLowerCase()
  const matches = (name: string) => !q || name.toLowerCase().includes(q)

  const [dropError, setDropError] = useState('')

  const drop = async (db: string, name: string) => {
    const ok = await confirm({
      title: 'Drop collection',
      message: `Permanently delete ${db}.${name} with all its documents and indexes?`,
      confirmLabel: 'Drop collection',
      variant: 'danger',
    })
    if (!ok) return
    setDropError('')
    try { await onDropCollection(db, name) } catch (e) { setDropError(e instanceof Error ? e.message : String(e)) }
  }

  const submitCreate = async () => {
    if (!isValidDbObjectName(newName)) { setCreateError('Letters, numbers and _ only'); return }
    try {
      await onCreateCollection(creatingIn, newName.trim())
      setCreatingIn('')
      setNewName('')
      setCreateError('')
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <aside aria-label="MongoDB databases" className="flex w-[240px] flex-none flex-col border-r border-border-1 bg-surface-1">
      <div className="flex h-9 flex-none items-center justify-between border-b border-border-1 px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-3">Databases</span>
        <button type="button" onClick={onRefresh} title="Refresh databases" aria-label="Refresh databases" className="grid h-6 w-6 place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text-1">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      <div className="relative flex-none px-2.5 py-2">
        <Search size={12} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-text-4" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search databases & collections"
          className="h-7 w-full rounded-md border border-border-2 bg-surface-2 pl-7 pr-2 text-[11px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent/50"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        {dropError && <div className="mx-1 mb-1 rounded-md border border-error/30 bg-error/10 px-2.5 py-2 text-[11px] text-error">{dropError}</div>}
        {error && <div className="mx-1 rounded-md border border-error/30 bg-error/10 px-2.5 py-2 text-[11px] text-error">{error}</div>}
        {!error && databases.length === 0 && (
          <div className="mx-1 rounded-md border border-dashed border-border-2 px-3 py-4 text-center text-[11px] text-text-3">
            {loading ? 'Loading databases…' : 'Test the connection to browse databases.'}
          </div>
        )}
        {databases.map((db) => {
          const collections = db.collections ?? []
          const visibleCollections = collections.filter((c) => matches(c.name) || matches(db.name))
          if (q && !matches(db.name) && visibleCollections.length === 0 && db.collections) return null
          const open = expanded.includes(db.name) || (!!q && visibleCollections.length > 0)
          return (
            <div key={db.name}>
              <div className="group flex h-7 items-center rounded-md hover:bg-surface-2">
                <button type="button" onClick={() => onToggle(db.name)} aria-expanded={open} className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-1.5 text-left">
                  {open ? <ChevronDown size={12} className="flex-none text-text-4" /> : <ChevronRight size={12} className="flex-none text-text-4" />}
                  <Database size={12} className="flex-none text-text-3" />
                  <span className="truncate text-[11.5px] font-medium text-text-1">{db.name}</span>
                  {db.loading && <Loader2 size={11} className="flex-none animate-spin text-text-4" />}
                </button>
                <button
                  type="button"
                  title={`Create collection in ${db.name}`}
                  aria-label={`Create collection in ${db.name}`}
                  onClick={() => { setCreatingIn(db.name); setNewName(''); setCreateError(''); if (!expanded.includes(db.name)) onToggle(db.name) }}
                  className="mr-1 grid h-5 w-5 flex-none place-items-center rounded text-text-4 opacity-0 hover:bg-surface-3 hover:text-text-1 focus:opacity-100 group-hover:opacity-100"
                >
                  <FolderPlus size={11} />
                </button>
              </div>
              {open && (
                <div className="ml-[18px] border-l border-border-1 pl-1">
                  {db.error && <div className="px-2 py-1 text-[10.5px] text-error">{db.error}</div>}
                  {creatingIn === db.name && (
                    <div className="px-1 py-1">
                      <input
                        autoFocus
                        value={newName}
                        onChange={(e) => { setNewName(e.target.value); setCreateError('') }}
                        onKeyDown={(e) => { if (e.key === 'Enter') void submitCreate(); if (e.key === 'Escape') setCreatingIn('') }}
                        onBlur={() => { if (!newName.trim()) setCreatingIn('') }}
                        placeholder="new_collection"
                        aria-label="New collection name"
                        className="h-6 w-full rounded border border-accent/50 bg-surface-0 px-2 font-mono text-[11px] text-text-1 outline-none"
                      />
                      {createError && <div className="pt-1 text-[10.5px] text-error">{createError}</div>}
                    </div>
                  )}
                  {db.collections && collections.length === 0 && !db.loading && (
                    <div className="px-2 py-1 text-[10.5px] text-text-4">No collections</div>
                  )}
                  {visibleCollections.map((c) => {
                    const isSelected = selected?.db === db.name && selected.collection === c.name
                    return (
                      <div
                        key={c.name}
                        className={cn(
                          'group/coll flex h-7 w-full items-center rounded-md transition-colors',
                          isSelected ? 'bg-accent/15 text-text-1' : 'text-text-2 hover:bg-surface-2 hover:text-text-1',
                        )}
                      >
                        <button type="button" aria-current={isSelected} onClick={() => onSelect(db.name, c.name)} className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2 text-left">
                          <Table2 size={12} className={cn('flex-none', isSelected ? 'text-accent' : 'text-text-4 group-hover/coll:text-accent')} />
                          <span className="min-w-0 flex-1 truncate text-[11.5px]">{c.name}</span>
                          {c.count != null && <span className="flex-none text-[10px] tabular-nums text-text-4 group-hover/coll:hidden">{c.count.toLocaleString()}</span>}
                        </button>
                        <button
                          type="button"
                          title={`Drop ${c.name}`}
                          aria-label={`Drop collection ${c.name}`}
                          onClick={() => void drop(db.name, c.name)}
                          className="mr-1 hidden h-5 w-5 flex-none place-items-center rounded text-text-4 hover:bg-surface-3 hover:text-error focus:grid group-hover/coll:grid"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </aside>
  )
}
