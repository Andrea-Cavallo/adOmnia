import { useState, useEffect, useRef } from 'react'
import { X, Download, FileJson, Square, Activity, Play, Users, Zap, Timer, Gauge, FolderOpen } from 'lucide-react'
import type { RequestItem } from '@/lib/types'
import { substVars } from '@/lib/substVars'
import { useEnvironmentsStore } from '@/stores/environments'
import { useSettingsStore } from '@/stores/settings'
import { prepareExecution } from '@/lib/sendRequest'
import {
  compareResults, listSavedSettings, listScenarioFiles, loadSettings, rememberScenarioFolder, renderReport, runLoadTest, runScenarioFile,
  saveScenarioFile, saveSettings, scenarioFolder, type LoadTestComparison, type LoadTestProgress, type LoadTestReportFormat, type LoadTestResult,
  type LoadTestRun, type LoadTestScenarioFile, type LoadTestScenarioFileEntry, readScenarioFile,
} from '@/lib/loadtest-api'
import { appRunInput } from '@/lib/flowStress'
import { pickFolder } from '@/lib/fileDialogs'
import { buildLoadPlan, MAX_PROBE, MAX_RPS, MAX_VUS, type LoadMode } from './loadTestPlan'
import { PercentileRow, ThroughputChart, Waterfall, type ThroughputBucket } from './loadTestParts'
import { LoadTestInspector } from './LoadTestInspector'
import { restoreLoadScenario } from './loadTestScenario'
import { ComparisonView, LoadTestHistory } from './LoadTestHistory'
import './loadTestDrawer.css'

const MODE_HINT: Record<LoadMode, string> = {
  burst: 'Fires N copies of this request at the same instant, to see what happens when they race.',
  gap: 'Sends the same request a few times, each one starting a fixed gap after the previous (no waiting for the answer).',
  load: 'Virtual users repeat the request for a number of iterations or for a time, with an optional ramp-up and think time.',
  rate: 'A fixed number of requests per second, whatever the server does: if it slows down, requests keep arriving and the ones the VU pool cannot start are reported as dropped.',
}

interface LoadTestDrawerProps {
  request: RequestItem
  onClose: () => void
}

export function LoadTestDrawer({ request, onClose }: LoadTestDrawerProps) {
  const getResolvedVars = useEnvironmentsStore((s) => s.getResolvedVars)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [mode, setMode] = useState<LoadMode>('load')
  const [burst, setBurst] = useState(5)
  const [gapRequests, setGapRequests] = useState(2)
  const [gapMs, setGapMs] = useState(200)
  const [concurrency, setConcurrency] = useState(() => useSettingsStore.getState().settings.general.maxConcurrentRequests ?? 10)
  const [totalReqs, setTotalReqs] = useState(100)
  const [durationS, setDurationS] = useState(30)
  const [useDuration, setUseDuration] = useState(false)
  const [timeoutMs, setTimeoutMs] = useState(5000)
  const [warmupReqs, setWarmupReqs] = useState(5)
  const [rampUpS, setRampUpS] = useState(0)
  const [thinkTimeMs, setThinkTimeMs] = useState(0)
  const [rps, setRps] = useState(50)
  const [maxVUs, setMaxVUs] = useState(100)
  const [progress, setProgress] = useState<LoadTestProgress | null>(null)
  const [liveTimeline, setLiveTimeline] = useState<ThroughputBucket[]>([])
  const runRef = useRef<LoadTestRun | null>(null)

  const [result, setResult] = useState<LoadTestResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [scenarioName, setScenarioName] = useState('')
  const [scenarios, setScenarios] = useState<string[]>([])
  const [baseline, setBaseline] = useState<LoadTestResult | null>(null)
  const [comparison, setComparison] = useState<LoadTestComparison | null>(null)
  const [historyKey, setHistoryKey] = useState(0)
  const [folder, setFolder] = useState(scenarioFolder)
  const [files, setFiles] = useState<LoadTestScenarioFileEntry[]>([])
  const [notice, setNotice] = useState('')
  const [abortOnFail, setAbortOnFail] = useState(false)
  const [gatesEnabled, setGatesEnabled] = useState(false)
  const [maxP95Ms, setMaxP95Ms] = useState(1000)
  const [maxErrorPct, setMaxErrorPct] = useState(1)
  const [minRps, setMinRps] = useState(0)
  const [resultGated, setResultGated] = useState(false)

  const vars = getResolvedVars()
  const resolvedUrl = substVars(request.url, vars)
  const unresolved = resolvedUrl.match(/\{\{[^{}]+\}\}/)?.[0]
  const inputs = { concurrency, totalReqs, durationS, useDuration, warmupReqs, rampUpS, thinkTimeMs, burst, gapRequests, gapMs, rps, maxVUs }
  // A run still going when the drawer closes is stopped: nobody would see its result.
  useEffect(() => () => runRef.current?.stop(), [])

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e))
  const targetLabel = `${request.method} ${resolvedUrl}`
  const gates = () => (gatesEnabled ? { maxP95Ms, maxErrorPct, minRps, abortOnFail } : undefined)

  useEffect(() => { listSavedSettings().then(setScenarios, fail) }, [])
  useEffect(() => {
    if (!folder) return
    listScenarioFiles(folder).then(setFiles, fail)
  }, [folder, historyKey])

  const saveScenario = async () => {
    if (!scenarioName.trim()) return
    try {
      const config = { url: resolvedUrl, method: request.method, mode, timeoutMs, ...inputs, gatesEnabled, maxP95Ms, maxErrorPct, minRps, abortOnFail, workload: buildLoadPlan(mode, inputs) }
      await saveSettings(scenarioName.trim(), config)
      setScenarioName('')
      setScenarios(await listSavedSettings())
    } catch (e) { fail(e) }
  }

  const loadScenario = async (name: string) => {
    try {
      const data = await loadSettings(name)
      const restored = restoreLoadScenario(data, { mode, timeoutMs, ...inputs })
      setConcurrency(restored.concurrency); setTotalReqs(restored.totalReqs); setDurationS(restored.durationS)
      setTimeoutMs(restored.timeoutMs); setWarmupReqs(restored.warmupReqs); setRampUpS(restored.rampUpS)
      setThinkTimeMs(restored.thinkTimeMs); setUseDuration(restored.useDuration); setMode(restored.mode)
      setBurst(restored.burst); setGapRequests(restored.gapRequests); setGapMs(restored.gapMs)
      setRps(restored.rps); setMaxVUs(restored.maxVUs)
      setGatesEnabled(data.gatesEnabled === true)
      setAbortOnFail(data.abortOnFail === true)
      setMaxP95Ms(typeof data.maxP95Ms === 'number' && Number.isFinite(data.maxP95Ms) ? Math.max(0, data.maxP95Ms) : 1000)
      setMaxErrorPct(typeof data.maxErrorPct === 'number' && Number.isFinite(data.maxErrorPct) ? Math.max(0, Math.min(100, data.maxErrorPct)) : 1)
      setMinRps(typeof data.minRps === 'number' && Number.isFinite(data.minRps) ? Math.max(0, data.minRps) : 0)
      setError('')
    } catch (e) { fail(e) }
  }

  /** The versionable file: the request as written ({{variables}}, auth settings), never resolved values. */
  const scenarioFile = (name: string): LoadTestScenarioFile => ({
    format: 'adomnia-loadtest', version: 1, name,
    target: { kind: 'request', request: request as unknown as LoadTestScenarioFile['target']['request'] },
    workload: buildLoadPlan(mode, inputs),
    gates: gates(),
  } as LoadTestScenarioFile)

  const chooseFolder = async () => {
    const picked = await pickFolder('Workspace folder for load test scenarios (.adomnia/loadtests)')
    if (!picked) return
    rememberScenarioFolder(picked)
    setFolder(picked)
  }

  const saveToWorkspace = async () => {
    const name = scenarioName.trim() || request.name?.trim() || 'load-test'
    let target = folder
    if (!target) {
      target = await pickFolder('Workspace folder for load test scenarios (.adomnia/loadtests)')
      if (!target) return
      rememberScenarioFolder(target); setFolder(target)
    }
    try {
      const path = await saveScenarioFile(target, scenarioFile(name))
      setNotice(`Saved ${path}. Commit it to share the test; run it in CI with: adomnia stress "${path}" --env-var KEY=VALUE`)
      setFiles(await listScenarioFiles(target))
    } catch (e) { fail(e) }
  }

  const runFile = async (entry: LoadTestScenarioFileEntry) => {
    if (loading) return
    setLoading(true); setError(''); setResult(null); setComparison(null); setProgress(null); setLiveTimeline([])
    try {
      const file = await readScenarioFile(entry.path)
      setResultGated(Boolean(file.gates))
      const run = runScenarioFile(file, await appRunInput(vars), (update) => setProgress(update))
      runRef.current = run
      setResult(await run.result)
      setHistoryKey((n) => n + 1)
    } catch (e) { fail(e) } finally { runRef.current = null; setLoading(false) }
  }

  const compareWithBaseline = async () => {
    if (!baseline || !result) return
    try { setComparison(await compareResults(baseline, result)) } catch (e) { fail(e) }
  }

  const REPORT: Record<LoadTestReportFormat, [string, string]> = {
    json: ['application/json', 'json'], md: ['text/markdown', 'md'], html: ['text/html', 'html'],
    junit: ['application/xml', 'junit.xml'], csv: ['text/csv', 'steps.csv'], samples: ['text/csv', 'requests.csv'],
  }
  const exportReport = async (format: LoadTestReportFormat) => {
    if (!result) return
    try {
      const text = await renderReport(result, format)
      const [type, ext] = REPORT[format]
      triggerDownload(new Blob([text], { type }), `loadtest-${Date.now()}.${ext}`)
    } catch (e) { fail(e) }
  }

  const handleRun = async () => {
    if (!resolvedUrl) { setError('URL is empty'); return }
    if (loading) return
    if (!Number.isFinite(timeoutMs) || timeoutMs < 100) { setError('Timeout must be at least 100 ms.'); return }
    if (gatesEnabled && (!Number.isFinite(maxP95Ms) || maxP95Ms < 0 || !Number.isFinite(maxErrorPct) || maxErrorPct < 0 || maxErrorPct > 100 || !Number.isFinite(minRps) || minRps < 0)) { setError('Enter valid SLO thresholds: nonnegative latency and throughput, errors between 0 and 100%.'); return }
    setResultGated(gatesEnabled)
    setLoading(true); setError(''); setResult(null); setComparison(null); setProgress(null); setLiveTimeline([])
    try {
      // The same resolution as Send: vault, auth (OAuth2, AWS4…), cookies, hosts map, TLS, PSD2.
      const prepared = await prepareExecution(request, vars)
      if (prepared.kind === 'error') { setError(prepared.response.error?.message || 'The request could not be prepared'); return }
      if (prepared.kind === 'browser') { setError('Multipart form-data bodies cannot be load tested yet: use a raw, JSON or URL-encoded body.'); return }
      const run = runLoadTest({ ...prepared.exec, timeoutMs }, buildLoadPlan(mode, inputs), (update) => {
        setProgress(update)
        setLiveTimeline((points) => [...points.filter((point) => point.second !== Math.floor(update.elapsedS)).slice(-599), { second: Math.floor(update.elapsedS), reqs: update.rps, avgMs: update.p95Ms }])
      }, request.name, gates())
      runRef.current = run
      setResult(await run.result)
      setHistoryKey((n) => n + 1)
    } catch (e) { fail(e) } finally { runRef.current = null; setLoading(false) }
  }

  const maxP = result ? Math.max(result.p50Ms, result.p75Ms, result.p90Ms, result.p95Ms, result.p99Ms, result.p999Ms, 1) : 1
  const probe = mode === 'burst' || mode === 'gap'
  const firstError = result?.timeline?.find((t) => t.error)?.error
  const numberField = (label: string, value: number, set: (n: number) => void, min = 1, max?: number) => (
    <label className="ltd-field">
      <span className="ltd-label">{label}</span>
      <input type="number" className="ltd-input" value={value} min={min} max={max} disabled={loading} onChange={(e) => set(Number(e.target.value))} />
    </label>
  )

  return (
    <div className="ltd">
      <div className="ltd-head">
        <Activity size={24} className="ltd-brand-icon" />
        <div className="ltd-heading"><span className="ltd-title">Performance lab</span><span className="ltd-subtitle">Configure. Run. Understand.</span></div>
        <span className="ltd-method">{request.method}</span>
        <span className="ltd-url" title={resolvedUrl}>{resolvedUrl || request.url || '—'}</span>
        <button type="button" className="ltd-icon" onClick={onClose} aria-label="Close load test"><X size={14} /></button>
      </div>

      <div className="ltd-workbench">
      <aside className="ltd-plan" aria-label="Test plan configuration">
      <div className="ltd-plan-heading"><span>Test plan</span><span>01</span></div>
      <div className="ltd-modes" role="group" aria-label="Test type">
        {([['load', 'Virtual users', Users], ['rate', 'Arrival rate', Gauge], ['burst', 'Parallel burst', Zap], ['gap', 'Paced requests', Timer]] as const).map(([id, label, Icon]) => (
          <button key={id} type="button" className="ltd-mode" disabled={loading} aria-pressed={mode === id} onClick={() => setMode(id)}><Icon size={16} />{label}</button>
        ))}
      </div>
      <p className="ltd-hint">{MODE_HINT[mode]}</p>

      <div className="ltd-config">
        {mode === 'burst' && numberField('At once', burst, setBurst, 1, MAX_PROBE)}
        {mode === 'gap' && <>{numberField('Requests', gapRequests, setGapRequests, 2)}{numberField('Gap (ms)', gapMs, setGapMs, 0)}</>}
        {mode === 'load' && <>
          {numberField('Virtual users', concurrency, setConcurrency, 1, MAX_VUS)}
          <div className="ltd-field">
            <span className="ltd-label">{useDuration ? 'Duration (s)' : 'Requests'} <button type="button" className="ltd-link" disabled={loading} onClick={() => setUseDuration(!useDuration)}>{useDuration ? '→ count' : '→ time'}</button></span>
            <input type="number" className="ltd-input" min={1} disabled={loading} value={useDuration ? durationS : totalReqs} onChange={(e) => (useDuration ? setDurationS : setTotalReqs)(Number(e.target.value))} />
          </div>
          {useDuration && numberField('Ramp-up (s)', rampUpS, setRampUpS, 0)}
          {!(useDuration && rampUpS > 0) && numberField('Warmup', warmupReqs, setWarmupReqs, 0)}
          {numberField('Think (ms)', thinkTimeMs, setThinkTimeMs, 0)}
        </>}
        {mode === 'rate' && <>
          {numberField('Requests/s', rps, setRps, 1, MAX_RPS)}
          {numberField('Duration (s)', durationS, setDurationS)}
          {numberField('Ramp-up (s)', rampUpS, setRampUpS, 0)}
          {numberField('Max VUs', maxVUs, setMaxVUs, 1, MAX_VUS)}
        </>}
        {numberField('Timeout (ms)', timeoutMs, setTimeoutMs, 100)}
        <label className="ltd-check ltd-gate-toggle"><input type="checkbox" disabled={loading} checked={gatesEnabled} onChange={(event) => setGatesEnabled(event.target.checked)} /> Evaluate SLO thresholds</label>
        {gatesEnabled && <>
          {numberField('p95 ≤ ms (0 off)', maxP95Ms, setMaxP95Ms, 0)}
          {numberField('Errors ≤ %', maxErrorPct, setMaxErrorPct, 0, 100)}
          {numberField('Min req/s (0 off)', minRps, setMinRps, 0)}
          <label className="ltd-check"><input type="checkbox" disabled={loading} checked={abortOnFail} onChange={(event) => setAbortOnFail(event.target.checked)} /> Stop as soon as p95 or errors break (last 10 s)</label>
        </>}
        {loading
          ? <button type="button" className="ltd-run" data-running onClick={() => runRef.current?.stop()}><Square size={11} /> <span className="ltd-run-label">Stop</span></button>
          : <button type="button" className="ltd-run" onClick={() => void handleRun()} disabled={!resolvedUrl || Boolean(unresolved)}><Play size={14} fill="currentColor" /><span className="ltd-run-label">Start test</span></button>}
      </div>
      <div className="ltd-plan-summary"><strong>Request context included</strong><p>Uses the active request’s authentication, headers, variables, cookies and TLS settings.</p><strong>Local execution</strong><p>Results stay on this machine. Save a scenario to repeat the same workload.</p></div>
      </aside>

      <div className="ltd-body">
        {unresolved && <div className="ltd-note" data-tone="warn">The URL still contains <b>{unresolved}</b>: that variable has no value (is the service or environment running?), so requests will fail.</div>}
        {error && <div className="ltd-note" data-tone="error">{error}</div>}
        {!result && !loading && !error && <div className="ltd-welcome"><div className="ltd-welcome-icon"><Activity size={36} strokeWidth={1.3} /></div><h2>Find your API’s limits.</h2><p>Choose how traffic arrives, set the workload, then watch latency, throughput and failures together.</p><div className="ltd-welcome-steps"><span><b>1</b> Configure workload</span><span><b>2</b> Run locally</span><span><b>3</b> Inspect & compare</span></div></div>}
        {loading && <LiveProgress progress={progress} timeline={liveTimeline} />}

        {result && (
          <>
            {(resultGated || Boolean(result.gateFailures?.length)) && <div className="ltd-verdict" data-failed={Boolean(result.gateFailures?.length) || !result.totalRequests}><strong>{result.gateFailures?.length ? 'SLO thresholds failed' : result.totalRequests ? 'SLO thresholds passed' : 'No measured requests'}</strong>{result.gateFailures?.map((failure) => <p key={failure}>{failure}</p>)}</div>}
            {(result.droppedIterations ?? 0) > 0 && <div className="ltd-note" data-tone="warn"><b>{result.droppedIterations}</b> requests were not sent: all {result.maxVUs} VUs were busy. The server could not keep up with the rate, or the VU pool is too small.</div>}
            {(result.schedulerLagP99Ms ?? 0) > 10 && <div className="ltd-note" data-tone="warn">Requests started up to {result.schedulerLagP99Ms?.toFixed(0)} ms late (p99): this machine is saturated, so the latencies include its own delay. Lower the rate or the VUs.</div>}
            {result.abortReason
              ? <div className="ltd-note" data-tone="error">Stopped by a threshold: {result.abortReason}. These are the results up to the stop.</div>
              : result.aborted && <div className="ltd-note" data-tone="warn">Stopped before the end: these are the results up to the stop.</div>}
            {result.manifest?.saturated && <div className="ltd-note" data-tone="warn">This machine was saturated during the run: treat these latencies as unreliable.</div>}
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
                  { label: 'Peak VUs', value: String(result.maxVUs ?? 0), bad: false },
                  ...(mode === 'rate' ? [{ label: 'Dropped', value: String(result.droppedIterations ?? 0), bad: (result.droppedIterations ?? 0) > 0 }] : []),
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

            {result.errorGroups && result.errorGroups.length > 0 && (
              <div className="ltd-section">
                <div className="ltd-section-head">Errors</div>
                {result.errorGroups.map((g) => (
                  <div key={`${g.code}:${g.message}`} className="ltd-error-row">
                    <b>{g.code}</b><span title={g.message}>{g.message}</span><span>×{g.count}</span>
                  </div>
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

            <LoadTestInspector key={result.startedAt ?? result.totalRequests} result={result} />

            <div className="ltd-section ltd-row">
              <span className="ltd-label">Export</span>
              <button type="button" className="ltd-btn" onClick={() => void exportReport('json')}><FileJson size={12} /> JSON</button>
              <button type="button" className="ltd-btn" onClick={() => void exportReport('html')}><Download size={12} /> HTML</button>
              <button type="button" className="ltd-btn" onClick={() => void exportReport('md')}><Download size={12} /> Markdown</button>
              <button type="button" className="ltd-btn" onClick={() => void exportReport('junit')}><Download size={12} /> JUnit</button>
              <button type="button" className="ltd-btn" onClick={() => void exportReport('csv')}><Download size={12} /> CSV steps</button>
              <button type="button" className="ltd-btn" onClick={() => void exportReport('samples')}><Download size={12} /> CSV requests</button>
              <button type="button" className="ltd-btn" onClick={() => { setBaseline(result); setComparison(null) }}>Use as baseline</button>
              {result.warmupSkipped ? <span className="ltd-label">{result.warmupSkipped} warmup excluded</span> : null}
            </div>

            {result.manifest && (
              <p className="ltd-hint" title={result.manifest.scenarioHash}>
                Run conditions: seed {result.manifest.seed} · scenario {result.manifest.scenarioHash.slice(0, 12)} · adOmnia {result.manifest.appVersion} · {result.manifest.os}/{result.manifest.arch}, {result.manifest.cpus} CPU
              </p>
            )}

            {baseline && (
              <div className="ltd-section">
                <div className="ltd-section-head">Baseline</div>
                <div className="ltd-row">
                  <span style={{ fontSize: 12 }}>{baseline.totalRequests} requests · p95 {baseline.p95Ms.toFixed(1)}ms · {baseline.startedAt ? new Date(baseline.startedAt).toLocaleString() : ''}</span>
                  <button type="button" className="ltd-btn" disabled={baseline === result} onClick={() => void compareWithBaseline()}>Compare current</button>
                </div>
                {comparison && <ComparisonView comparison={comparison} />}
              </div>
            )}
          </>
        )}

        {notice && <div className="ltd-note">{notice}</div>}

        <details className="ltd-section ltd-details">
          <summary className="ltd-section-head">Scenarios ({scenarios.length + files.length})</summary>
          <div className="ltd-row">
            <input className="ltd-text" aria-label="Scenario name" value={scenarioName} onChange={(e) => setScenarioName(e.target.value)} placeholder="Name this test plan" />
            <button type="button" className="ltd-btn" onClick={() => void saveScenario()} disabled={!scenarioName.trim()} title="Saved on this machine">Save</button>
            <button type="button" className="ltd-btn" onClick={() => void saveToWorkspace()} title="A .loadtest.json file to commit and run in CI">Save to workspace</button>
          </div>
          {scenarios.length > 0 && <div className="ltd-row" style={{ marginTop: 8 }}>{scenarios.map((name) => <button key={name} type="button" className="ltd-btn" disabled={loading} onClick={() => void loadScenario(name)}>{name}</button>)}</div>}
          <div className="ltd-row" style={{ marginTop: 8 }}>
            <span className="ltd-label" title={folder}>Workspace files {folder ? `· ${folder}` : ''}</span>
            <button type="button" className="ltd-icon" onClick={() => void chooseFolder()} aria-label="Choose the workspace folder"><FolderOpen size={12} /></button>
          </div>
          {files.map((entry) => (
            <div key={entry.path} className="ltd-saved">
              <div style={{ flex: 1, minWidth: 0 }} title={entry.error || entry.path}>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</div>
                <div style={{ color: entry.error ? 'var(--color-error)' : 'var(--color-text-4)', fontFamily: 'var(--font-mono)' }}>{entry.error || entry.target}</div>
              </div>
              <button type="button" className="ltd-btn" disabled={loading || Boolean(entry.error)} onClick={() => void runFile(entry)}>Run</button>
            </div>
          ))}
        </details>

        <LoadTestHistory refreshKey={historyKey} targetLabel={targetLabel} disabled={loading} onOpen={(saved) => { setResult(saved); setResultGated(Boolean(saved.gateFailures)); setComparison(null) }} />
      </div>
      </div>
    </div>
  )
}

function LiveProgress({ progress, timeline }: { progress: LoadTestProgress | null; timeline: ThroughputBucket[] }) {
  const liveCanvasRef = useRef<HTMLCanvasElement>(null)
  if (!progress) return <div className="ltd-empty">Starting…</div>
  const cells = [
    ['Elapsed', `${progress.elapsedS.toFixed(0)}s`],
    ['VUs', String(progress.vus)],
    ['Sent', String(progress.sent)],
    ['req/s', progress.rps.toFixed(0)],
    ['p95 (1s)', `${progress.p95Ms.toFixed(1)}ms`],
    ['Errors', `${progress.errorRate.toFixed(1)}%`],
    ...(progress.dropped ? [['Dropped', String(progress.dropped)] as const] : []),
  ]
  return (
    <div className="ltd-section" aria-live="polite">
      <div className="ltd-section-head">{progress.measuring ? 'Running' : 'Warming up (not measured)'}</div>
      <div className="ltd-stats">
        {cells.map(([label, value]) => (
          <div key={label} className="ltd-stat">
            <div className="ltd-stat-value" data-bad={(label === 'Errors' && progress.errorRate > 1) || label === 'Dropped'}>{value}</div>
            <div className="ltd-stat-label">{label}</div>
          </div>
        ))}
      </div>
      {timeline.length > 1 && <div className="ltd-section"><div className="ltd-section-head">Live throughput · req/s</div><ThroughputChart timeline={timeline} canvasRef={liveCanvasRef} /></div>}
    </div>
  )
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}
