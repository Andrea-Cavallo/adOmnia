import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import type { LoadTestResult, LoadTestTimelinePoint } from '@/lib/loadtest-api'

export function LoadTestInspector({ result }: { result: Pick<LoadTestResult, 'timeline' | 'timelineTruncated' | 'distribution'> }) {
  const [view, setView] = useState<'samples' | 'distribution'>('samples')
  const [query, setQuery] = useState('')
  const [errorsOnly, setErrorsOnly] = useState(false)
  const [sort, setSort] = useState<'time' | 'latency'>('time')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<LoadTestTimelinePoint | null>(null)
  const rows = useMemo(() => (result.timeline ?? [])
    .map((sample, index) => ({ sample, index }))
    .filter(({ sample }) => (!errorsOnly || !sample.ok) && `${sample.step ?? ''} ${sample.status} ${sample.error ?? ''}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => sort === 'latency' ? b.sample.latencyMs - a.sample.latencyMs : (a.sample.startMs ?? a.sample.timeMs) - (b.sample.startMs ?? b.sample.timeMs)), [result, errorsOnly, query, sort])
  const pages = Math.max(1, Math.ceil(rows.length / 50))
  const currentPage = Math.min(page, pages - 1)
  return (
    <section className="ltd-section ltd-inspector" aria-label="Result inspector">
      <div className="ltd-inspector-tabs" role="group" aria-label="Inspect results">
        <button type="button" aria-pressed={view === 'samples'} onClick={() => setView('samples')}>Request samples <span>{result.timeline?.length ?? 0}</span></button>
        <button type="button" aria-pressed={view === 'distribution'} onClick={() => setView('distribution')}>Latency distribution</button>
      </div>
      {view === 'samples' ? <>
        <div className="ltd-inspector-tools">
          <label className="ltd-search"><Search size={14} /><input aria-label="Search request samples" placeholder="Search step, status or error…" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} /></label>
          <label className="ltd-check"><input type="checkbox" checked={errorsOnly} onChange={(event) => { setErrorsOnly(event.target.checked); setPage(0) }} /> Errors only</label>
          <select className="ltd-text" aria-label="Sort samples" value={sort} onChange={(event) => { setSort(event.target.value as typeof sort); setPage(0) }}><option value="time">Start time</option><option value="latency">Slowest first</option></select>
        </div>
        {result.timelineTruncated && <p className="ltd-hint">The sample log is capped. Aggregate statistics include all measured requests.</p>}
        <div className="ltd-table-scroll"><table className="ltd-table"><thead><tr><th>Sample / step</th><th>VU</th><th>Start</th><th>Latency</th><th>Status</th><th>Result</th></tr></thead><tbody>
          {rows.slice(currentPage * 50, currentPage * 50 + 50).map(({ sample, index }) => <tr key={index}>
            <td><button type="button" className="ltd-sample-link" onClick={() => setSelected(sample)}>#{index + 1} {sample.step ?? 'HTTP request'}</button></td>
            <td>{sample.vu ?? '—'}</td><td>{(sample.startMs ?? sample.timeMs).toFixed(0)} ms</td><td>{sample.latencyMs.toFixed(1)} ms</td><td>{sample.status || 'ERR'}</td><td data-error={!sample.ok}>{sample.ok ? 'Passed' : 'Failed'}</td>
          </tr>)}
        </tbody></table></div>
        {!rows.length && <p className="ltd-empty">{result.timeline?.length ? 'No samples match these filters.' : 'No request samples were recorded for this run.'}</p>}
        <div className="ltd-pagination"><span>{rows.length} matching samples · page {currentPage + 1} / {pages}</span><button type="button" className="ltd-icon" aria-label="Previous sample page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></button><button type="button" className="ltd-icon" aria-label="Next sample page" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></button></div>
        {selected && <div className="ltd-sample-detail"><div className="ltd-row"><strong>{selected.step ?? 'HTTP request'} · {selected.ok ? 'Passed' : 'Failed'}</strong><button type="button" className="ltd-btn" onClick={() => setSelected(null)}>Close details</button></div><dl><dt>Status</dt><dd>{selected.status || 'No response'}</dd><dt>Latency</dt><dd>{selected.latencyMs.toFixed(2)} ms</dd><dt>Iteration / VU</dt><dd>{selected.iteration ?? '—'} / {selected.vu ?? '—'}</dd><dt>Received</dt><dd>{selected.bytes ?? 0} bytes</dd><dt>Measurement</dt><dd>{selected.measured === false ? 'Excluded warm-up' : 'Measured'}</dd>{selected.error && <><dt>Error</dt><dd>{selected.error}</dd></>}</dl></div>}
      </> : <div className="ltd-distribution">{result.distribution?.length ? result.distribution.map((bin, index) => <div className="ltd-distribution-row" key={index}><span>{bin.fromMs}–{bin.overflow ? '∞' : bin.toMs} ms</span><div><i style={{ width: `${Math.max(0, Math.min(100, bin.percentage))}%` }} /></div><span>{bin.count} · {bin.percentage.toFixed(1)}%</span></div>) : <p className="ltd-empty">This run has no latency histogram. Run a new test to collect one.</p>}</div>}
    </section>
  )
}
