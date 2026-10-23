import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, FilePlus2, History, Pencil, Play, Search, Star, Trash2, Upload, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { parseSnippet, renderSnippetText } from './snippet'
import {
  TEMPLATE_CATEGORIES, specializeTemplate, templatesFor,
  type ConsoleCategory, type ConsoleTemplate, type TemplateRisk,
} from './consoleTemplates'
import { filterSavedQueries, type SavedQuery } from './savedQueries'
import { withContentKeys } from '@/lib/contentKeys'

type View = ConsoleCategory | 'saved'

interface QueryConsoleProps {
  driver: string
  /** Tables / collections the schema knows; the chosen one precompiles the templates. */
  targets: string[]
  target: string
  onTarget: (name: string) => void
  /** Columns / sampled fields of the chosen target. */
  columns: string[]
  /** Mongo database name for the `db` stop. */
  database: string
  recent: string[]
  /** Saved queries valid for the active connection (already filtered by family and connection). */
  saved: SavedQuery[]
  currentQuery: string
  onSaveCurrent: (name: string, personal: boolean) => void
  onRenameSaved: (id: string, name: string) => void
  onRemoveSaved: (id: string) => void
  onTogglePersonal: (id: string, personal: boolean) => void
  onExportSaved: () => void
  onImportSaved: (text: string) => void
  /** Inserts a template (snippet syntax) into the editor, or into a new tab. */
  onInsert: (body: string, newTab: boolean) => void
  /** Runs a read-only template as it renders with its defaults. */
  onRun: (text: string) => void
  onPickQuery: (query: string) => void
  onClose: () => void
}

const RISK_STYLE: Record<TemplateRisk, string> = {
  read: 'bg-success/15 text-success',
  write: 'bg-warning/15 text-warning',
  destructive: 'bg-error/15 text-error',
}
const RISK_LABEL: Record<TemplateRisk, string> = { read: 'Read', write: 'Write', destructive: 'Destructive' }

// Redis has no joins or schema: the same categories read as key operations.
const REDIS_LABELS: Partial<Record<ConsoleCategory, string>> = {
  search: 'Read keys', insert: 'Add to collections', update: 'Write', delete: 'Delete', schema: 'Admin',
}

function categoryLabel(driver: string, id: ConsoleCategory, fallback: string): string {
  return driver === 'redis' ? REDIS_LABELS[id] ?? fallback : fallback
}

function matches(template: ConsoleTemplate, search: string): boolean {
  const q = search.trim().toLowerCase()
  return !q || `${template.title} ${template.description}`.toLowerCase().includes(q)
}

function shorten(query: string): string {
  const flat = query.replace(/\s+/g, ' ').trim()
  return flat.length > 90 ? `${flat.slice(0, 89)}…` : flat
}

/** A personal template is literal text: its `$` must not start a snippet stop. */
export function literalBody(query: string): string {
  return query.replace(/[\\$]/g, '\\$&')
}

const tabClass = (on: boolean) => cn(
  'flex h-6 items-center gap-1 rounded px-2 text-[10.5px] font-medium transition-colors',
  on ? 'bg-accent/15 text-accent' : 'text-text-3 hover:bg-surface-3 hover:text-text-1',
)

export function QueryConsole(props: QueryConsoleProps) {
  const {
    driver, targets, target, onTarget, columns, database, recent, saved, currentQuery,
    onSaveCurrent, onRenameSaved, onRemoveSaved, onTogglePersonal, onExportSaved, onImportSaved,
    onInsert, onRun, onPickQuery, onClose,
  } = props
  const [view, setView] = useState<View>('search')
  const [search, setSearch] = useState('')
  const [savedCategory, setSavedCategory] = useState<ConsoleCategory | ''>('')
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const renameRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (renaming) renameRef.current?.focus() }, [renaming])

  const all = useMemo(() => templatesFor(driver), [driver])
  const personal = useMemo(() => saved.filter((q) => q.personal), [saved])
  const counts = useMemo(() => {
    const out = new Map<ConsoleCategory, number>()
    for (const t of all) out.set(t.category, (out.get(t.category) ?? 0) + 1)
    for (const q of personal) out.set(q.category, (out.get(q.category) ?? 0) + 1)
    return out
  }, [all, personal])
  const categories = TEMPLATE_CATEGORIES.filter((c) => counts.has(c.id))
  const visible = view === 'saved' ? [] : all.filter((t) => t.category === view && matches(t, search))
  const visiblePersonal = view === 'saved' ? [] : filterSavedQueries(personal, { category: view, text: search })
  const shownSaved = filterSavedQueries(saved, { category: savedCategory || undefined, text: search })
  const recentShown = recent.filter((q) => !search.trim() || q.toLowerCase().includes(search.trim().toLowerCase()))

  const bodyFor = (template: ConsoleTemplate) => specializeTemplate(template.body, { table: target || undefined, columns, database: database || undefined })
  const renderedDefaults = (template: ConsoleTemplate) => renderSnippetText(parseSnippet(bodyFor(template)), {})

  const commitRename = () => {
    if (renaming) onRenameSaved(renaming.id, renaming.name)
    setRenaming(null)
  }

  const readImport = (file: File | undefined) => {
    if (!file) return
    void file.text().then(onImportSaved)
    if (importRef.current) importRef.current.value = ''
  }

  return (
    <aside aria-label="Query console" className="flex w-[300px] flex-none flex-col border-r border-border-1 bg-surface-1">
      <div className="flex h-9 flex-none items-center gap-2 border-b border-border-1 px-2.5">
        <span className="text-[11.5px] font-semibold text-text-1">Query console</span>
        <button onClick={onClose} aria-label="Close query console" className="ml-auto grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1">
          <X size={13} />
        </button>
      </div>

      <div className="flex flex-none flex-col gap-1.5 border-b border-border-1 p-2">
        {targets.length > 0 && (
          <label className="flex items-center gap-1.5 text-[10.5px] text-text-3">
            <span className="w-11 flex-none">Target</span>
            <select
              value={target}
              onChange={(e) => onTarget(e.target.value)}
              aria-label="Console target"
              className="h-7 min-w-0 flex-1 rounded-md border border-border-2 bg-surface-2 px-1.5 text-[11px] text-text-1 outline-none focus:border-accent/50"
            >
              <option value="">{driver === 'redis' ? 'Any key' : 'Choose…'}</option>
              {targets.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
        )}
        <div className="relative">
          <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-4" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter templates and saved queries"
            aria-label="Filter console templates"
            className="h-7 w-full rounded-md border border-border-2 bg-surface-2 pl-7 pr-2 text-[11px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent/50"
          />
        </div>
      </div>

      <div role="tablist" aria-label="Template categories" className="flex flex-none flex-wrap gap-1 border-b border-border-1 p-2">
        {categories.map((c) => (
          <button key={c.id} role="tab" aria-selected={view === c.id} onClick={() => setView(c.id)} className={tabClass(view === c.id)}>
            {categoryLabel(driver, c.id, c.label)}
            <span className="rounded bg-surface-3 px-1 text-[9.5px] text-text-3">{counts.get(c.id)}</span>
          </button>
        ))}
        <button role="tab" aria-selected={view === 'saved'} onClick={() => setView('saved')} className={tabClass(view === 'saved')}>
          <Star size={10} /> Saved
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {view === 'saved' ? (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-1">
              <select
                value={savedCategory}
                onChange={(e) => setSavedCategory(e.target.value as ConsoleCategory | '')}
                aria-label="Filter saved queries by category"
                className="h-6 min-w-0 flex-1 rounded-md border border-border-2 bg-surface-2 px-1 text-[10.5px] text-text-1 outline-none focus:border-accent/50"
              >
                <option value="">All categories</option>
                {TEMPLATE_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{categoryLabel(driver, c.id, c.label)}</option>)}
              </select>
              <button onClick={onExportSaved} disabled={!saved.length} title="Export saved queries to a file (secret-looking values are redacted)" aria-label="Export saved queries" className="grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1 disabled:opacity-40"><Download size={12} /></button>
              <button onClick={() => importRef.current?.click()} title="Import saved queries from a file" aria-label="Import saved queries" className="grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1"><Upload size={12} /></button>
              <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(e) => readImport(e.target.files?.[0])} />
            </div>
            <div className="mb-3 flex gap-1">
              <button
                onClick={() => onSaveCurrent('', false)}
                disabled={!currentQuery.trim()}
                className="h-6 flex-1 rounded-md border border-border-2 text-[10.5px] text-text-2 hover:border-accent/40 hover:text-text-1 disabled:opacity-40"
              >
                Save current query
              </button>
              <button
                onClick={() => onSaveCurrent('', true)}
                disabled={!currentQuery.trim()}
                title="Keep it as a template in its category, for every connection of this kind"
                className="h-6 flex-1 rounded-md border border-border-2 text-[10.5px] text-text-2 hover:border-accent/40 hover:text-text-1 disabled:opacity-40"
              >
                Save as template
              </button>
            </div>

            <section className="mb-3">
              <h4 className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-text-4"><Star size={11} /> Saved</h4>
              {shownSaved.length === 0 ? (
                <p className="px-1 text-[11px] text-text-4">Nothing here yet.</p>
              ) : shownSaved.map((q) => (
                <div key={q.id} className="mb-1 rounded-md border border-border-1 bg-surface-2 hover:border-accent/40">
                  {renaming?.id === q.id ? (
                    <input
                      ref={renameRef}
                      value={renaming.name}
                      aria-label="Saved query name"
                      onChange={(e) => setRenaming({ id: q.id, name: e.target.value })}
                      onBlur={commitRename}
                      onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null) }}
                      className="m-1 h-6 w-[calc(100%-8px)] rounded border border-accent/50 bg-surface-0 px-1.5 text-[11px] text-text-1 outline-none"
                    />
                  ) : (
                    <button onClick={() => onPickQuery(q.query)} title={q.query} className="block w-full px-2 pt-1.5 text-left">
                      <span className="flex items-center gap-1.5">
                        <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-text-1">{q.name}</span>
                        {q.personal && <span className="flex-none rounded bg-accent/15 px-1.5 py-px text-[9.5px] font-semibold text-accent">Mine</span>}
                      </span>
                      <span className="block truncate font-mono text-[10px] text-text-3">{shorten(q.query)}</span>
                    </button>
                  )}
                  <div className="flex items-center gap-0.5 px-1.5 pb-1">
                    <button onClick={() => setRenaming({ id: q.id, name: q.name })} aria-label={`Rename ${q.name}`} title="Rename" className="grid h-5 w-5 place-items-center rounded text-text-4 hover:bg-surface-3 hover:text-text-1"><Pencil size={10} /></button>
                    <button
                      onClick={() => onTogglePersonal(q.id, !q.personal)}
                      className="h-5 rounded px-1.5 text-[10px] text-text-4 hover:bg-surface-3 hover:text-text-1"
                      title={q.personal ? 'Remove from the templates list' : 'Show in the templates of its category'}
                    >
                      {q.personal ? 'Unpin template' : 'Use as template'}
                    </button>
                    <button onClick={() => onRemoveSaved(q.id)} aria-label={`Delete ${q.name}`} title="Delete" className="ml-auto grid h-5 w-5 place-items-center rounded text-text-4 hover:bg-error/15 hover:text-error"><Trash2 size={10} /></button>
                  </div>
                </div>
              ))}
            </section>

            <section>
              <h4 className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-text-4"><History size={11} /> Recent</h4>
              {recentShown.length === 0 ? (
                <p className="px-1 text-[11px] text-text-4">Nothing here yet.</p>
              ) : withContentKeys(recentShown.slice(0, 20), (query) => query).map(({ key, item: q }) => (
                <button
                  key={`recent-${key}`}
                  onClick={() => onPickQuery(q)}
                  title={q}
                  className="mb-1 block w-full truncate rounded-md border border-border-1 bg-surface-2 px-2 py-1.5 text-left font-mono text-[10.5px] text-text-2 hover:border-accent/40 hover:text-text-1"
                >
                  {shorten(q)}
                </button>
              ))}
            </section>
          </>
        ) : visible.length === 0 && visiblePersonal.length === 0 ? (
          <p className="px-1 py-2 text-[11px] text-text-4">No template matches.</p>
        ) : (
          <>
            {visiblePersonal.map((q) => (
              <div key={q.id} className="mb-1.5 rounded-md border border-accent/30 bg-surface-2 transition-colors hover:border-accent/60">
                <button onClick={() => onInsert(literalBody(q.query), false)} className="block w-full px-2.5 pb-1 pt-2 text-left" title={q.query}>
                  <span className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-text-1">{q.name}</span>
                    <span className="flex-none rounded bg-accent/15 px-1.5 py-px text-[9.5px] font-semibold text-accent">Mine</span>
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[10px] text-text-3">{shorten(q.query)}</span>
                </button>
                <div className="px-2 pb-1.5">
                  <button onClick={() => onInsert(literalBody(q.query), true)} className="flex h-6 items-center gap-1 rounded px-1.5 text-[10.5px] text-text-3 hover:bg-surface-3 hover:text-text-1" title="Insert in a new query tab">
                    <FilePlus2 size={11} /> New tab
                  </button>
                </div>
              </div>
            ))}
            {visible.map((template) => (
              <div key={template.id} className="mb-1.5 rounded-md border border-border-1 bg-surface-2 transition-colors hover:border-accent/40">
                <button onClick={() => onInsert(bodyFor(template), false)} className="block w-full px-2.5 pb-1 pt-2 text-left">
                  <span className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-text-1">{template.title}</span>
                    <span className={cn('flex-none rounded px-1.5 py-px text-[9.5px] font-semibold', RISK_STYLE[template.risk])}>{RISK_LABEL[template.risk]}</span>
                  </span>
                  <span className="mt-0.5 block text-[10.5px] leading-4 text-text-3">{template.description}</span>
                </button>
                <div className="flex items-center gap-1 px-2 pb-1.5">
                  <button
                    onClick={() => onInsert(bodyFor(template), true)}
                    className="flex h-6 items-center gap-1 rounded px-1.5 text-[10.5px] text-text-3 hover:bg-surface-3 hover:text-text-1"
                    title="Insert in a new query tab"
                  >
                    <FilePlus2 size={11} /> New tab
                  </button>
                  {template.risk === 'read' && (
                    <button
                      onClick={() => onRun(renderedDefaults(template))}
                      disabled={driver !== 'redis' && !target}
                      title={driver !== 'redis' && !target ? 'Choose a target first' : 'Run with the default values'}
                      className="flex h-6 items-center gap-1 rounded px-1.5 text-[10.5px] text-text-3 hover:bg-surface-3 hover:text-text-1 disabled:opacity-40"
                    >
                      <Play size={10} fill="currentColor" /> Run
                    </button>
                  )}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </aside>
  )
}
