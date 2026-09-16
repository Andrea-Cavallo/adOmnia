import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Check, Code2, Copy, Eye, EyeOff, Loader2, Play, Plus, Trash2, Workflow } from 'lucide-react'
import { confirm } from '@/lib/confirmDialog'
import { cn } from '@/lib/utils'
import { parseShellDoc, type BsonDoc } from './bson'
import { DocumentCard } from './DocumentCard'
import type { RunMongo } from './useMongoBrowser'
import { EmptyState, ErrorBox, errorText, fieldInput, primaryButton, secondaryButton } from './ui'

export const STAGE_OPERATORS = [
  '$match', '$project', '$addFields', '$set', '$group', '$sort', '$limit', '$skip', '$unwind', '$lookup',
  '$count', '$facet', '$bucket', '$sortByCount', '$replaceRoot', '$unset', '$sample', '$out', '$merge',
] as const

const STAGE_TEMPLATES: Record<string, string> = {
  $match: '{ }',
  $project: '{ _id: 0, name: 1 }',
  $addFields: '{ newField: 1 }',
  $set: '{ newField: 1 }',
  $group: '{ _id: "$field", count: { $sum: 1 } }',
  $sort: '{ _id: -1 }',
  $limit: '10',
  $skip: '0',
  $unwind: '"$arrayField"',
  $lookup: '{ from: "other", localField: "otherId", foreignField: "_id", as: "other" }',
  $count: '"total"',
  $facet: '{ byType: [{ $sortByCount: "$type" }] }',
  $bucket: '{ groupBy: "$price", boundaries: [0, 100, 1000], default: "other" }',
  $sortByCount: '"$field"',
  $replaceRoot: '{ newRoot: "$embedded" }',
  $unset: '"field"',
  $sample: '{ size: 20 }',
  $out: '"output_collection"',
  $merge: '{ into: "output_collection" }',
}

const WRITE_STAGES = new Set(['$out', '$merge'])
const PREVIEW_DOCS = 10
const RESULT_CAP = 1000

interface Stage {
  id: string
  operator: string
  body: string
  enabled: boolean
}

interface AggregationsTabProps {
  runMongo: RunMongo
  db: string
  collection: string
  onExportCode: (pipeline: BsonDoc[]) => void
}

const newStage = (operator = '$match'): Stage => ({ id: crypto.randomUUID(), operator, body: STAGE_TEMPLATES[operator] ?? '{ }', enabled: true })

/** Parses a stage body: scalars ("$field", 10) are allowed for stages like $unwind or $limit. */
function parseStageBody(stage: Stage): unknown {
  const text = stage.body.trim()
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text)
  if (/^(["']).*\1$/s.test(text)) return text.slice(1, -1)
  const doc = parseShellDoc(`{ v: ${text} }`, stage.operator)
  return doc?.v
}

export function buildPipeline(stages: Stage[]): BsonDoc[] {
  return stages.filter((s) => s.enabled).map((s) => ({ [s.operator]: parseStageBody(s) }))
}

export function AggregationsTab({ runMongo, db, collection, onExportCode }: AggregationsTabProps) {
  const [stages, setStages] = useState<Stage[]>([newStage('$match')])
  const [previews, setPreviews] = useState<Record<string, { docs: BsonDoc[]; error: string; loading: boolean }>>({})
  const [results, setResults] = useState<BsonDoc[] | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const previewSeq = useRef(0)

  // Debounced per-stage previews: each stage shows the output of the pipeline up to itself.
  useEffect(() => {
    const seq = ++previewSeq.current
    const timer = window.setTimeout(() => {
      stages.forEach((stage, index) => {
        if (!stage.enabled) return
        const upTo = stages.slice(0, index + 1)
        if (upTo.some((s) => s.enabled && WRITE_STAGES.has(s.operator))) {
          setPreviews((p) => ({ ...p, [stage.id]: { docs: [], error: 'Preview disabled for $out / $merge (it would write data).', loading: false } }))
          return
        }
        let pipeline: BsonDoc[]
        try {
          pipeline = [...buildPipeline(upTo), { $limit: PREVIEW_DOCS }]
        } catch (e) {
          setPreviews((p) => ({ ...p, [stage.id]: { docs: [], error: errorText(e), loading: false } }))
          return
        }
        setPreviews((p) => ({ ...p, [stage.id]: { docs: p[stage.id]?.docs ?? [], error: '', loading: true } }))
        runMongo({ operation: 'aggregate', database: db, collection, pipeline, canonical: true })
          .then((r) => { if (seq === previewSeq.current) setPreviews((p) => ({ ...p, [stage.id]: { docs: (r.documents ?? []) as BsonDoc[], error: '', loading: false } })) })
          .catch((e) => { if (seq === previewSeq.current) setPreviews((p) => ({ ...p, [stage.id]: { docs: [], error: errorText(e), loading: false } })) })
      })
    }, 600)
    return () => window.clearTimeout(timer)
  }, [collection, db, runMongo, stages])

  const update = (id: string, patch: Partial<Stage>) => setStages((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  const move = (index: number, delta: number) => setStages((prev) => {
    const next = [...prev]
    const [item] = next.splice(index, 1)
    next.splice(index + delta, 0, item)
    return next
  })

  const run = async () => {
    setError('')
    let pipeline: BsonDoc[]
    try { pipeline = buildPipeline(stages) } catch (e) { setError(errorText(e)); return }
    if (!pipeline.length) { setError('Enable at least one stage'); return }
    if (stages.some((s) => s.enabled && WRITE_STAGES.has(s.operator))) {
      const ok = await confirm({ title: 'Run write pipeline', message: 'This pipeline contains $out or $merge and will write to a collection. Continue?', confirmLabel: 'Run pipeline', variant: 'danger' })
      if (!ok) return
    }
    setRunning(true)
    try {
      // Cap what comes back to the UI; write stages must stay last, so they run uncapped.
      const writes = stages.some((s) => s.enabled && WRITE_STAGES.has(s.operator))
      const r = await runMongo({ operation: 'aggregate', database: db, collection, pipeline: writes ? pipeline : [...pipeline, { $limit: RESULT_CAP }], canonical: true })
      setResults((r.documents ?? []) as BsonDoc[])
    } catch (e) {
      setError(errorText(e))
    } finally {
      setRunning(false)
    }
  }

  const copyPipeline = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(buildPipeline(stages), null, 2))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 flex-none items-center gap-2 border-b border-border-1 bg-surface-1 px-3">
        <button type="button" onClick={() => void run()} disabled={running} className={primaryButton}>
          {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={11} fill="currentColor" />} Run pipeline
        </button>
        <button type="button" onClick={() => setStages([...stages, newStage('$project')])} className={secondaryButton}><Plus size={13} /> Add stage</button>
        <button type="button" onClick={() => void copyPipeline()} className={secondaryButton}>{copied ? <Check size={12} className="text-success" /> : <Copy size={12} />} Copy pipeline</button>
        <button type="button" onClick={() => { try { onExportCode(buildPipeline(stages)) } catch (e) { setError(errorText(e)) } }} className={secondaryButton}><Code2 size={12} /> To code</button>
        <span className="ml-auto text-[11px] text-text-3">{stages.filter((s) => s.enabled).length} of {stages.length} stages enabled · previews show {PREVIEW_DOCS} docs</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <ErrorBox message={error} className="mb-3" />
        <div className="space-y-3">
          {stages.map((stage, index) => {
            const preview = previews[stage.id]
            return (
              <div key={stage.id} className={cn('grid grid-cols-[minmax(320px,0.9fr)_minmax(0,1.1fr)] overflow-hidden rounded-md border bg-surface-1', stage.enabled ? 'border-border-1' : 'border-dashed border-border-2 opacity-60')}>
                <div className="flex min-w-0 flex-col border-r border-border-1">
                  <div className="flex h-10 items-center gap-1.5 border-b border-border-1 px-2.5">
                    <span className="grid h-5 w-5 place-items-center rounded bg-surface-3 text-[10px] font-semibold tabular-nums text-text-2">{index + 1}</span>
                    <select
                      value={stage.operator}
                      aria-label={`Stage ${index + 1} operator`}
                      onChange={(e) => update(stage.id, { operator: e.target.value, body: STAGE_TEMPLATES[e.target.value] ?? stage.body })}
                      className={cn(fieldInput, 'h-7 font-mono text-[11.5px]')}
                    >
                      {STAGE_OPERATORS.map((op) => <option key={op} value={op}>{op}</option>)}
                    </select>
                    <div className="ml-auto flex items-center">
                      <IconButton label={stage.enabled ? 'Disable stage' : 'Enable stage'} onClick={() => update(stage.id, { enabled: !stage.enabled })}>{stage.enabled ? <Eye size={13} /> : <EyeOff size={13} />}</IconButton>
                      <IconButton label="Move stage up" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={13} /></IconButton>
                      <IconButton label="Move stage down" disabled={index === stages.length - 1} onClick={() => move(index, 1)}><ArrowDown size={13} /></IconButton>
                      <IconButton label="Delete stage" disabled={stages.length === 1} onClick={() => setStages(stages.filter((s) => s.id !== stage.id))}><Trash2 size={13} /></IconButton>
                    </div>
                  </div>
                  <textarea
                    value={stage.body}
                    spellCheck={false}
                    aria-label={`Stage ${index + 1} body`}
                    onChange={(e) => update(stage.id, { body: e.target.value })}
                    rows={Math.min(14, Math.max(4, stage.body.split('\n').length + 1))}
                    className="w-full flex-1 resize-y bg-surface-0 px-3 py-2 font-mono text-[11.5px] leading-5 text-text-1 outline-none"
                  />
                </div>
                <div className="flex min-w-0 flex-col">
                  <div className="flex h-10 flex-none items-center gap-2 border-b border-border-1 px-3 text-[11px] text-text-3">
                    Output after <span className="font-mono text-text-2">{stage.operator}</span>
                    {preview?.loading && <Loader2 size={12} className="animate-spin" />}
                    {!preview?.loading && preview && !preview.error && <span className="text-text-4">· {preview.docs.length} sample docs</span>}
                  </div>
                  <div className="max-h-72 min-h-[96px] overflow-auto p-2">
                    {!stage.enabled ? (
                      <div className="p-2 text-[11px] text-text-4">Stage disabled</div>
                    ) : preview?.error ? (
                      <div className="p-2 font-mono text-[11px] text-error">{preview.error}</div>
                    ) : preview && preview.docs.length === 0 && !preview.loading ? (
                      <div className="p-2 text-[11px] text-text-4">No documents</div>
                    ) : (
                      <div className="flex gap-2 overflow-x-auto">
                        {(preview?.docs ?? []).map((doc, i) => <div key={i} className="w-[280px] flex-none"><DocumentCard doc={doc} /></div>)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {results && (
          <div className="mt-5">
            <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-text-1"><Workflow size={14} className="text-accent" /> Pipeline results <span className="font-normal text-text-3">{results.length} documents{results.length === RESULT_CAP ? ` (first ${RESULT_CAP})` : ''}</span></div>
            {results.length === 0
              ? <EmptyState title="No results" text="The pipeline returned no documents." />
              : <div className="space-y-2">{results.map((doc, i) => <DocumentCard key={i} doc={doc} />)}</div>}
          </div>
        )}
      </div>
    </div>
  )
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className="grid h-7 w-7 place-items-center rounded-md text-text-3 hover:bg-surface-3 hover:text-text-1 disabled:opacity-30">
      {children}
    </button>
  )
}
