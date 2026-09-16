import { useCallback, useEffect, useState } from 'react'
import { KeyRound, Loader2, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { parseShellDoc, type BsonDoc } from './bson'
import type { RunMongo } from './useMongoBrowser'
import { EmptyState, ErrorBox, errorText, fieldInput, firstDocument, formatBytes, numberValue, primaryButton, secondaryButton } from './ui'

interface IndexInfo {
  name: string
  key: BsonDoc
  unique: boolean
  sparse: boolean
  hidden: boolean
  ttl: number | null
  partial: boolean
  size: number | null
  ops: number | null
  since: string
}

type KeyType = '1' | '-1' | 'text' | '2dsphere' | 'hashed'

interface IndexesTabProps {
  runMongo: RunMongo
  db: string
  collection: string
}

export function IndexesTab({ runMongo, db, collection }: IndexesTabProps) {
  const [indexes, setIndexes] = useState<IndexInfo[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [dropping, setDropping] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const listed = firstDocument(await runMongo({ operation: 'runCommand', database: db, command: { listIndexes: collection }, canonical: true }))
      const batch = ((listed.cursor as BsonDoc | undefined)?.firstBatch ?? []) as BsonDoc[]
      // Sizes and usage need extra privileges; the list still renders without them.
      const [stats, usage] = await Promise.all([
        runMongo({ operation: 'aggregate', database: db, collection, pipeline: [{ $collStats: { storageStats: {} } }, { $project: { 'storageStats.indexSizes': 1 } }], canonical: true }).catch(() => null),
        runMongo({ operation: 'aggregate', database: db, collection, pipeline: [{ $indexStats: {} }], canonical: true }).catch(() => null),
      ])
      const sizes = ((stats ? firstDocument(stats).storageStats : undefined) as BsonDoc | undefined)?.indexSizes as BsonDoc | undefined
      const usageByName = new Map(((usage?.documents ?? []) as BsonDoc[]).map((u) => [String(u.name), u.accesses as BsonDoc]))
      setIndexes(batch.map((ix) => {
        const accesses = usageByName.get(String(ix.name))
        const since = (accesses?.since as BsonDoc | undefined)?.$date
        return {
          name: String(ix.name),
          key: (ix.key ?? {}) as BsonDoc,
          unique: ix.unique === true,
          sparse: ix.sparse === true,
          hidden: ix.hidden === true,
          ttl: numberValue(ix.expireAfterSeconds),
          partial: !!ix.partialFilterExpression,
          size: sizes ? numberValue(sizes[String(ix.name)]) : null,
          ops: accesses ? numberValue(accesses.ops) : null,
          since: since ? new Date(numberValue(since) ?? String(since)).toLocaleDateString() : '',
        }
      }))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setLoading(false)
    }
  }, [collection, db, runMongo])

  useEffect(() => { setIndexes(null); void load() }, [load])

  const drop = async (name: string) => {
    setError('')
    try {
      await runMongo({ operation: 'runCommand', database: db, command: { dropIndexes: collection, index: name } })
      setDropping('')
      await load()
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 flex-none items-center gap-2 border-b border-border-1 bg-surface-1 px-3">
        <button type="button" onClick={() => setCreating(true)} className={primaryButton}><Plus size={13} /> Create index</button>
        <button type="button" onClick={() => void load()} className={secondaryButton}><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh</button>
        {indexes && <span className="ml-auto text-[11px] text-text-3">{indexes.length} indexes</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <ErrorBox message={error} className="m-3" />
        {!indexes ? (
          loading ? <div className="grid h-40 place-items-center"><Loader2 size={16} className="animate-spin text-text-4" /></div> : null
        ) : indexes.length === 0 ? (
          <EmptyState title="No indexes" text="This collection has no indexes (views and time series may not expose them)." />
        ) : (
          <table className="w-full border-separate border-spacing-0 text-left">
            <thead className="sticky top-0 z-10 bg-surface-2">
              <tr className="text-[10.5px] uppercase tracking-wider text-text-3">
                {['Name & definition', 'Type', 'Size', 'Usage', 'Properties', ''].map((h) => <th key={h} className="h-8 border-b border-border-1 px-4 font-semibold">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {indexes.map((ix) => (
                <tr key={ix.name} className="group align-top hover:bg-surface-1">
                  <td className="border-b border-border-1 px-4 py-2.5">
                    <div className="flex items-center gap-1.5 font-mono text-[12px] font-semibold text-text-1"><KeyRound size={12} className="text-text-4" />{ix.name}</div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {Object.entries(ix.key).map(([field, dir]) => (
                        <span key={field} className="rounded border border-border-2 bg-surface-2 px-1.5 py-px font-mono text-[10.5px] text-text-2">
                          {field} <span className="text-accent">{keyLabel(dir)}</span>
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="border-b border-border-1 px-4 py-2.5 text-[11.5px] text-text-2">{indexType(ix.key)}</td>
                  <td className="border-b border-border-1 px-4 py-2.5 font-mono text-[11.5px] tabular-nums text-text-2">{ix.size == null ? '—' : formatBytes(ix.size)}</td>
                  <td className="border-b border-border-1 px-4 py-2.5 text-[11.5px] text-text-2">
                    {ix.ops == null ? '—' : <><span className="tabular-nums">{ix.ops.toLocaleString()}</span> ops{ix.since && <div className="text-[10px] text-text-4">since {ix.since}</div>}</>}
                  </td>
                  <td className="border-b border-border-1 px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {ix.unique && <Badge>unique</Badge>}
                      {ix.sparse && <Badge>sparse</Badge>}
                      {ix.partial && <Badge>partial</Badge>}
                      {ix.hidden && <Badge>hidden</Badge>}
                      {ix.ttl != null && <Badge>TTL {ix.ttl}s</Badge>}
                    </div>
                  </td>
                  <td className="border-b border-border-1 px-4 py-2 text-right">
                    {ix.name !== '_id_' && (dropping === ix.name ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-[11px] text-error">Drop?</span>
                        <button type="button" onClick={() => setDropping('')} className="h-7 rounded-md border border-border-2 px-2 text-[11px] text-text-2 hover:bg-surface-3">Cancel</button>
                        <button type="button" onClick={() => void drop(ix.name)} className="h-7 rounded-md bg-error px-2 text-[11px] font-semibold text-white hover:opacity-90">Drop</button>
                      </span>
                    ) : (
                      <button type="button" aria-label={`Drop index ${ix.name}`} title="Drop index" onClick={() => setDropping(ix.name)} className="grid h-7 w-7 place-items-center rounded-md text-text-4 opacity-0 hover:bg-surface-3 hover:text-error focus:opacity-100 group-hover:opacity-100"><Trash2 size={13} /></button>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {creating && <CreateIndexDialog runMongo={runMongo} db={db} collection={collection} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); void load() }} />}
    </div>
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-accent/12 px-1.5 py-px text-[10.5px] font-medium text-accent">{children}</span>
}

function keyLabel(dir: unknown): string {
  const n = numberValue(dir)
  if (n != null) return n < 0 ? '↓ desc' : '↑ asc'
  return String(dir)
}

function indexType(key: BsonDoc): string {
  const values = Object.values(key).map((v) => (numberValue(v) == null ? String(v) : ''))
  if (values.includes('text')) return 'Text'
  if (values.includes('2dsphere') || values.includes('2d')) return 'Geospatial'
  if (values.includes('hashed')) return 'Hashed'
  if (Object.keys(key).some((k) => k.includes('$**'))) return 'Wildcard'
  return Object.keys(key).length > 1 ? 'Compound' : 'Regular'
}

interface CreateIndexDialogProps {
  runMongo: RunMongo
  db: string
  collection: string
  onClose: () => void
  onCreated: () => void
}

function CreateIndexDialog({ runMongo, db, collection, onClose, onCreated }: CreateIndexDialogProps) {
  const [keys, setKeys] = useState<{ field: string; type: KeyType }[]>([{ field: '', type: '1' }])
  const [name, setName] = useState('')
  const [unique, setUnique] = useState(false)
  const [sparse, setSparse] = useState(false)
  const [ttl, setTtl] = useState('')
  const [partial, setPartial] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const validKeys = keys.filter((k) => k.field.trim())
  const generatedName = validKeys.map((k) => `${k.field.trim()}_${k.type}`).join('_')

  const submit = async () => {
    setError('')
    if (!validKeys.length) { setError('Add at least one field'); return }
    try {
      const key: BsonDoc = {}
      for (const k of validKeys) key[k.field.trim()] = k.type === '1' || k.type === '-1' ? Number(k.type) : k.type
      const spec: BsonDoc = { key, name: name.trim() || generatedName }
      if (unique) spec.unique = true
      if (sparse) spec.sparse = true
      if (ttl.trim()) spec.expireAfterSeconds = Number(ttl)
      const partialDoc = parseShellDoc(partial, 'Partial filter', null)
      if (partialDoc) spec.partialFilterExpression = partialDoc
      setBusy(true)
      await runMongo({ operation: 'runCommand', database: db, command: { createIndexes: collection, indexes: [spec] } })
      onCreated()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const setKey = (i: number, patch: Partial<{ field: string; type: KeyType }>) => setKeys(keys.map((k, idx) => (idx === i ? { ...k, ...patch } : k)))

  return (
    <div className="fixed inset-0 z-[260] grid place-items-center bg-black/55 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="create-index-title" className="w-full max-w-lg rounded-md border border-border-2 bg-surface-2 shadow-2xl">
        <div className="flex h-11 items-center gap-2 border-b border-border-1 px-3.5">
          <KeyRound size={14} className="text-accent" />
          <h3 id="create-index-title" className="text-[13px] font-semibold text-text-1">Create index on {collection}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto grid h-7 w-7 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1"><X size={14} /></button>
        </div>
        <div className="space-y-3 p-3.5">
          <div className="text-[11px] font-medium text-text-2">Fields</div>
          {keys.map((k, i) => (
            <div key={i} className="flex gap-2">
              <input autoFocus={i === 0} value={k.field} onChange={(e) => setKey(i, { field: e.target.value })} placeholder="field.path" aria-label={`Index field ${i + 1}`} className={cn(fieldInput, 'min-w-0 flex-1 font-mono')} />
              <select value={k.type} onChange={(e) => setKey(i, { type: e.target.value as KeyType })} aria-label={`Index type ${i + 1}`} className={cn(fieldInput, 'w-32')}>
                <option value="1">1 (asc)</option>
                <option value="-1">-1 (desc)</option>
                <option value="text">text</option>
                <option value="2dsphere">2dsphere</option>
                <option value="hashed">hashed</option>
              </select>
              <button type="button" onClick={() => setKeys(keys.filter((_, idx) => idx !== i))} disabled={keys.length === 1} aria-label="Remove field" className="grid h-8 w-8 place-items-center rounded-md text-text-4 hover:bg-surface-3 hover:text-text-1 disabled:opacity-30"><X size={13} /></button>
            </div>
          ))}
          <button type="button" onClick={() => setKeys([...keys, { field: '', type: '1' }])} className="flex items-center gap-1 text-[11.5px] font-medium text-accent hover:text-accent-light"><Plus size={12} /> Add field</button>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <label className="flex flex-col gap-1 text-[11px] text-text-2">Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder={generatedName || 'auto'} className={cn(fieldInput, 'font-mono')} /></label>
            <label className="flex flex-col gap-1 text-[11px] text-text-2">TTL (seconds)<input value={ttl} onChange={(e) => setTtl(e.target.value.replace(/\D/g, ''))} placeholder="none" className={cn(fieldInput, 'font-mono')} /></label>
          </div>
          <label className="flex flex-col gap-1 text-[11px] text-text-2">Partial filter expression<input value={partial} onChange={(e) => setPartial(e.target.value)} placeholder="{ status: 'active' }" className={cn(fieldInput, 'font-mono')} /></label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-[11.5px] text-text-2"><input type="checkbox" checked={unique} onChange={(e) => setUnique(e.target.checked)} className="accent-accent" /> Unique</label>
            <label className="flex items-center gap-2 text-[11.5px] text-text-2"><input type="checkbox" checked={sparse} onChange={(e) => setSparse(e.target.checked)} className="accent-accent" /> Sparse</label>
          </div>
          <ErrorBox message={error} />
        </div>
        <div className="flex justify-end gap-2 border-t border-border-1 px-3.5 py-3">
          <button type="button" onClick={onClose} className={secondaryButton}>Cancel</button>
          <button type="button" onClick={() => void submit()} disabled={busy || !validKeys.length} className={primaryButton}>{busy && <Loader2 size={12} className="animate-spin" />} Create index</button>
        </div>
      </div>
    </div>
  )
}
