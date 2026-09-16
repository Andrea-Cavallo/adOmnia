import { useEffect, useState, type ReactNode } from 'react'
import { Braces, ChevronLeft, ChevronRight, Code2, Download, FileJson, Gauge, List, Loader2, Plus, RefreshCw, Table2, Upload, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { download, highlightedJson, type DbConnection } from '../dbShared'
import { AggregationsTab } from './AggregationsTab'
import { documentColumns, stringifyEditable, toEditable, type BsonDoc } from './bson'
import type { CodeRequest } from './codegen'
import { CodeExportDialog } from './CodeExportDialog'
import { BsonInline, DocumentCard } from './DocumentCard'
import { DocumentEditor } from './DocumentEditor'
import { ExplainDialog } from './ExplainDialog'
import { parseImportFile } from './importExport'
import { IndexesTab } from './IndexesTab'
import { MongoNavigator } from './MongoNavigator'
import { MongoQueryBar } from './MongoQueryBar'
import { SchemaTab } from './SchemaTab'
import { EmptyState, ErrorBox, errorText, firstDocument, formatBytes, numberValue } from './ui'
import { findSpec, useMongoBrowser, type RunMongo } from './useMongoBrowser'
import { ValidationTab } from './ValidationTab'

type ViewMode = 'list' | 'table' | 'json'
type WorkspaceTab = 'documents' | 'aggregations' | 'schema' | 'indexes' | 'validation'

interface MongoWorkspaceProps {
  connection: DbConnection
  runMongo: RunMongo
  reloadToken: number
  modeSwitch: ReactNode
}

const VIEW_MODES: { id: ViewMode; label: string; icon: ReactNode }[] = [
  { id: 'list', label: 'List', icon: <List size={13} /> },
  { id: 'json', label: 'JSON', icon: <Braces size={13} /> },
  { id: 'table', label: 'Table', icon: <Table2 size={13} /> },
]

const TABS: { id: WorkspaceTab; label: string }[] = [
  { id: 'documents', label: 'Documents' },
  { id: 'aggregations', label: 'Aggregations' },
  { id: 'schema', label: 'Schema' },
  { id: 'indexes', label: 'Indexes' },
  { id: 'validation', label: 'Validation' },
]

interface CollectionStats {
  count: number | null
  size: number | null
  avgObjSize: number | null
  nindexes: number | null
  totalIndexSize: number | null
}

function withoutId(doc: BsonDoc): BsonDoc {
  const { _id: _ignored, ...rest } = doc
  return rest
}

export function MongoWorkspace({ connection, runMongo, reloadToken, modeSwitch }: MongoWorkspaceProps) {
  const m = useMongoBrowser(connection, runMongo, reloadToken)
  const [tab, setTab] = useState<WorkspaceTab>('documents')
  const [view, setView] = useState<ViewMode>('list')
  const [insertText, setInsertText] = useState<string | null>(null)
  const [insertError, setInsertError] = useState('')
  const [notice, setNotice] = useState('')
  const [explainCommand, setExplainCommand] = useState<BsonDoc | null>(null)
  const [codeRequest, setCodeRequest] = useState<CodeRequest | null>(null)
  const [stats, setStats] = useState<CollectionStats | null>(null)
  const [transfer, setTransfer] = useState('')

  const selected = m.selected
  const limit = Math.min(1000, Math.max(1, Number(m.query.limit) || 20))
  const from = m.docs.length ? m.page * limit + 1 : 0
  const to = m.page * limit + m.docs.length
  const hasNext = m.total != null ? to < m.total : m.docs.length === limit

  useEffect(() => {
    setStats(null)
    if (!selected) return
    let alive = true
    runMongo({
      operation: 'aggregate', database: selected.db, collection: selected.collection, canonical: true,
      pipeline: [{ $collStats: { storageStats: {} } }, { $project: { 'storageStats.count': 1, 'storageStats.size': 1, 'storageStats.avgObjSize': 1, 'storageStats.nindexes': 1, 'storageStats.totalIndexSize': 1 } }],
    }).then((r) => {
      const s = (firstDocument(r).storageStats ?? {}) as BsonDoc
      if (alive) setStats({ count: numberValue(s.count), size: numberValue(s.size), avgObjSize: numberValue(s.avgObjSize), nindexes: numberValue(s.nindexes), totalIndexSize: numberValue(s.totalIndexSize) })
    }).catch(() => { /* $collStats needs clusterMonitor-like privileges; the header just omits stats */ })
    return () => { alive = false }
  }, [runMongo, selected, m.busy, tab])

  useEffect(() => { if (!notice) return; const t = window.setTimeout(() => setNotice(''), 4000); return () => window.clearTimeout(t) }, [notice])

  const openInsert = (doc?: BsonDoc) => { setInsertError(''); setInsertText(doc ? stringifyEditable(doc) : '{\n  \n}') }

  const submitInsert = async (text: string) => {
    setInsertError('')
    try {
      await m.insertDocuments(text)
      setInsertText(null)
    } catch (e) {
      setInsertError(errorText(e))
    }
  }

  const withSpec = (action: (spec: ReturnType<typeof findSpec>) => void) => {
    try { action(findSpec(m.query)) } catch (e) { setNotice(errorText(e)) }
  }

  const importFile = async (file: File) => {
    setInsertError('')
    try {
      const docs = parseImportFile(file.name, await file.text())
      setInsertText(null)
      setTransfer(`Importing 0 / ${docs.length.toLocaleString()}`)
      const done = await m.importDocuments(docs, (n) => setTransfer(`Importing ${n.toLocaleString()} / ${docs.length.toLocaleString()}`))
      setNotice(`${done.toLocaleString()} documents imported from ${file.name}`)
    } catch (e) {
      setInsertError(errorText(e))
      setNotice(`Import failed: ${errorText(e)}`)
    } finally {
      setTransfer('')
    }
  }

  const exportCollection = async () => {
    if (!selected) return
    try {
      setTransfer('Exporting 0')
      const docs = await m.exportDocuments((n) => setTransfer(`Exporting ${n.toLocaleString()}`))
      download(`${selected.db}.${selected.collection}.json`, JSON.stringify(docs.map(toEditable), null, 2), 'application/json')
      setNotice(`${docs.length.toLocaleString()} documents exported`)
    } catch (e) {
      setNotice(`Export failed: ${errorText(e)}`)
    } finally {
      setTransfer('')
    }
  }

  const useSchemaField = (path: string) => {
    const field = path.replace(/\[\]/g, '')
    m.setQuery({ ...m.query, filter: `{ ${/^[A-Za-z_$][\w$]*$/.test(field) ? field : JSON.stringify(field)}: { $exists: true } }` })
    setTab('documents')
  }

  let schemaFilter: BsonDoc | null = null
  try { schemaFilter = findSpec(m.query).filter } catch { schemaFilter = null }

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <MongoNavigator
        databases={m.databases}
        expanded={m.expanded}
        loading={m.treeLoading}
        error={m.treeError}
        selected={selected}
        onRefresh={() => void m.refreshDatabases()}
        onToggle={m.toggleDb}
        onSelect={(db, collection) => { m.selectCollection(db, collection); setTab('documents') }}
        onCreateCollection={m.createCollection}
        onDropCollection={m.dropCollection}
      />

      <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-0">
        {/* header: breadcrumb, stats, mode switch */}
        <div className="flex h-11 flex-none items-center gap-3 border-b border-border-1 bg-surface-1 px-3">
          {selected ? (
            <div className="flex min-w-0 items-baseline gap-1.5">
              <span className="truncate text-[12px] text-text-3">{selected.db}</span>
              <span className="text-text-4">/</span>
              <span className="truncate text-[13px] font-semibold text-text-1">{selected.collection}</span>
            </div>
          ) : (
            <span className="text-[12px] text-text-3">Select a collection</span>
          )}
          {selected && stats && (
            <div className="hidden min-w-0 items-center gap-3 text-[11px] text-text-3 xl:flex">
              <Stat label="documents" value={stats.count?.toLocaleString()} />
              <Stat label="storage" value={formatBytes(stats.size)} />
              <Stat label="avg doc" value={formatBytes(stats.avgObjSize)} />
              <Stat label={stats.nindexes === 1 ? 'index' : 'indexes'} value={stats.nindexes != null ? `${stats.nindexes} · ${formatBytes(stats.totalIndexSize)}` : undefined} />
            </div>
          )}
          <div className="ml-auto">{modeSwitch}</div>
        </div>

        {selected && (
          <div role="tablist" aria-label="Collection views" className="flex h-9 flex-none items-end gap-1 border-b border-border-1 bg-surface-1 px-2">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn('relative h-9 px-3 text-[12px] font-medium transition-colors', tab === t.id ? 'text-text-1' : 'text-text-3 hover:text-text-2')}
              >
                {t.label}
                {tab === t.id && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent" />}
              </button>
            ))}
          </div>
        )}

        {!selected ? (
          <EmptyState title="Browse your data" text="Pick a collection from the database tree to see, filter and edit its documents." />
        ) : tab === 'aggregations' ? (
          <AggregationsTab key={`${selected.db}.${selected.collection}`} runMongo={runMongo} db={selected.db} collection={selected.collection} onExportCode={(pipeline) => setCodeRequest({ kind: 'aggregate', db: selected.db, collection: selected.collection, pipeline })} />
        ) : tab === 'schema' ? (
          <SchemaTab key={`${selected.db}.${selected.collection}`} runMongo={runMongo} db={selected.db} collection={selected.collection} filter={schemaFilter} onUseField={useSchemaField} />
        ) : tab === 'indexes' ? (
          <IndexesTab runMongo={runMongo} db={selected.db} collection={selected.collection} />
        ) : tab === 'validation' ? (
          <ValidationTab runMongo={runMongo} db={selected.db} collection={selected.collection} />
        ) : (
          <>
            <MongoQueryBar value={m.query} running={m.loading} disabled={false} onChange={m.setQuery} onFind={m.runFind} onReset={m.resetQuery} />

            <div className="flex h-10 flex-none items-center gap-1 border-b border-border-1 bg-surface-1 px-3">
              <button type="button" onClick={() => openInsert()} className="flex h-7 items-center gap-1.5 rounded-md bg-accent/15 px-2.5 text-[11.5px] font-semibold text-accent hover:bg-accent/25">
                <Plus size={13} /> Add data
              </button>
              <ToolbarButton icon={<Download size={13} />} label="Export" onClick={() => void exportCollection()} disabled={!!transfer} title="Export every document matching the filter (JSON)" />
              <ToolbarButton icon={<Gauge size={13} />} label="Explain" onClick={() => withSpec((s) => setExplainCommand({ find: selected.collection, filter: s.filter, ...(s.projection ? { projection: s.projection } : {}), ...(s.sort ? { sort: s.sort } : {}), skip: s.skip, limit: s.limit }))} />
              <ToolbarButton icon={<Code2 size={13} />} label="To code" onClick={() => withSpec((s) => setCodeRequest({ kind: 'find', db: selected.db, collection: selected.collection, ...s }))} />
              {transfer && <span className="ml-2 flex items-center gap-1.5 text-[11px] text-text-3"><Loader2 size={12} className="animate-spin" />{transfer}</span>}
              <div className="ml-auto flex items-center gap-1.5">
                {m.loading && <Loader2 size={13} className="animate-spin text-text-4" />}
                <span className="text-[11px] tabular-nums text-text-3">
                  {from}–{to}{m.total != null && <> of <b className="font-semibold text-text-1">{m.total.toLocaleString()}</b></>}
                  {m.durationMs != null && <span className="text-text-4"> · {m.durationMs} ms</span>}
                </span>
                <button type="button" aria-label="Previous page" onClick={() => m.goToPage(m.page - 1)} disabled={m.page === 0 || m.loading} className="grid h-7 w-7 place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text-1 disabled:opacity-30"><ChevronLeft size={14} /></button>
                <button type="button" aria-label="Next page" onClick={() => m.goToPage(m.page + 1)} disabled={!hasNext || m.loading} className="grid h-7 w-7 place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text-1 disabled:opacity-30"><ChevronRight size={14} /></button>
                <button type="button" aria-label="Refresh documents" onClick={() => m.goToPage(m.page)} className="grid h-7 w-7 place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text-1"><RefreshCw size={13} /></button>
                <div role="tablist" aria-label="Document view" className="ml-1 flex rounded-md border border-border-2 p-0.5">
                  {VIEW_MODES.map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      role="tab"
                      aria-selected={view === mode.id}
                      title={mode.label}
                      aria-label={mode.label}
                      onClick={() => setView(mode.id)}
                      className={cn('grid h-6 w-7 place-items-center rounded', view === mode.id ? 'bg-surface-3 text-text-1' : 'text-text-4 hover:text-text-1')}
                    >
                      {mode.icon}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              <ErrorBox message={m.error} className="m-3" />
              {!m.loading && !m.error && m.docs.length === 0 ? (
                <EmptyState title="No documents" text="Nothing matches this query. Change the filter or add data." />
              ) : view === 'list' ? (
                <div className="space-y-2 p-3">
                  {m.docs.map((doc, i) => (
                    <DocumentCard
                      key={JSON.stringify(doc._id ?? i)}
                      doc={doc}
                      busy={m.busy}
                      onSave={(text) => m.replaceDocument(doc, text)}
                      onDelete={() => m.deleteDocument(doc)}
                      onClone={() => openInsert(withoutId(doc))}
                    />
                  ))}
                </div>
              ) : view === 'json' ? (
                <pre className="whitespace-pre-wrap break-all p-3 font-mono text-[11.5px] leading-5">{highlightedJson(JSON.stringify(m.docs.map(toEditable), null, 2))}</pre>
              ) : (
                <DocumentTable docs={m.docs} offset={m.page * limit} />
              )}
            </div>
          </>
        )}
      </section>

      {insertText != null && selected && (
        <div className="fixed inset-0 z-[260] grid place-items-center bg-black/55 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setInsertText(null) }}>
          <div role="dialog" aria-modal="true" aria-labelledby="mongo-insert-title" className="w-full max-w-2xl overflow-hidden rounded-md border border-border-2 bg-surface-2 shadow-2xl">
            <div className="flex h-11 items-center gap-2 border-b border-border-1 px-3.5">
              <FileJson size={14} className="text-accent" />
              <h3 id="mongo-insert-title" className="text-[13px] font-semibold text-text-1">Insert into {selected.collection}</h3>
              <label className="ml-auto flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border-2 px-2.5 text-[11.5px] text-text-2 hover:bg-surface-3 hover:text-text-1">
                <Upload size={12} /> Import file
                <input type="file" accept=".json,.ndjson,.jsonl,.csv" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f) }} />
              </label>
              <button type="button" onClick={() => setInsertText(null)} aria-label="Close insert dialog" className="grid h-7 w-7 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1"><X size={14} /></button>
            </div>
            <DocumentEditor
              initial={insertText}
              busy={m.busy}
              submitLabel="Insert"
              hint="One document or an array · or import JSON / NDJSON / CSV"
              onCancel={() => setInsertText(null)}
              onSubmit={submitInsert}
            />
            {insertError && <div className="border-t border-error/30 bg-error/10 px-3.5 py-2 text-[11px] text-error">{insertError}</div>}
          </div>
        </div>
      )}

      {explainCommand && selected && <ExplainDialog runMongo={runMongo} db={selected.db} command={explainCommand} onClose={() => setExplainCommand(null)} />}
      {codeRequest && <CodeExportDialog request={codeRequest} onClose={() => setCodeRequest(null)} />}

      {notice && (
        <div role="status" className="absolute bottom-4 right-4 z-40 max-w-md rounded-lg border border-border-2 bg-surface-2 px-3.5 py-2 text-[11.5px] text-text-1 shadow-xl">{notice}</div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | undefined }) {
  if (value == null || value === '—') return null
  return <span className="whitespace-nowrap"><b className="font-semibold tabular-nums text-text-2">{value}</b> {label}</span>
}

function ToolbarButton({ icon, label, onClick, disabled, title }: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean; title?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title ?? label} className="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11.5px] text-text-2 hover:bg-surface-2 hover:text-text-1 disabled:opacity-40">
      {icon} {label}
    </button>
  )
}

function DocumentTable({ docs, offset }: { docs: BsonDoc[]; offset: number }) {
  const columns = documentColumns(docs)
  return (
    <table className="border-separate border-spacing-0 text-left">
      <thead className="sticky top-0 z-10">
        <tr>
          <th className="sticky left-0 z-20 w-10 border-b border-r border-border-1 bg-surface-2" />
          {columns.map((col) => (
            <th key={col} className="h-8 whitespace-nowrap border-b border-r border-border-1 bg-surface-2 px-3 text-[11.5px] font-semibold text-text-1">{col}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {docs.map((doc, i) => (
          <tr key={i} className="group">
            <td className="sticky left-0 border-b border-r border-border-1 bg-surface-1 px-2 text-right font-mono text-[10px] text-text-4 group-hover:bg-surface-2">{offset + i + 1}</td>
            {columns.map((col) => (
              <td key={col} className="h-8 max-w-[320px] truncate border-b border-r border-border-1 px-3 text-[11.5px] group-hover:bg-surface-1">
                {col in doc ? <BsonInline value={doc[col]} /> : <span className="text-text-4">—</span>}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
