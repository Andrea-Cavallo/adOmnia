import { useMemo, useState } from 'react'
import { Ban, ChevronDown, ChevronRight, Layers, Plus, RotateCcw, Save, Star, Trash2, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  FACET_FIELDS,
  LOG_LEVELS,
  computeFacet,
  type FacetField,
  type LogEvent,
  type LogFilterState,
  type LogLevel,
  type FieldDiscovery,
  type StoredSchema,
} from '@/lib/loginspector'
import type { LevelCounts } from '@/lib/loginspector'
import { LEVEL_SHORT, LEVEL_STYLE } from './EventList'

export interface SavedQuery {
  id: string
  name: string
  query: string
}

const FIELDS_SHOWN = 40

const FACET_LABELS: Record<FacetField, string> = {
  service: 'Service',
  namespace: 'Namespace',
  pod: 'Pod',
  container: 'Container',
  logger: 'Logger',
  thread: 'Thread',
}

const BUILDER_FIELDS = ['level', 'service', 'namespace', 'pod', 'container', 'logger', 'thread', 'correlationId', 'traceId', 'requestId', 'message'] as const

function toLocalInput(ms: number | null): string {
  if (ms === null) return ''
  const date = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000)
  return date.toISOString().slice(0, 19)
}

function fromLocalInput(value: string): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

interface FilterSidebarProps {
  filters: LogFilterState
  onChange: (next: LogFilterState) => void
  /** Keys found in this batch, discovered automatically after the import. */
  discovery: FieldDiscovery
  /** Keys remembered from earlier imports of the same shape but absent here. */
  rememberedOnly: string[]
  schema: StoredSchema | null
  /** Unfiltered batch — facets always describe the whole import. */
  events: LogEvent[]
  levelCounts: LevelCounts
  savedQueries: SavedQuery[]
  onSaveQuery: (name: string) => void
  onDeleteQuery: (id: string) => void
  onReset: () => void
}

export function FilterSidebar({
  filters,
  onChange,
  discovery,
  rememberedOnly,
  schema,
  events,
  levelCounts,
  savedQueries,
  onSaveQuery,
  onDeleteQuery,
  onReset,
}: FilterSidebarProps) {
  const [openFacets, setOpenFacets] = useState<Record<string, boolean>>({ service: true, pod: true })
  const [builderField, setBuilderField] = useState<string>('level')
  const [builderOp, setBuilderOp] = useState<'is' | 'not' | 'exists'>('is')
  const [builderValue, setBuilderValue] = useState('')
  const [fieldSearch, setFieldSearch] = useState('')
  const [openField, setOpenField] = useState<string | null>(null)

  const appendClause = (clause: string) => {
    onChange({ ...filters, query: filters.query ? `${filters.query} ${clause}` : clause })
  }

  const matchingFields = useMemo(() => {
    const needle = fieldSearch.trim().toLowerCase()
    const found = needle
      ? discovery.fields.filter((field) => field.path.toLowerCase().includes(needle))
      : discovery.fields
    return found.slice(0, FIELDS_SHOWN)
  }, [discovery.fields, fieldSearch])

  const matchingRemembered = useMemo(() => {
    const needle = fieldSearch.trim().toLowerCase()
    return needle ? rememberedOnly.filter((path) => path.toLowerCase().includes(needle)) : rememberedOnly
  }, [rememberedOnly, fieldSearch])

  const facets = useMemo(
    () => FACET_FIELDS.map((field) => ({ field, values: computeFacet(events, field, 40) })).filter((entry) => entry.values.length > 0),
    [events],
  )

  const toggleLevel = (level: LogLevel) => {
    const active = filters.levels.includes(level)
    onChange({ ...filters, levels: active ? filters.levels.filter((l) => l !== level) : [...filters.levels, level] })
  }

  const toggleFacetValue = (bucket: 'include' | 'exclude', field: FacetField, value: string) => {
    const current = filters[bucket][field] ?? []
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
    onChange({ ...filters, [bucket]: { ...filters[bucket], [field]: next } })
  }

  const addBuilderClause = () => {
    const value = builderOp === 'exists' ? '*' : builderValue.trim()
    if (!value) return
    const clause = `${builderOp === 'not' ? '-' : ''}${builderField}:${value.includes(' ') ? `"${value}"` : value}`
    onChange({ ...filters, query: filters.query ? `${filters.query} ${clause}` : clause })
    setBuilderValue('')
  }

  const saveCurrent = () => {
    const name = filters.query.trim()
    if (name) onSaveQuery(name)
  }

  return (
    <div className="flex min-h-0 w-full flex-col overflow-hidden bg-surface-1">
      <div className="flex shrink-0 items-center gap-2 border-b border-border-1 px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-3">Filters</span>
        <button
          onClick={onReset}
          title="Reset every filter"
          className="ml-auto flex h-6 items-center gap-1 rounded border border-border-2 px-2 text-[10px] text-text-3 hover:border-accent/40 hover:text-text-1"
        >
          <RotateCcw size={10} /> Reset
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <Section title="Level">
          <div className="flex flex-wrap gap-1">
            {LOG_LEVELS.map((level) => {
              const count = levelCounts[level]
              const active = filters.levels.includes(level)
              return (
                <button
                  key={level}
                  onClick={() => toggleLevel(level)}
                  disabled={count === 0 && !active}
                  className={cn(
                    'flex items-center gap-1 rounded border px-1.5 py-[3px] font-mono text-[10px] transition-colors disabled:opacity-30',
                    active ? 'border-accent bg-accent/20 text-text-1' : 'border-border-2 hover:border-accent/40',
                    !active && LEVEL_STYLE[level],
                  )}
                >
                  {LEVEL_SHORT[level]}
                  <span className="text-text-4">{count}</span>
                </button>
              )
            })}
          </div>
        </Section>

        {(discovery.fields.length > 0 || rememberedOnly.length > 0) && (
          <Section title={`Fields (${discovery.fields.length})`}>
            <p className="mb-1.5 text-[10px] leading-[1.45] text-text-4">
              Detected automatically from this log
              {discovery.sampled < discovery.total ? `, sampled ${discovery.sampled.toLocaleString()} of ${discovery.total.toLocaleString()} events` : ''}
              {schema ? ` · shape "${schema.name}" seen ${schema.seen}×` : ''}
            </p>

            {discovery.fields.length > 8 && (
              <input
                value={fieldSearch}
                onChange={(event) => setFieldSearch(event.target.value)}
                placeholder="Find a field..."
                aria-label="Find a field"
                className="mb-1.5 h-6 w-full rounded border border-border-2 bg-surface-0 px-1.5 font-mono text-[10px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent"
              />
            )}

            <div className="flex flex-col gap-[2px]">
              {matchingFields.map((field) => {
                const open = openField === field.path
                const hasValues = field.values.length > 0
                return (
                  <div key={field.path}>
                    <div className="group flex items-center gap-1">
                      <button
                        onClick={() => (hasValues ? setOpenField(open ? null : field.path) : appendClause(`${field.path}:*`))}
                        title={hasValues ? `${field.path} — show top values` : `${field.path} — filter events that have it`}
                        className="flex min-w-0 flex-1 items-center gap-1 rounded px-1.5 py-[2px] text-left hover:bg-surface-2"
                      >
                        {hasValues
                          ? <ChevronRight size={9} className={cn('shrink-0 text-text-4 transition-transform', open && 'rotate-90')} />
                          : <span className="w-[9px] shrink-0" />}
                        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-text-2">{field.path}</span>
                        <span className="shrink-0 font-mono text-[9px] text-text-4">
                          {field.distinct === -1 ? 'id' : `${Math.round(field.coverage * 100)}%`}
                        </span>
                      </button>
                      <button
                        onClick={() => appendClause(`-${field.path}:*`)}
                        title={`Exclude events that have ${field.path}`}
                        className="shrink-0 text-text-4 opacity-0 transition-opacity hover:text-error group-hover:opacity-100"
                      >
                        <Ban size={10} />
                      </button>
                    </div>

                    {open && (
                      <div className="mb-1 ml-3 flex flex-col gap-[2px] border-l border-border-2 pl-1.5">
                        {field.values.map(({ value, count }) => (
                          <button
                            key={value}
                            onClick={() => appendClause(`${field.path}:${value.includes(' ') ? `"${value}"` : value}`)}
                            title={`Filter ${field.path} = ${value}`}
                            className="flex items-center gap-1 rounded px-1 py-[2px] text-left hover:bg-surface-2"
                          >
                            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-text-2">{value}</span>
                            <span className="shrink-0 font-mono text-[9px] text-text-4">{count}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}

              {discovery.fields.length > matchingFields.length && (
                <p className="px-1.5 py-[2px] text-[9px] text-text-4">
                  {discovery.fields.length - matchingFields.length} more — narrow with the box above
                </p>
              )}

              {matchingRemembered.length > 0 && (
                <>
                  <p className="mt-1.5 px-1.5 text-[9px] uppercase tracking-wider text-text-4">
                    Remembered, absent here
                  </p>
                  {matchingRemembered.slice(0, 12).map((path) => (
                    <button
                      key={path}
                      onClick={() => appendClause(`${path}:*`)}
                      title={`${path} — seen in an earlier import of this log`}
                      className="truncate rounded px-1.5 py-[2px] text-left font-mono text-[10px] text-text-4 hover:bg-surface-2 hover:text-text-2"
                    >
                      {path}
                    </button>
                  ))}
                </>
              )}
            </div>
          </Section>
        )}

        <Section title="Quick filters">
          <div className="flex flex-col gap-1">
            <ToggleRow
              active={filters.onlyStack}
              onClick={() => onChange({ ...filters, onlyStack: !filters.onlyStack })}
              icon={<Layers size={11} />}
              label="Only events with a stack trace"
            />
            <ToggleRow
              active={filters.onlyUnparsed}
              onClick={() => onChange({ ...filters, onlyUnparsed: !filters.onlyUnparsed })}
              icon={<TriangleAlert size={11} />}
              label="Only unparsable lines"
            />
          </div>
        </Section>

        <Section title="Time range">
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-2">
              <span className="w-8 text-[10px] text-text-4">From</span>
              <input
                type="datetime-local"
                step="1"
                value={toLocalInput(filters.from)}
                onChange={(event) => onChange({ ...filters, from: fromLocalInput(event.target.value) })}
                className="h-6 min-w-0 flex-1 rounded border border-border-2 bg-surface-0 px-1.5 font-mono text-[10px] text-text-1 outline-none focus:border-accent"
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="w-8 text-[10px] text-text-4">To</span>
              <input
                type="datetime-local"
                step="1"
                value={toLocalInput(filters.to)}
                onChange={(event) => onChange({ ...filters, to: fromLocalInput(event.target.value) })}
                className="h-6 min-w-0 flex-1 rounded border border-border-2 bg-surface-0 px-1.5 font-mono text-[10px] text-text-1 outline-none focus:border-accent"
              />
            </label>
          </div>
        </Section>

        <Section title="Query builder">
          <div className="flex flex-col gap-1.5">
            <div className="flex gap-1.5">
              <select
                value={builderField}
                onChange={(event) => setBuilderField(event.target.value)}
                className="h-6 min-w-0 flex-1 rounded border border-border-2 bg-surface-0 px-1 text-[10px] text-text-1 outline-none focus:border-accent"
              >
                {BUILDER_FIELDS.map((field) => <option key={field} value={field}>{field}</option>)}
              </select>
              <select
                value={builderOp}
                onChange={(event) => setBuilderOp(event.target.value as 'is' | 'not' | 'exists')}
                className="h-6 w-[76px] rounded border border-border-2 bg-surface-0 px-1 text-[10px] text-text-1 outline-none focus:border-accent"
              >
                <option value="is">is</option>
                <option value="not">is not</option>
                <option value="exists">exists</option>
              </select>
            </div>
            <div className="flex gap-1.5">
              <input
                value={builderValue}
                onChange={(event) => setBuilderValue(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') addBuilderClause() }}
                disabled={builderOp === 'exists'}
                placeholder="value (use * as wildcard)"
                className="h-6 min-w-0 flex-1 rounded border border-border-2 bg-surface-0 px-1.5 font-mono text-[10px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent disabled:opacity-40"
              />
              <button
                onClick={addBuilderClause}
                title="Append this clause to the query"
                className="grid h-6 w-6 shrink-0 place-items-center rounded border border-accent/40 bg-accent/15 text-accent-light hover:bg-accent/25"
              >
                <Plus size={12} />
              </button>
            </div>
          </div>
        </Section>

        <Section title="Saved queries">
          <div className="flex flex-col gap-1">
            <button
              onClick={saveCurrent}
              disabled={!filters.query.trim()}
              className="flex h-6 items-center justify-center gap-1 rounded border border-border-2 text-[10px] text-text-3 hover:border-accent/40 hover:text-text-1 disabled:opacity-35"
            >
              <Save size={10} /> Save current query
            </button>
            {savedQueries.length === 0 && <p className="py-1 text-[10px] text-text-4">Nothing saved yet.</p>}
            {savedQueries.map((saved) => (
              <div key={saved.id} className="group flex items-center gap-1 rounded px-1 py-[3px] hover:bg-surface-2">
                <Star size={10} className="shrink-0 text-accent-light" />
                <button
                  onClick={() => onChange({ ...filters, query: saved.query })}
                  title={saved.query}
                  className="min-w-0 flex-1 truncate text-left font-mono text-[10px] text-text-2 hover:text-text-1"
                >
                  {saved.name}
                </button>
                <button
                  onClick={() => onDeleteQuery(saved.id)}
                  title="Delete"
                  className="shrink-0 text-text-4 opacity-0 transition-opacity hover:text-error group-hover:opacity-100"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            ))}
          </div>
        </Section>

        {facets.map(({ field, values }) => {
          const open = openFacets[field] ?? false
          const included = filters.include[field] ?? []
          const excluded = filters.exclude[field] ?? []
          const activeCount = included.length + excluded.length
          return (
            <div key={field} className="mb-2 border-t border-border-2 pt-2">
              <button
                onClick={() => setOpenFacets((current) => ({ ...current, [field]: !open }))}
                className="flex w-full items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-3 hover:text-text-1"
              >
                {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                {FACET_LABELS[field]}
                <span className="ml-auto rounded bg-surface-2 px-1.5 text-[9px] font-normal text-text-4">
                  {activeCount > 0 ? `${activeCount} active` : values.length}
                </span>
              </button>
              {open && (
                <div className="mt-1 flex flex-col gap-[2px]">
                  {values.map(({ value, count }) => {
                    const isIncluded = included.includes(value)
                    const isExcluded = excluded.includes(value)
                    return (
                      <div key={value} className="group flex items-center gap-1">
                        <button
                          onClick={() => toggleFacetValue('include', field, value)}
                          title={value}
                          className={cn(
                            'min-w-0 flex-1 truncate rounded px-1.5 py-[2px] text-left font-mono text-[10px] transition-colors',
                            isIncluded ? 'bg-accent/25 text-text-1' : 'text-text-2 hover:bg-surface-2',
                            isExcluded && 'text-text-4 line-through',
                          )}
                        >
                          {value}
                        </button>
                        <span className="shrink-0 font-mono text-[9px] text-text-4">{count}</span>
                        <button
                          onClick={() => toggleFacetValue('exclude', field, value)}
                          title={isExcluded ? 'Stop excluding' : 'Exclude this value'}
                          className={cn(
                            'shrink-0 transition-opacity hover:text-error',
                            isExcluded ? 'text-error opacity-100' : 'text-text-4 opacity-0 group-hover:opacity-100',
                          )}
                        >
                          <Ban size={10} />
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
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-3">{title}</p>
      {children}
    </div>
  )
}

function ToggleRow({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded border px-2 py-1 text-left text-[10px] transition-colors',
        active ? 'border-accent/50 bg-accent/15 text-text-1' : 'border-border-2 text-text-3 hover:border-accent/40 hover:text-text-1',
      )}
    >
      <span className={active ? 'text-accent-light' : 'text-text-4'}>{icon}</span>
      {label}
    </button>
  )
}
