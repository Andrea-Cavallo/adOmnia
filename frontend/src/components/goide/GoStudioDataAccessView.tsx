import { useMemo, useState } from 'react'
import { ArrowUpRight, ChevronDown, ChevronRight, Database } from 'lucide-react'
import type { GoIDEArchitecture } from '@/lib/goide-api'
import { handoffToPanel } from '@/lib/entities/dispatch'
import { isWrite, queriesByTable, shortPackage, type ArchQuery } from './goStudioArchitecture'
import { SiteLink } from './GoStudioInterfaceExplorer'

function openTable(table: string): void {
  handoffToPanel('database', { kind: 'table', id: `table:${table}`, label: table, attrs: {} }, 'query')
}

function openSQL(query: ArchQuery): void {
  if (query.sql) handoffToPanel('database', { kind: 'table', id: `sql:${query.site.relativePath}:${query.site.line}`, label: `${query.function}`, attrs: {} }, 'sql', { sql: query.sql })
}

function Badges({ query }: { query: ArchQuery }) {
  return (
    <>
      <span className={`shrink-0 rounded px-1 text-[10px] ${isWrite(query) ? 'bg-warning/15 text-warning' : 'bg-info/15 text-info'}`}>{query.operation === 'orm' ? query.method : isWrite(query) ? 'write' : query.operation}</span>
      {query.transaction && <span className="shrink-0 rounded bg-accent/15 px-1 text-[10px] text-accent" title="Runs inside a transaction">tx</span>}
      {query.prepared && <span className="shrink-0 rounded bg-surface-3 px-1 text-[10px] text-text-3" title="Prepared statement">prepared</span>}
      {query.dynamic && <span className="shrink-0 rounded bg-danger/10 px-1 text-[10px] text-danger" title="SQL built at runtime (Sprintf or concatenation): check it is parameterized">dynamic</span>}
    </>
  )
}

/** Accesso ai dati: tabella → funzioni che la usano, e tutte le query con libreria, SQL e transazioni. */
export function GoStudioDataAccessView({ report, query }: { report: GoIDEArchitecture; query: string }) {
  const [mode, setMode] = useState<'tables' | 'queries'>('tables')
  const [open, setOpen] = useState<string | null>(null)
  const tables = useMemo(() => queriesByTable(report.queries, query), [query, report.queries])
  const libraries = useMemo(() => [...new Set(report.queries.map((item) => item.library))], [report.queries])
  const needle = query.trim().toLowerCase()
  const queries = report.queries.filter((item) => item.operation !== 'begin' && (!needle || `${item.sql ?? ''} ${item.function} ${item.tables.join(' ')}`.toLowerCase().includes(needle)))
  if (!report.queries.length) return <p className="p-3 text-text-4">No database access found (database/sql, sqlx, pgx and GORM are recognized).</p>
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-center gap-2 px-2 py-1 text-text-3">
        {(['tables', 'queries'] as const).map((value) => <button key={value} type="button" onClick={() => setMode(value)} className={`rounded px-1.5 py-0.5 ${mode === value ? 'bg-accent/15 text-accent' : 'hover:bg-surface-3'}`}>{value === 'tables' ? `By table (${tables.length})` : `All queries (${queries.length})`}</button>)}
        <span className="ml-auto text-[10px] text-text-4">{libraries.join(' · ')} · {report.queries.filter((item) => item.transaction).length} in transactions</span>
      </div>
      {mode === 'tables' ? tables.map((table) => (
        <section key={table.table}>
          <div className="flex items-center gap-2 px-2 py-0.5 hover:bg-surface-2">
            <button type="button" onClick={() => setOpen(open === table.table ? null : table.table)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
              {open === table.table ? <ChevronDown size={11} aria-hidden="true" /> : <ChevronRight size={11} aria-hidden="true" />}
              <Database size={11} className="shrink-0 text-accent" aria-hidden="true" />
              <span className="truncate font-mono text-text-1">{table.table}</span>
              {table.guess && <span className="text-[10px] text-text-4" title="Table name derived from the GORM model by convention">(GORM naming)</span>}
              <span className="shrink-0 text-[10px] text-text-4">{table.reads} reads · {table.writes} writes · {table.functions.length} functions</span>
            </button>
            <button type="button" onClick={() => openTable(table.table)} className="flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-accent hover:bg-accent/10">Database Studio <ArrowUpRight size={10} aria-hidden="true" /></button>
          </div>
          {open === table.table && table.queries.map((item, index) => (
            <div key={index} className="flex items-center gap-2 py-0.5 pl-8 pr-2">
              <SiteLink site={item.site} label={item.function} />
              <Badges query={item} />
              <span className="truncate text-[10px] text-text-4">{item.library} · {shortPackage(item.package)}</span>
            </div>
          ))}
        </section>
      )) : queries.map((item, index) => (
        <div key={index} className="border-b border-border-1 px-2 py-1">
          <div className="flex items-center gap-2">
            <SiteLink site={item.site} label={item.function} />
            <Badges query={item} />
            <span className="text-[10px] text-text-4">{item.library}.{item.method}{item.model ? ` · model ${item.model}` : ''}</span>
            {item.sql && <button type="button" onClick={() => openSQL(item)} className="ml-auto flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-accent hover:bg-accent/10">Open SQL <ArrowUpRight size={10} aria-hidden="true" /></button>}
          </div>
          {item.sql ? <pre className="mt-0.5 max-h-16 overflow-hidden whitespace-pre-wrap font-mono text-[10px] text-text-2">{item.sql}</pre> : item.tables.length > 0 && <div className="mt-0.5 font-mono text-[10px] text-text-3">{item.tables.join(', ')}</div>}
        </div>
      ))}
    </div>
  )
}
