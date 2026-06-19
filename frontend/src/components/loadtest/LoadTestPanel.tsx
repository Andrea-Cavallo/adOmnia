import { useState, useEffect } from 'react'
import { Plus, Trash2, Save, List, FileDown, GitCompare, Database, Clock, X } from 'lucide-react'
import { useServerPort, serverUrl, sidecarFetch } from '@/lib/useServerPort'
import { useSettingsStore } from '@/stores/settings'

interface ThroughputBucket {
  second: number
  reqs: number
  avgMs: number
}

interface LoadTestResult {
  totalRequests: number
  successful: number
  failed: number
  totalTimeMs: number
  avgMs: number
  minMs: number
  maxMs: number
  p50Ms: number
  p75Ms: number
  p90Ms: number
  p95Ms: number
  p99Ms: number
  p999Ms: number
  throughput: number
  errorRate: number
  statusCodes: Record<number, number>
  throughputTimeline?: ThroughputBucket[]
  warmupSkipped?: number
}

interface KVRow {
  key: string
  value: string
}

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

function HeadersEditor({ rows, onChange }: { rows: KVRow[]; onChange: (r: KVRow[]) => void }) {
  const set = (i: number, k: string, v: string) => {
    const next = rows.map((r, idx) => idx === i ? { key: k, value: v } : r)
    onChange(next)
  }
  return (
    <div className="flex flex-col gap-1">
      {rows.map((r, i) => (
        <div key={i} className="flex gap-1.5">
          <input
            value={r.key}
            onChange={(e) => set(i, e.target.value, r.value)}
            placeholder="Header"
            className="w-36 h-6 px-1.5 bg-surface-2 border border-border-2 rounded text-[10px] text-text-1 font-mono outline-none focus:border-accent"
          />
          <input
            value={r.value}
            onChange={(e) => set(i, r.key, e.target.value)}
            placeholder="Value"
            className="flex-1 h-6 px-1.5 bg-surface-2 border border-border-2 rounded text-[10px] text-text-1 font-mono outline-none focus:border-accent"
          />
          <button onClick={() => onChange(rows.filter((_, idx) => idx !== i))} className="text-text-4 hover:text-error">
            <Trash2 size={10} />
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange([...rows, { key: '', value: '' }])}
        className="self-start flex items-center gap-1 text-[10px] text-accent hover:text-accent/80"
      >
        <Plus size={10} /> header
      </button>
    </div>
  )
}

export function LoadTestPanel() {
  const port = useServerPort()
  const [url, setUrl] = useState('')
  const [method, setMethod] = useState('GET')
  const [concurrency, setConcurrency] = useState(() => useSettingsStore.getState().settings.general.maxConcurrentRequests ?? 10)
  const [totalReqs, setTotalReqs] = useState(100)
  const [durationS, setDurationS] = useState(0)
  const [useDuration, setUseDuration] = useState(false)
  const [timeoutMs, setTimeoutMs] = useState(5000)
  const [rampUpMs, setRampUpMs] = useState(0)
  const [warmupReqs, setWarmupReqs] = useState(0)
  const [cooldownMs, setCooldownMs] = useState(0)
  const [qpsTarget, setQpsTarget] = useState(0)
  const [body, setBody] = useState('')
  const [headers, setHeaders] = useState<KVRow[]>([])
  const [result, setResult] = useState<LoadTestResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState('')
  const [reportFormat, setReportFormat] = useState('json')
  const [reportData, setReportData] = useState<string | null>(null)
  const [scenarioName, setScenarioName] = useState('')
  const [scenarios, setScenarios] = useState<string[]>([])
  const [compareResult, setCompareResult] = useState<object | null>(null)
  const [baselineResult, setBaselineResult] = useState<LoadTestResult | null>(null)
  const [savedResults, setSavedResults] = useState<SavedResultSummary[]>([])
  const [saveResultName, setSaveResultName] = useState('')
  const [savingResult, setSavingResult] = useState(false)

  const baseApi = (path: string) => serverUrl(port, path)

  const apiGet = async (path: string) => {
    const u = baseApi(path)
    if (!u) return null
    const r = await sidecarFetch(u)
    return r.json()
  }

  const apiPost = async (path: string, body: unknown) => {
    const u = baseApi(path)
    if (!u) return null
    const r = await sidecarFetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return r.json()
  }

  const loadScenarios = async () => {
    const data = await apiGet('/loadtest/scenario/list')
    if (data?.scenarios) setScenarios(data.scenarios)
  }

  useEffect(() => {
    if (port) {
      void loadScenarios()
      void loadSavedResults()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [port])

  const saveScenario = async () => {
    if (!scenarioName) return
    await apiPost('/loadtest/scenario/save', {
      name: scenarioName,
      config: { url, method, concurrency, totalReqs, durationS, timeoutMs, rampUpMs, warmupReqs, cooldownMs, qpsTarget, body, headers: Object.fromEntries(headers.filter((h) => h.key).map((h) => [h.key, h.value])) },
    })
    setScenarioName('')
    loadScenarios()
  }

  const loadScenario = async (name: string) => {
    const data = await apiGet(`/loadtest/scenario/load?name=${encodeURIComponent(name)}`)
    if (data?.config) {
      const c = data.config
      if (c.url) setUrl(c.url)
      if (c.method) setMethod(c.method)
      if (c.concurrency) setConcurrency(c.concurrency)
      if (c.totalReqs) setTotalReqs(c.totalReqs)
      if (c.durationS) { setDurationS(c.durationS); setUseDuration(true) }
      if (c.timeoutMs) setTimeoutMs(c.timeoutMs)
      if (c.rampUpMs) setRampUpMs(c.rampUpMs)
      if (c.warmupReqs) setWarmupReqs(c.warmupReqs)
      if (c.cooldownMs) setCooldownMs(c.cooldownMs)
      if (c.qpsTarget) setQpsTarget(c.qpsTarget)
      if (c.body) setBody(c.body)
      if (c.headers) setHeaders(Object.entries(c.headers as Record<string, string>).map(([k, v]) => ({ key: k, value: v })))
    }
  }

  const loadSavedResults = async () => {
    const data = await apiGet('/loadtest/result/list')
    if (data?.results) setSavedResults(data.results as SavedResultSummary[])
  }

  const saveResult = async () => {
    if (!result || !saveResultName) return
    setSavingResult(true)
    try {
      await apiPost('/loadtest/result/save', { name: saveResultName, url, method, result })
      setSaveResultName('')
      await loadSavedResults()
    } finally {
      setSavingResult(false)
    }
  }

  const loadSavedResult = async (name: string, asBaseline = false) => {
    const data = await apiGet(`/loadtest/result/load?name=${encodeURIComponent(name)}`)
    if (data?.result) {
      if (asBaseline) {
        setBaselineResult(data.result as LoadTestResult)
      } else {
        setResult(data.result as LoadTestResult)
      }
    }
  }

  const deleteSavedResult = async (name: string) => {
    const u = baseApi(`/loadtest/result/delete?name=${encodeURIComponent(name)}`)
    if (!u) return
    await sidecarFetch(u, { method: 'DELETE' })
    await loadSavedResults()
  }

  const generateReport = async () => {
    const data = await apiPost('/loadtest/report', { result, format: reportFormat })
    if (data?.report) setReportData(data.report)
  }

  const handleCompare = async () => {
    if (!result || !baselineResult) return
    const data = await apiPost('/loadtest/compare', { result1: baselineResult, result2: result })
    if (data) setCompareResult(data)
  }

  const handleRun = async () => {
    const apiUrl = serverUrl(port, '/loadtest')
    if (!apiUrl) { setError('Backend not ready'); return }
    if (!url) { setError('URL required'); return }
    setLoading(true)
    setError('')
    setResult(null)
    setProgress(useDuration ? `Running for ${durationS}s…` : `Running ${totalReqs} requests…`)
    try {
      const headersObj = Object.fromEntries(headers.filter((h) => h.key).map((h) => [h.key, h.value]))
      const payload: Record<string, unknown> = {
        url, method, concurrency, timeoutMs,
        headers: headersObj,
        body: body || undefined,
        rampUpMs: rampUpMs || undefined,
        warmupReqs: warmupReqs || undefined,
        cooldownMs: cooldownMs || undefined,
        qpsTarget: qpsTarget > 0 ? qpsTarget : undefined,
      }
      if (useDuration) {
        payload.durationS = durationS
      } else {
        payload.totalReqs = totalReqs
      }
      const res = await sidecarFetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (res.ok) {
        setResult(data)
      } else {
        setError(data.error || 'Load test failed')
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
      setProgress('')
    }
  }

  const ms = (n: number) => `${n.toFixed(1)}ms`

  const maxBucketReqs = result?.throughputTimeline
    ? Math.max(...result.throughputTimeline.map((b) => b.reqs), 1)
    : 1

  return (
    <div className="flex-1 flex flex-col p-4 gap-4 overflow-auto">
      <h2 className="text-sm font-semibold text-text-1">Load Test</h2>

      {/* URL + Method */}
      <div className="bg-surface-1 border border-border-1 rounded p-3 flex flex-col gap-3">
        <div className="flex gap-2">
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="h-8 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none"
          >
            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m}>{m}</option>)}
          </select>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
              placeholder="https://api.your-domain.com/v1/endpoint"
            className="flex-1 h-8 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none focus:border-accent"
          />
        </div>

        {/* Load params */}
        <div className="grid grid-cols-3 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-text-4 uppercase tracking-wider">Concurrency</span>
            <input type="number" value={concurrency} min={1}
              onChange={(e) => setConcurrency(Number(e.target.value))}
              className="h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-text-4 uppercase tracking-wider">
                {useDuration ? 'Duration (s)' : 'Total Requests'}
              </span>
              <button
                onClick={() => setUseDuration(!useDuration)}
                className="text-[9px] text-accent hover:text-accent/80"
              >
                {useDuration ? '→ count' : '→ duration'}
              </button>
            </div>
            {useDuration ? (
              <input type="number" value={durationS} min={1}
                onChange={(e) => setDurationS(Number(e.target.value))}
                className="h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none focus:border-accent"
              />
            ) : (
              <input type="number" value={totalReqs} min={1}
                onChange={(e) => setTotalReqs(Number(e.target.value))}
                className="h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none focus:border-accent"
              />
            )}
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-text-4 uppercase tracking-wider">Timeout (ms)</span>
            <input type="number" value={timeoutMs} min={100}
              onChange={(e) => setTimeoutMs(Number(e.target.value))}
              className="h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none focus:border-accent"
            />
          </label>
        </div>

        {/* Advanced params */}
        <div className="grid grid-cols-4 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-text-4 uppercase tracking-wider">Ramp-up (ms)</span>
            <input type="number" value={rampUpMs} min={0}
              onChange={(e) => setRampUpMs(Number(e.target.value))}
              className="h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-text-4 uppercase tracking-wider">Warmup Reqs</span>
            <input type="number" value={warmupReqs} min={0}
              onChange={(e) => setWarmupReqs(Number(e.target.value))}
              className="h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-text-4 uppercase tracking-wider">Cooldown (ms)</span>
            <input type="number" value={cooldownMs} min={0}
              onChange={(e) => setCooldownMs(Number(e.target.value))}
              className="h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-text-4 uppercase tracking-wider">QPS Target</span>
            <input type="number" value={qpsTarget} min={0} step={0.1}
              onChange={(e) => setQpsTarget(Number(e.target.value))}
              placeholder="0 = unlimited"
              className="h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none focus:border-accent"
            />
          </label>
        </div>

        {/* Headers */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-text-4 uppercase tracking-wider">Headers</span>
          <HeadersEditor rows={headers} onChange={setHeaders} />
        </div>

        {/* Body */}
        {['POST', 'PUT', 'PATCH'].includes(method) && (
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-text-4 uppercase tracking-wider">Body</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              className="px-2 py-1.5 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono outline-none focus:border-accent resize-none"
            />
          </label>
        )}

        <button
          onClick={handleRun}
          disabled={loading || !url || !port}
          className="self-start px-4 py-1.5 bg-accent text-white rounded text-xs font-medium disabled:opacity-50"
        >
          {loading ? 'Running…' : 'Run Test'}
        </button>
      </div>

      {/* Scenarios */}
      <details className="bg-surface-1 border border-border-1 rounded p-3 flex flex-col gap-3">
        <summary className="text-[11px] text-text-2 font-medium cursor-pointer hover:text-text-1 select-none flex items-center gap-2">
          <Save size={12} className="text-accent" /> Scenarios ({scenarios.length})
        </summary>
        <div className="flex gap-2 mt-2">
          <input value={scenarioName} onChange={(e) => setScenarioName(e.target.value)} placeholder="scenario name"
            className="flex-1 h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none focus:border-accent" />
          <button onClick={saveScenario} disabled={!scenarioName} className="px-3 py-1.5 bg-accent text-white rounded text-xs font-medium disabled:opacity-40 flex items-center gap-1">
            <Save size={10} /> Save
          </button>
          <button onClick={loadScenarios} className="px-2 py-1.5 border border-border-2 rounded text-xs text-text-3 hover:text-text-1">
            <List size={12} />
          </button>
        </div>
        {scenarios.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {scenarios.map((name) => (
              <button key={name} onClick={() => loadScenario(name)}
                className="px-2 py-1 bg-surface-2 border border-border-2 rounded text-[10px] text-text-3 hover:text-text-1 hover:border-accent/40 font-mono">
                {name}
              </button>
            ))}
          </div>
        )}
      </details>

      {progress && <div className="text-xs text-text-3 animate-pulse">{progress}</div>}
      {error && <div className="px-3 py-2 bg-error/10 border border-error/30 rounded text-xs text-error">{error}</div>}

      {result && (
        <div className="flex flex-col gap-3">
          {/* Summary */}
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'Requests', value: result.totalRequests.toString(), ok: true },
              { label: 'Success', value: result.successful.toString(), ok: true },
              { label: 'Failed', value: result.failed.toString(), ok: result.failed === 0 },
              { label: 'Throughput', value: `${result.throughput.toFixed(1)} req/s`, ok: true },
              { label: 'Avg', value: ms(result.avgMs), ok: true },
              { label: 'Min', value: ms(result.minMs), ok: true },
              { label: 'Max', value: ms(result.maxMs), ok: true },
              { label: 'Error Rate', value: `${(result.errorRate * 100).toFixed(1)}%`, ok: result.errorRate < 0.01 },
            ].map(({ label, value, ok }) => (
              <div key={label} className="bg-surface-1 border border-border-1 rounded p-2.5">
                <div className="text-[10px] text-text-4 uppercase tracking-wider">{label}</div>
                <div className={`text-sm font-mono mt-0.5 ${ok ? 'text-text-1' : 'text-error'}`}>{value}</div>
              </div>
            ))}
          </div>

          {/* Percentiles */}
          <div className="bg-surface-1 border border-border-1 rounded p-3">
            <div className="text-[10px] text-text-4 uppercase tracking-wider mb-2">Latency Percentiles</div>
            <div className="flex gap-4 flex-wrap">
              {[
                { label: 'p50', value: result.p50Ms },
                { label: 'p75', value: result.p75Ms },
                { label: 'p90', value: result.p90Ms },
                { label: 'p95', value: result.p95Ms },
                { label: 'p99', value: result.p99Ms },
                { label: 'p99.9', value: result.p999Ms },
              ].map(({ label, value }) => (
                <div key={label} className="flex flex-col items-center bg-surface-2 rounded px-3 py-1.5">
                  <span className="text-[10px] text-text-4">{label}</span>
                  <span className="text-xs font-mono text-text-1">{ms(value)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Status codes */}
          <div className="bg-surface-1 border border-border-1 rounded p-3">
            <div className="text-[10px] text-text-4 uppercase tracking-wider mb-2">Status Codes</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(result.statusCodes).sort().map(([code, count]) => {
                const n = Number(code)
                const color = n < 300 ? 'text-success' : n < 500 ? 'text-warning' : 'text-error'
                return (
                  <span key={code} className="px-2 py-1 bg-surface-2 rounded text-xs font-mono flex items-center gap-1.5">
                    <span className={color}>{code}</span>
                    <span className="text-text-4">×{count}</span>
                  </span>
                )
              })}
            </div>
          </div>

          {/* Throughput timeline */}
          {result.throughputTimeline && result.throughputTimeline.length > 0 && (
            <div className="bg-surface-1 border border-border-1 rounded p-3">
              <div className="text-[10px] text-text-4 uppercase tracking-wider mb-2">Throughput Timeline</div>
              <div className="flex items-end gap-0.5 h-20">
                {result.throughputTimeline.map((b) => (
                  <div
                    key={b.second}
                    title={`${b.second}s: ${b.reqs} req/s, avg ${b.avgMs.toFixed(0)}ms`}
                    className="flex-1 bg-accent/60 hover:bg-accent rounded-t min-w-0 transition-colors"
                    style={{ height: `${Math.max(2, (b.reqs / maxBucketReqs) * 100)}%` }}
                  />
                ))}
              </div>
              <div className="flex justify-between text-[9px] text-text-4 mt-1">
                <span>0s</span>
                <span>{result.throughputTimeline[result.throughputTimeline.length - 1]?.second}s</span>
              </div>
            </div>
          )}

          {result.warmupSkipped !== undefined && result.warmupSkipped > 0 && (
            <p className="text-[11px] text-text-4">
              {result.warmupSkipped} warmup requests excluded from results
            </p>
          )}

          {/* Reports */}
          <details className="bg-surface-1 border border-border-1 rounded p-3 flex flex-col gap-2">
            <summary className="text-[11px] text-text-2 font-medium cursor-pointer hover:text-text-1 select-none flex items-center gap-2">
              <FileDown size={12} className="text-accent" /> Report
            </summary>
            <div className="flex gap-2 mt-2">
              <select value={reportFormat} onChange={(e) => setReportFormat(e.target.value)}
                className="h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none">
                <option value="json">JSON</option>
                <option value="html">HTML</option>
                <option value="md">Markdown</option>
              </select>
              <button onClick={generateReport} className="px-3 py-1.5 bg-accent text-white rounded text-xs font-medium flex items-center gap-1">
                <FileDown size={10} /> Generate
              </button>
            </div>
            {reportData && (
              <pre className="p-3 bg-surface-2 rounded text-xs text-text-2 font-mono whitespace-pre-wrap overflow-auto max-h-64">{reportData}</pre>
            )}
          </details>

          {/* Compare */}
          <details className="bg-surface-1 border border-border-1 rounded p-3 flex flex-col gap-2">
            <summary className="text-[11px] text-text-2 font-medium cursor-pointer hover:text-text-1 select-none flex items-center gap-2">
              <GitCompare size={12} className="text-accent" /> Compare
            </summary>
            <div className="flex gap-2 mt-2 items-center flex-wrap">
              <button
                onClick={() => setBaselineResult(result)}
                className="px-3 py-1.5 bg-surface-2 border border-border-2 rounded text-xs text-text-3 hover:text-text-1"
              >
                Set as Baseline
              </button>
              <button
                onClick={handleCompare}
                disabled={!baselineResult || !result}
                className="px-3 py-1.5 bg-surface-2 border border-border-2 rounded text-xs text-text-3 hover:text-text-1 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Compare with Baseline
              </button>
              {baselineResult && (
                <span className="text-[10px] text-text-4">Baseline set — {baselineResult.totalRequests} req, avg {baselineResult.avgMs.toFixed(1)}ms</span>
              )}
            </div>
            {compareResult && (
              <pre className="p-3 bg-surface-2 rounded text-xs text-text-2 font-mono whitespace-pre-wrap overflow-auto max-h-64 mt-2">
                {JSON.stringify(compareResult, null, 2)}
              </pre>
            )}
          </details>

          {/* Save Result */}
          <div className="bg-surface-1 border border-border-1 rounded p-3 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Database size={12} className="text-accent" />
              <span className="text-[11px] text-text-2 font-medium">Save Result</span>
            </div>
            <div className="flex gap-2">
              <input
                value={saveResultName}
                onChange={(e) => setSaveResultName(e.target.value)}
                placeholder={`${method} ${url || 'endpoint'} — result name`}
                className="flex-1 h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none focus:border-accent"
              />
              <button
                onClick={saveResult}
                disabled={!saveResultName || savingResult}
                className="px-3 py-1.5 bg-accent text-white rounded text-xs font-medium disabled:opacity-40 flex items-center gap-1"
              >
                <Save size={10} /> {savingResult ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Saved Results */}
      {savedResults.length > 0 && (
        <details className="bg-surface-1 border border-border-1 rounded p-3 flex flex-col gap-2">
          <summary className="text-[11px] text-text-2 font-medium cursor-pointer hover:text-text-1 select-none flex items-center gap-2">
            <Database size={12} className="text-accent" /> Saved Results ({savedResults.length})
          </summary>
          <div className="flex flex-col gap-1 mt-2 max-h-64 overflow-auto">
            {savedResults.map((s) => (
              <div key={s.name} className="flex items-center gap-2 px-2 py-1.5 bg-surface-2 rounded hover:bg-surface-3 transition-colors group">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-text-1 font-medium truncate">{s.name}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[9px] font-bold text-method-get">{s.method}</span>
                    <span className="text-[10px] text-text-4 truncate font-mono">{s.url}</span>
                    <Clock size={9} className="text-text-4 shrink-0" />
                    <span className="text-[10px] text-text-4 shrink-0">{new Date(s.timestamp).toLocaleDateString()}</span>
                  </div>
                  <div className="flex gap-3 mt-0.5 text-[10px] text-text-3">
                    <span>avg {s.avgMs.toFixed(1)}ms</span>
                    <span>p95 {s.p95Ms.toFixed(1)}ms</span>
                    <span className={s.errorRate > 0.01 ? 'text-error' : ''}>{(s.errorRate * 100).toFixed(1)}% err</span>
                    <span>{s.total} req</span>
                  </div>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    onClick={() => loadSavedResult(s.name)}
                    title="Load as current result"
                    className="px-2 py-1 bg-accent/20 hover:bg-accent/40 text-accent rounded text-[10px] font-medium"
                  >
                    Load
                  </button>
                  <button
                    onClick={() => loadSavedResult(s.name, true)}
                    title="Load as baseline for compare"
                    className="px-2 py-1 bg-surface-1 hover:bg-surface-3 border border-border-2 text-text-3 hover:text-text-1 rounded text-[10px]"
                  >
                    Baseline
                  </button>
                  <button
                    onClick={() => deleteSavedResult(s.name)}
                    title="Delete saved result"
                    className="p-1 text-text-4 hover:text-error rounded"
                  >
                    <X size={10} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
