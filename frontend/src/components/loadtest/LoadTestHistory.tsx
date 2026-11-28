import { useEffect, useState } from 'react'
import { GitCompare, Trash2, RefreshCw } from 'lucide-react'
import { compareRuns, deleteRun, listRuns, loadRun, type LoadTestComparison, type LoadTestResult, type LoadTestRunSummary } from '@/lib/loadtest-api'

interface LoadTestHistoryProps {
  /** Bump to reload the list (a run just finished). */
  refreshKey?: number
  /** Only the runs of this target (e.g. "GET https://…" or a flow name); empty = all. */
  targetLabel?: string
  /** Show a saved run in the caller's result view. */
  onOpen?: (result: LoadTestResult, summary: LoadTestRunSummary) => void
  disabled?: boolean
}

const when = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

/**
 * The run history (every finished run, kept in bbolt by the engine) with a comparison of any
 * two runs: pick a base, then a run to compare it with.
 */
export function LoadTestHistory({ refreshKey = 0, targetLabel, onOpen, disabled }: LoadTestHistoryProps) {
  const [runs, setRuns] = useState<LoadTestRunSummary[]>([])
  const [error, setError] = useState('')
  const [baseId, setBaseId] = useState('')
  const [comparison, setComparison] = useState<{ base: LoadTestRunSummary; head: LoadTestRunSummary; result: LoadTestComparison } | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let alive = true
    listRuns().then((all) => { if (alive) { setRuns(all); setError('') } }, (e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [refreshKey, reload])

  const shown = targetLabel ? runs.filter((run) => run.targetLabel === targetLabel || run.name === targetLabel) : runs
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e))

  const open = async (run: LoadTestRunSummary) => {
    try { onOpen?.(await loadRun(run.id), run) } catch (e) { fail(e) }
  }
  const remove = async (run: LoadTestRunSummary) => {
    try {
      await deleteRun(run.id)
      if (baseId === run.id) setBaseId('')
      setReload((n) => n + 1)
    } catch (e) { fail(e) }
  }
  const compareWith = async (head: LoadTestRunSummary) => {
    const base = runs.find((run) => run.id === baseId)
    if (!base) return
    try { setComparison({ base, head, result: await compareRuns(base.id, head.id) }) } catch (e) { fail(e) }
  }

  return (
    <details className="ltd-section ltd-details" open={shown.length > 0 && shown.length <= 5}>
      <summary className="ltd-section-head">Run history ({shown.length})</summary>
      <div className="ltd-row" style={{ justifyContent: 'space-between' }}>
        <span className="ltd-hint">{baseId ? 'Now pick the run to compare with the base.' : 'Every finished run is kept here (last 200). Set a base, then compare any other run with it.'}</span>
        <button type="button" className="ltd-icon" onClick={() => setReload((n) => n + 1)} aria-label="Reload run history"><RefreshCw size={12} /></button>
      </div>
      {error && <div className="ltd-note" data-tone="error">{error}</div>}
      {shown.map((run) => (
        <div key={run.id} className="ltd-saved" data-base={run.id === baseId}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={run.targetLabel}>
              {run.name || run.targetLabel || 'Run'} <span style={{ color: 'var(--color-text-4)' }}>· {when(run.startedAt)}</span>
            </div>
            <div style={{ color: 'var(--color-text-4)', fontFamily: 'var(--font-mono)' }}>
              {run.target || 'run'} · {run.requests} req · p95 {run.p95Ms.toFixed(1)}ms · {run.errorRate.toFixed(1)}% err · {run.throughput.toFixed(1)}/s
              {run.gateFailures?.length ? <span style={{ color: 'var(--color-error)' }}> · gates failed</span> : null}
              {run.abortReason ? <span style={{ color: 'var(--color-warning)' }}> · stopped by a gate</span> : run.aborted ? <span style={{ color: 'var(--color-warning)' }}> · stopped</span> : null}
              {run.imported ? ' · imported' : ''}
            </div>
          </div>
          {onOpen && <button type="button" className="ltd-btn" disabled={disabled} onClick={() => void open(run)}>Open</button>}
          {baseId && baseId !== run.id
            ? <button type="button" className="ltd-btn" onClick={() => void compareWith(run)}><GitCompare size={12} /> Compare</button>
            : <button type="button" className="ltd-btn" aria-pressed={run.id === baseId} onClick={() => { setBaseId(run.id === baseId ? '' : run.id); setComparison(null) }}>{run.id === baseId ? 'Base ✓' : 'Set base'}</button>}
          <button type="button" className="ltd-icon" onClick={() => void remove(run)} aria-label={`Delete run ${run.name || run.id}`}><Trash2 size={12} /></button>
        </div>
      ))}
      {comparison && <ComparisonView base={comparison.base} head={comparison.head} comparison={comparison.result} />}
    </details>
  )
}

const LABELS: Record<string, string> = { p50Ms: 'p50', p95Ms: 'p95', p99Ms: 'p99', avgMs: 'avg', errorRate: 'errors', errorPct: 'errors', throughput: 'req/s' }
const unit = (metric: string) => (metric.endsWith('Ms') ? 'ms' : metric === 'throughput' ? '/s' : '%')

export function ComparisonView({ base, head, comparison }: { base?: LoadTestRunSummary; head?: LoadTestRunSummary; comparison: LoadTestComparison }) {
  return (
    <div className="ltd-section" aria-label="Run comparison">
      <div className="ltd-verdict" data-failed={comparison.regression}>
        <strong>{comparison.regression ? 'Regression' : 'No regression'} <span style={{ fontWeight: 400 }}>(tolerance {comparison.tolerancePct}%)</span></strong>
        {base && head && <p>{base.name || base.targetLabel} · {when(base.startedAt)} → {when(head.startedAt)}</p>}
        {comparison.reasons?.map((reason) => <p key={reason}>{reason}</p>)}
      </div>
      {comparison.warnings?.map((warning) => <div key={warning} className="ltd-note" data-tone="warn">{warning}</div>)}
      <div className="ltd-delta">
        {comparison.deltas.map((d) => (
          <div key={d.metric}>
            <div style={{ color: 'var(--color-text-4)' }}>{LABELS[d.metric] ?? d.metric}</div>
            <div data-bad={d.worse}>{d.base.toFixed(1)} → {d.head.toFixed(1)}{unit(d.metric)}</div>
            <div style={{ color: 'var(--color-text-4)' }}>{d.pct > 0 ? '+' : ''}{d.pct.toFixed(1)}%</div>
          </div>
        ))}
      </div>
      {(comparison.steps?.length ?? 0) > 0 && (
        <table className="ltd-compare-steps">
          <thead><tr><th>Step</th>{comparison.steps?.[0]?.deltas.map((d) => <th key={d.metric}>{LABELS[d.metric] ?? d.metric}</th>)}</tr></thead>
          <tbody>
            {comparison.steps?.map((step) => (
              <tr key={step.id}>
                <td>{step.step}</td>
                {step.deltas.map((d) => <td key={d.metric} data-bad={d.worse}>{d.base.toFixed(1)} → {d.head.toFixed(1)} <span>({d.pct > 0 ? '+' : ''}{d.pct.toFixed(0)}%)</span></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {(comparison.onlyInBase?.length || comparison.onlyInHead?.length) ? (
        <p className="ltd-hint">
          {comparison.onlyInBase?.length ? `Only in the base: ${comparison.onlyInBase.join(', ')}. ` : ''}
          {comparison.onlyInHead?.length ? `Only in the new run: ${comparison.onlyInHead.join(', ')}.` : ''}
        </p>
      ) : null}
    </div>
  )
}
