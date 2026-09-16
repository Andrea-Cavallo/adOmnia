import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Gauge, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { highlightedJson } from '../dbShared'
import { toEditable, type BsonDoc } from './bson'
import { summarizeExplain, type ExplainSummary, type PlanStage } from './explain'
import type { RunMongo } from './useMongoBrowser'
import { ErrorBox, errorText, firstDocument } from './ui'

interface ExplainDialogProps {
  runMongo: RunMongo
  db: string
  command: BsonDoc
  onClose: () => void
}

export function ExplainDialog({ runMongo, db, command, onClose }: ExplainDialogProps) {
  const [raw, setRaw] = useState<BsonDoc | null>(null)
  const [summary, setSummary] = useState<ExplainSummary | null>(null)
  const [error, setError] = useState('')
  const [showRaw, setShowRaw] = useState(false)

  useEffect(() => {
    let alive = true
    runMongo({ operation: 'runCommand', database: db, command: { explain: command, verbosity: 'executionStats' }, canonical: true })
      .then((r) => {
        if (!alive) return
        const doc = firstDocument(r)
        setRaw(doc)
        setSummary(summarizeExplain(doc))
      })
      .catch((e) => { if (alive) setError(errorText(e)) })
    return () => { alive = false }
  }, [command, db, runMongo])

  const examinedRatio = summary && summary.nReturned ? (summary.totalDocsExamined ?? 0) / summary.nReturned : null

  return (
    <div className="fixed inset-0 z-[260] grid place-items-center bg-black/55 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="explain-title" className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-md border border-border-2 bg-surface-2 shadow-2xl">
        <div className="flex h-11 flex-none items-center gap-2 border-b border-border-1 px-3.5">
          <Gauge size={14} className="text-accent" />
          <h3 id="explain-title" className="text-[13px] font-semibold text-text-1">Explain plan</h3>
          <button type="button" onClick={() => setShowRaw((v) => !v)} disabled={!raw} className="ml-auto h-7 rounded-md px-2 text-[11.5px] text-text-3 hover:bg-surface-3 hover:text-text-1 disabled:opacity-40">{showRaw ? 'Visual' : 'Raw output'}</button>
          <button type="button" onClick={onClose} aria-label="Close explain plan" className="grid h-7 w-7 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1"><X size={14} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <ErrorBox message={error} />
          {!summary && !error && <div className="grid h-40 place-items-center"><Loader2 size={16} className="animate-spin text-text-4" /></div>}
          {summary && showRaw && raw && <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-5">{highlightedJson(JSON.stringify(toEditable(raw), null, 2))}</pre>}
          {summary && !showRaw && (
            <div className="space-y-4">
              <div className={cn('flex items-center gap-2 rounded-md border px-3 py-2 text-[12px]', summary.collectionScan ? 'border-warning/40 bg-warning/10 text-warning' : 'border-success/40 bg-success/10 text-success')}>
                {summary.collectionScan ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
                {summary.collectionScan
                  ? 'Collection scan: no index supports this query. Consider creating one on the filtered/sorted fields.'
                  : `Query uses ${summary.indexesUsed.length ? summary.indexesUsed.join(', ') : 'an index'}.`}
              </div>
              <div className="grid grid-cols-4 gap-2">
                <Stat label="Returned" value={summary.nReturned} />
                <Stat label="Docs examined" value={summary.totalDocsExamined} warn={examinedRatio != null && examinedRatio > 10} />
                <Stat label="Keys examined" value={summary.totalKeysExamined} />
                <Stat label="Execution" value={summary.executionTimeMillis} suffix=" ms" />
              </div>
              {summary.inMemorySort && <div className="text-[11.5px] text-warning">In-memory SORT stage: an index matching the sort would avoid it.</div>}
              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-3">Winning plan</div>
                {summary.plan ? <StageNode stage={summary.plan} /> : <div className="text-[11.5px] text-text-4">No plan returned</div>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, suffix = '', warn }: { label: string; value: number | null; suffix?: string; warn?: boolean }) {
  return (
    <div className="rounded-md border border-border-1 bg-surface-1 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-text-4">{label}</div>
      <div className={cn('mt-0.5 text-[15px] font-semibold tabular-nums', warn ? 'text-warning' : 'text-text-1')}>{value == null ? '—' : `${value.toLocaleString()}${suffix}`}</div>
    </div>
  )
}

function StageNode({ stage }: { stage: PlanStage }) {
  return (
    <div className="flex flex-col items-start">
      <div className={cn('rounded-md border px-2.5 py-1.5 font-mono text-[11.5px]', stage.stage === 'COLLSCAN' ? 'border-warning/50 text-warning' : stage.indexName ? 'border-success/50 text-success' : 'border-border-2 text-text-1')}>
        {stage.stage}
        {stage.indexName && <span className="ml-2 text-text-3">{stage.indexName}</span>}
      </div>
      {stage.children.length > 0 && (
        <div className="ml-4 border-l border-border-2 pl-4 pt-2">
          {stage.children.map((child, i) => <StageNode key={i} stage={child} />)}
        </div>
      )}
    </div>
  )
}
