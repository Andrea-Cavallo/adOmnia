import { useState } from 'react'
import { Loader2, ScanSearch } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BsonDoc, BsonKind } from './bson'
import { analyzeSchema, type SchemaField } from './schema'
import type { RunMongo } from './useMongoBrowser'
import { EmptyState, ErrorBox, errorText, fieldInput, primaryButton } from './ui'

const KIND_BAR: Partial<Record<BsonKind, string>> = {
  String: 'bg-success',
  Int32: 'bg-warning',
  Int64: 'bg-warning',
  Double: 'bg-warning',
  Decimal128: 'bg-warning',
  ObjectId: 'bg-accent',
  Date: 'bg-info',
  Boolean: 'bg-json-bool',
  Object: 'bg-text-3',
  Array: 'bg-text-2',
  Null: 'bg-text-4',
}

interface SchemaTabProps {
  runMongo: RunMongo
  db: string
  collection: string
  /** Current documents filter so the sample matches what the user is looking at. */
  filter: BsonDoc | null
  onUseField: (path: string) => void
}

export function SchemaTab({ runMongo, db, collection, filter, onUseField }: SchemaTabProps) {
  const [size, setSize] = useState('1000')
  const [fields, setFields] = useState<SchemaField[] | null>(null)
  const [sampled, setSampled] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const analyze = async () => {
    setLoading(true)
    setError('')
    try {
      const n = Math.min(10000, Math.max(1, Number(size) || 1000))
      const pipeline = [...(filter && Object.keys(filter).length ? [{ $match: filter }] : []), { $sample: { size: n } }]
      const result = await runMongo({ operation: 'aggregate', database: db, collection, pipeline, canonical: true })
      const docs = (result.documents ?? []) as BsonDoc[]
      setSampled(docs.length)
      setFields(analyzeSchema(docs))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 flex-none items-center gap-2 border-b border-border-1 bg-surface-1 px-3">
        <span className="text-[11.5px] text-text-3">Sample size</span>
        <input value={size} onChange={(e) => setSize(e.target.value.replace(/\D/g, ''))} className={cn(fieldInput, 'w-20 font-mono')} aria-label="Sample size" />
        <button type="button" onClick={() => void analyze()} disabled={loading} className={primaryButton}>
          {loading ? <Loader2 size={13} className="animate-spin" /> : <ScanSearch size={13} />} Analyze schema
        </button>
        {fields && <span className="ml-auto text-[11px] text-text-3">{fields.length} fields · {sampled.toLocaleString()} documents sampled{filter && Object.keys(filter).length ? ' · filtered' : ''}</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <ErrorBox message={error} className="m-3" />
        {!fields ? (
          <EmptyState title="Schema analysis" text="Samples documents and shows every field, its types and how often it appears. Uses the filter from the Documents tab." />
        ) : fields.length === 0 ? (
          <EmptyState title="No documents sampled" text="The collection is empty or the filter matches nothing." />
        ) : (
          <div className="divide-y divide-border-1">
            {fields.map((field) => <SchemaRow key={field.path} field={field} onUseField={onUseField} />)}
          </div>
        )}
      </div>
    </div>
  )
}

function SchemaRow({ field, onUseField }: { field: SchemaField; onUseField: (path: string) => void }) {
  const name = field.path.split('.').pop() ?? field.path
  const totalTyped = field.types.reduce((sum, t) => sum + t.count, 0) || 1
  const pct = Math.round(field.probability * 100)
  return (
    <div className="grid grid-cols-[minmax(180px,1.1fr)_minmax(220px,1.4fr)_minmax(160px,1fr)] items-start gap-4 px-4 py-2.5 hover:bg-surface-1">
      <div className="min-w-0" style={{ paddingLeft: field.depth * 14 }}>
        <button type="button" onClick={() => onUseField(field.path)} title="Filter on this field" className="max-w-full truncate font-mono text-[12px] font-semibold text-text-1 hover:text-accent">{name}</button>
        {field.depth > 0 && <div className="truncate font-mono text-[10px] text-text-4">{field.path}</div>}
        <div className="mt-1 flex items-center gap-2">
          <div className="h-1 w-16 overflow-hidden rounded-full bg-surface-3"><div className="h-full bg-accent" style={{ width: `${pct}%` }} /></div>
          <span className={cn('text-[10px] tabular-nums', pct < 100 ? 'text-warning' : 'text-text-4')}>{pct}% present</span>
        </div>
      </div>
      <div className="min-w-0">
        <div className="flex h-2 overflow-hidden rounded-full bg-surface-3">
          {field.types.map((t) => (
            <div key={t.kind} title={`${t.kind} ${Math.round((t.count / totalTyped) * 100)}%`} className={KIND_BAR[t.kind] ?? 'bg-text-4'} style={{ width: `${(t.count / totalTyped) * 100}%` }} />
          ))}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
          {field.types.map((t) => (
            <span key={t.kind} className="flex items-center gap-1 text-[10.5px] text-text-2">
              <span className={cn('h-1.5 w-1.5 rounded-full', KIND_BAR[t.kind] ?? 'bg-text-4')} />
              {t.kind} <span className="tabular-nums text-text-4">{Math.round((t.count / totalTyped) * 100)}%</span>
            </span>
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap gap-1">
        {field.samples.map((sample) => (
          <span key={sample} title={sample} className="max-w-[180px] truncate rounded border border-border-1 bg-surface-2 px-1.5 py-px font-mono text-[10.5px] text-text-2">{sample}</span>
        ))}
      </div>
    </div>
  )
}
