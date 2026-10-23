import { useState, useEffect, useRef } from 'react'
import { X, Download, FileJson, Trash2 } from 'lucide-react'
import type { RequestItem } from '@/lib/types'
import { useServerPort, serverUrl, sidecarFetch } from '@/lib/useServerPort'
import { substVars } from '@/lib/substVars'
import { useEnvironmentsStore } from '@/stores/environments'
import { useSettingsStore } from '@/stores/settings'
import { buildLoadPlan, type LoadMode } from './loadTestPlan'
import { PercentileRow, ThroughputChart, Waterfall, type LoadTestResult } from './loadTestParts'
import './loadTestDrawer.css'

interface SavedResultSummary {
  name: string
  timestamp: string
  url: string
  method: string
  avgMs: number
  p95Ms: number
  errorRate: number
  total: number
}

interface CompareResult {
  delta: { throughput: number; avgMs: number; p95Ms: number; errRate: number }
}

const MODE_HINT: Record<LoadMode, string> = {
  burst: 'Fires N copies of this request at the same instant, to see what happens when they race.',
  gap: 'Sends the same request a few times, each one starting a fixed gap after the previous (no waiting for the answer).',
  load: 'Classic load test: many requests with a concurrency limit, percentiles and throughput.',
}

interface LoadTestDrawerProps {
  request: RequestItem
  onClose: () => void
}

export function LoadTestDrawer({ request, onClose }: LoadTestDrawerProps) {
  const port = useServerPort()
  const getResolvedVars = useEnvironmentsStore((s) => s.getResolvedVars)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [mode, setMode] = useState<LoadMode>('burst')
  const [burst, setBurst] = useState(5)
  const [gapRequests, setGapRequests] = useState(2)
  const [gapMs, setGapMs] = useState(200)
  const [concurrency, setConcurrency] = useState(() => useSettingsStore.getState().settings.general.maxConcurrentRequests ?? 10)
  const [totalReqs, setTotalReqs] = useState(100)
  const [durationS, setDurationS] = useState(30)
  const [useDuration, setUseDuration] = useState(false)
  const [timeoutMs, setTimeoutMs] = useState(5000)
  const [warmupReqs, setWarmupReqs] = useState(5)

  const [result, setResult] = useState<LoadTestResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [scenarioName, setScenarioName] = useState('')
  const [scenarios, setScenarios] = useState<string[]>([])
  const [resultName, setResultName] = useState('')
  const [savedResults, setSavedResults] = useState<SavedResultSummary[]>([])
  const [baseline, setBaseline] = useState<LoadTestResult | null>(null)
  const [comparison, setComparison] = useState<CompareResult | null>(null)

  const vars = getResolvedVars()
  const resolvedUrl = substVars(request.url, vars)
  const unresolved = resolvedUrl.match(/\{\{[^}]+\}\}/)?.[0]
  const inputs = { concurrency, totalReqs, durationS, useDuration, warmupReqs, burst, gapRequests, gapMs }

  const callApi = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const url = serverUrl(port, path)
    if (!url) throw new Error('Backend not ready')
    const res = await sidecarFetch(url, init)
    const text = await res.text()
    if (!res.ok) throw new Error(text || res.statusText)
    return (text ? JSON.parse(text) : {}) as T
  }
  const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e))

  const loadCatalogs = async () => {
    if (!port) return
    try {
      const [scenarioData, resultData] = await Promise.all([
        callApi<{ scenarios?: string[] }>('/loadtest/scenario/list'),
        callApi<{ results?: SavedResultSummary[] }>('/loadtest/result/list'),
      ])
      setScenarios(scenarioData.scenarios ?? [])
      setSavedResults(resultData.results ?? [])
    } catch (e) { fail(e) }
  }
  useEffect(() => { void loadCatalogs() }, [port])

  const headersObj = () => Object.fromEntries(request.headers.filter((h) => h.enabled && h.key).map((h) => [h.key, substVars(h.value, vars)]))

  const saveScenario = async () => {
    if (!scenarioName.trim()) return
    try {
      const plan = buildLoadPlan('load', inputs)
      await callApi('/loadtest/scenario/save', post({ name: scenarioName.trim(), config: { url: resolvedUrl, method: request.method, timeoutMs, headers: headersObj(), totalReqs: 0, durationS: 0, ...plan } }))
      setScenarioName('')
      await loadCatalogs()
    } catch (e) { fail(e) }
  }

  const loadScenario = async (name: string) => {
    try {
      const data = await callApi<Record<string, unknown>>(`/loadtest/scenario/load?name=${encodeURIComponent(name)}`)
      setConcurrency(Number(data.concurrency ?? concurrency))
      setTotalReqs(Number(data.totalReqs ?? totalReqs))
      setDurationS(Number(data.durationS ?? durationS))
      setTimeoutMs(Number(data.timeoutMs ?? timeoutMs))
      setWarmupReqs(Number(data.warmupReqs ?? warmupReqs))
      setUseDuration(Number(data.durationS ?? 0) > 0 && Number(data.totalReqs ?? 0) === 0)
      setMode('load')
      setError('')
    } catch (e) { fail(e) }
  }

  const saveResult = async () => {
    if (!result || !resultName.trim()) return
    try {
      await callApi('/loadtest/result/save', post({ name: resultName.trim(), url: resolvedUrl, method: request.method, result }))
      setResultName('')
      await loadCatalogs()
    } catch (e) { fail(e) }
  }

  const loadSavedResult = async (name: string, asBaseline = false) => {
    try {
      const data = await callApi<{ result: LoadTestResult }>(`/loadtest/result/load?name=${encodeURIComponent(name)}`)
      if (asBaseline) setBaseline(data.result)
      else setResult(data.result)
      setComparison(null)
    } catch (e) { fail(e) }
  }

  const deleteSavedResult = async (name: string) => {
    try {
      await callApi(`/loadtest/result/delete?name=${encodeURIComponent(name)}`, { method: 'DELETE' })
      await loadCatalogs()
    } catch (e) { fail(e) }
  }

  const compareWithBaseline = async () => {
    if (!baseline || !result) return
    try { setComparison(await callApi<CompareResult>('/loadtest/compare', post({ left: baseline, right: result }))) } catch (e) { fail(e) }
  }

  const exportReport = async (format: 'md' | 'html') => {
    if (!result) return
    try {
      const url = serverUrl(port, `/loadtest/report?format=${format}`)
      if (!url) throw new Error('Backend not ready')
      const res = await sidecarFetch(url, post(result))
      const text = await res.text()
      if (!res.ok) throw new Error(text || res.statusText)
      triggerDownload(new Blob([text], { type: format === 'html' ? 'text/html' : 'text/markdown' }), `loadtest-${Date.now()}.${format}`)
    } catch (e) { fail(e) }
  }

  const handleRun = async () => {
    const apiUrl = serverUrl(port, '/loadtest')
    if (!apiUrl) { setError('Backend not ready'); return }
    if (!resolvedUrl) { setError('URL is empty'); return }
    setLoading(true); setError(''); setResult(null); setComparison(null)
    try {
      const activeBody = request.bodies[request.activeBodyIdx]
      const body = activeBody?.type !== 'none' ? activeBody?.raw : undefined
      const payload = { url: resolvedUrl, method: request.method, timeoutMs, headers: headersObj(), body: body || undefined, ...buildLoadPlan(mode, inputs) }
      const res = await sidecarFetch(apiUrl, post(payload))
      const text = await res.text()
      if (!res.ok) { setError(text || 'Load test failed'); return }
      setResult(JSON.parse(text))
    } catch (e) { fail(e) } finally { setLoading(false) }
  }

  const exportJson = () => {
    if (!result) return
    const payload = { request: { url: resolvedUrl, method: request.method }, config: { mode, ...buildLoadPlan(mode, inputs), timeoutMs }, result }
    triggerDownload(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `loadtest-${Date.now()}.json`)
  }

  const exportCsv = () => {
    if (!result) return
    const rows: [string, string | number][] = [
      ['url', resolvedUrl], ['method', request.method],
      ['total_requests', result.totalRequests], ['successful', result.successful], ['failed', result.failed],
      ['throughput_rps', result.throughput.toFixed(2)],
      ['avg_ms', result.avgMs.toFixed(2)], ['min_ms', result.minMs.toFixed(2)], ['max_ms', result.maxMs.toFixed(2)],
      ['p50_ms', result.p50Ms.toFixed(2)], ['p75_ms', result.p75Ms.toFixed(2)],
      ['p90_ms', result.p90Ms.toFixed(2)], ['p95_ms', result.p95Ms.toFixed(2)],
      ['p99_ms', result.p99Ms.toFixed(2)], ['p999_ms', result.p999Ms.toFixed(2)],
      ['error_rate_pct', result.errorRate.toFixed(2)],
    ]
    triggerDownload(new Blob([['metric,value', ...rows.map((r) => r.join(','))].join('\n')], { type: 'text/csv' }), `loadtest-${Date.now()}.csv`)
  }

  const maxP = result ? Math.max(result.p50Ms, result.p75Ms, result.p90Ms, result.p95Ms, result.p99Ms, result.p999Ms, 1) : 1
  const probe = mode !== 'load'
  const firstError = result?.timeline?.find((t) => t.error)?.error
  const numberField = (label: string, value: number, set: (n: number) => void, min = 1) => (
    <label className="ltd-field">
      <span className="ltd-label">{label}</span>
      <input type="number" className="ltd-input" value={value} min={min} disabled={loading} onChange={(e) => set(Number(e.target.value))} />
    </label>
  )

  return (
    <div className="ltd">
      <div className="ltd-head">
        <span className="ltd-title">Load test</span>
        <span className="ltd-method">{request.method}</span>
        <span className="ltd-url" title={resolvedUrl}>{resolvedUrl || request.url || '—'}</span>
        <button type="button" className="ltd-icon" onClick={onClose} aria-label="Close load test"><X size={14} /></button>
      </div>

      <div className="ltd-modes" role="group" aria-label="Test type">
        {([['burst', 'Parallel'], ['gap', 'Repeat with gap'], ['load', 'Load']] as const).map(([id, label]) => (
          <button key={id} type="button" className="ltd-mode" aria-pressed={mode === id} onClick={() => setMode(id)}>{label}</button>
        ))}
      </div>
      <p className="ltd-hint">{MODE_HINT[mode]}</p>

      <div className="ltd-config">
        {mode === 'burst' && numberField('At once', burst, setBurst)}
        {mode === 'gap' && <>{numberField('Requests', gapRequests, setGapRequests, 2)}{numberField('Gap (ms)', gapMs, setGapMs, 0)}</>}
        {mode === 'load' && <>
          {numberField('Concurrency', concurrency, setConcurrency)}
          <div className="ltd-field">
            <span className="ltd-label">{useDuration ? 'Duration (s)' : 'Requests'} <button type="button" className="ltd-link" onClick={() => setUseDuration(!useDuration)}>{useDuration ? '→ count' : '→ time'}</button></span>
            <input type="number" className="ltd-input" min={1} disabled={loading} value={useDuration ? durationS : totalReqs} onChange={(e) => (useDuration ? setDurationS : setTotalReqs)(Number(e.target.value))} />
          </div>
          {numberField('Warmup', warmupReqs, setWarmupReqs, 0)}
        </>}
        {numberField('Timeout (ms)', timeoutMs, setTimeoutMs, 100)}
        <button type="button" className="ltd-run" data-running={loading} onClick={() => void handleRun()} disabled={loading || !port || !resolvedUrl}>
          <span className="ltd-run-label">{loading ? 'Running' : 'Run'}</span>
        </button>
      </div>

      <div className="ltd-body">
        {unresolved && <div className="ltd-note" data-tone="warn">The URL still contains <b>{unresolved}</b>: that variable has no value (is the service or environment running?), so requests will fail.</div>}
        {error && <div className="ltd-note" data-tone="error">{error}</div>}
        {!result && !loading && !error && <div className="ltd-empty">Pick a test type and press Run.</div>}

        {result && (
          <>
            {result.failed > 0 && result.successful === 0 && firstError && <div className="ltd-note" data-tone="error">Every request failed: {firstError}</div>}
            <div className="ltd-stats">
              {[
                { label: 'Sent', value: String(result.totalRequests), bad: false },
                { label: 'Success', value: String(result.successful), bad: false },
                { label: 'Failed', value: String(result.failed), bad: result.failed > 0 },
                { label: 'Avg', value: `${result.avgMs.toFixed(1)}ms`, bad: false },
                { label: 'Min', value: `${result.minMs.toFixed(1)}ms`, bad: false },
                { label: 'Max', value: `${result.maxMs.toFixed(1)}ms`, bad: false },
                ...(probe ? [] : [
                  { label: 'Throughput', value: `${result.throughput.toFixed(1)}/s`, bad: false },
                  { label: 'Error %', value: `${result.errorRate.toFixed(1)}%`, bad: result.errorRate > 1 },
                ]),
              ].map(({ label, value, bad }) => (
                <div key={label} className="ltd-stat">
                  <div className="ltd-stat-value" data-bad={bad}>{value}</div>
                  <div className="ltd-stat-label">{label}</div>
                </div>
              ))}
            </div>

            {result.timeline && result.timeline.length > 0 && (probe || result.timeline.length <= 60) && (
              <div className="ltd-section">
                <div className="ltd-section-head">Waterfall</div>
                <Waterfall timeline={result.timeline} />
              </div>
            )}

            {!probe && result.throughputTimeline && result.throughputTimeline.length > 0 && (
              <div className="ltd-section">
                <div className="ltd-section-head">Throughput req/s</div>
                <ThroughputChart timeline={result.throughputTimeline} canvasRef={canvasRef} />
              </div>
            )}

            {!probe && (
              <div className="ltd-section">
                <div className="ltd-section-head">Latency percentiles</div>
                {([['p50', result.p50Ms], ['p75', result.p75Ms], ['p90', result.p90Ms], ['p95', result.p95Ms], ['p99', result.p99Ms], ['p99.9', result.p999Ms]] as const).map(([label, value]) => (
                  <PercentileRow key={label} label={label} value={value} max={maxP} />
                ))}
              </div>
            )}

            <div className="ltd-section">
              <div className="ltd-section-head">Status codes</div>
              <div className="ltd-codes">
                {Object.keys(result.statusCodes ?? {}).length === 0 && <span style={{ color: 'var(--color-text-4)' }}>none (no response received)</span>}
                {Object.entries(result.statusCodes ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([code, count]) => (
                  <span key={code}><b style={{ color: Number(code) < 400 ? 'var(--color-success)' : 'var(--color-error)' }}>{code}</b> <span style={{ color: 'var(--color-text-4)' }}>×{count}</span></span>
                ))}
              </div>
            </div>

            <div className="ltd-section ltd-row">
              <span className="ltd-label">Export</span>
              <button type="button" className="ltd-btn" onClick={exportJson}><FileJson size={12} /> JSON</button>
              <button type="button" className="ltd-btn" onClick={exportCsv}><Download size={12} /> CSV</button>
              <button type="button" className="ltd-btn" onClick={() => void exportReport('md')}><Download size={12} /> Markdown</button>
              <button type="button" className="ltd-btn" onClick={() => void exportReport('html')}><Download size={12} /> HTML</button>
              {result.warmupSkipped ? <span className="ltd-label">{result.warmupSkipped} warmup excluded</span> : null}
            </div>

            <div className="ltd-section">
              <div className="ltd-section-head">Save result</div>
              <div className="ltd-row">
                <input className="ltd-text" value={resultName} onChange={(e) => setResultName(e.target.value)} placeholder="Result name" />
                <button type="button" className="ltd-btn" onClick={() => void saveResult()} disabled={!resultName.trim()}>Save</button>
              </div>
            </div>

            {baseline && (
              <div className="ltd-section">
                <div className="ltd-section-head">Baseline</div>
                <div className="ltd-row">
                  <span style={{ fontSize: 12 }}>{baseline.totalRequests} requests · {baseline.avgMs.toFixed(1)}ms avg</span>
                  <button type="button" className="ltd-btn" onClick={() => void compareWithBaseline()}>Compare current</button>
                </div>
                {comparison && <div className="ltd-delta">{Object.entries(comparison.delta).map(([key, value]) => <div key={key}><div style={{ color: 'var(--color-text-4)' }}>{key}</div><div data-bad={value > 0}>{value > 0 ? '+' : ''}{value.toFixed(2)}{key === 'errRate' ? ' pp' : '%'}</div></div>)}</div>}
              </div>
            )}
          </>
        )}

        <details className="ltd-section ltd-details">
          <summary className="ltd-section-head">Saved scenarios ({scenarios.length})</summary>
          <div className="ltd-row">
            <input className="ltd-text" value={scenarioName} onChange={(e) => setScenarioName(e.target.value)} placeholder="Scenario name (saves the Load settings)" />
            <button type="button" className="ltd-btn" onClick={() => void saveScenario()} disabled={!scenarioName.trim()}>Save</button>
          </div>
          {scenarios.length > 0 && <div className="ltd-row" style={{ marginTop: 8 }}>{scenarios.map((name) => <button key={name} type="button" className="ltd-btn" onClick={() => void loadScenario(name)}>{name}</button>)}</div>}
        </details>

        {savedResults.length > 0 && (
          <details className="ltd-section ltd-details">
            <summary className="ltd-section-head">Saved results ({savedResults.length})</summary>
            {savedResults.map((saved) => (
              <div key={saved.name} className="ltd-saved">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{saved.name}</div>
                  <div style={{ color: 'var(--color-text-4)', fontFamily: 'var(--font-mono)' }}>{saved.method} · {saved.total} req · p95 {saved.p95Ms.toFixed(1)}ms</div>
                </div>
                <button type="button" className="ltd-btn" onClick={() => void loadSavedResult(saved.name)}>Load</button>
                <button type="button" className="ltd-btn" onClick={() => void loadSavedResult(saved.name, true)}>Baseline</button>
                <button type="button" className="ltd-icon" onClick={() => void deleteSavedResult(saved.name)} aria-label={`Delete ${saved.name}`}><Trash2 size={12} /></button>
              </div>
            ))}
          </details>
        )}
      </div>
    </div>
  )
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}
