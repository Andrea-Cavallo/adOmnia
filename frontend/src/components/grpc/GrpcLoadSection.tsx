/** Load test of the selected rpc on the load testing engine: virtual users, calls or duration, live progress, history. */
import { useEffect, useRef, useState } from 'react'
import { Gauge, Loader2, Square } from 'lucide-react'
import type { RequestItem } from '@/lib/types'
import { grpcCallBody } from '@/lib/grpc/grpcRequest'
import { renderReport, runGrpcLoadTest, type LoadTestProgress, type LoadTestResult, type LoadTestRun } from '@/lib/loadtest-api'
import { MiniButton, NumberField, SectionBlock } from '@/components/websocket/wsUi'
import { LoadTestHistory } from '@/components/loadtest/LoadTestHistory'
import '@/components/loadtest/loadTestDrawer.css'

const MAX_VUS = 2000
const MAX_CALLS = 1_000_000
const MAX_TIMEOUT_MS = 60_000

export function GrpcLoadSection({ request, vars }: { request: RequestItem; vars: Record<string, string> }) {
  const [vus, setVus] = useState(5)
  const [total, setTotal] = useState(100)
  const [durationS, setDurationS] = useState(0)
  const [timeoutMs, setTimeoutMs] = useState(5000)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<LoadTestProgress | null>(null)
  const [result, setResult] = useState<LoadTestResult | null>(null)
  const [historyKey, setHistoryKey] = useState(0)
  const runRef = useRef<LoadTestRun | null>(null)
  useEffect(() => () => runRef.current?.stop(), [])

  const run = async () => {
    setRunning(true); setError(''); setResult(null); setProgress(null)
    try {
      const body = grpcCallBody(request, vars)
      const workload = durationS > 0 ? { executor: 'vus', vus, durationS } : { executor: 'vus', vus, iterations: total }
      const current = runGrpcLoadTest({ ...body, timeout_ms: timeoutMs }, workload, setProgress, request.name || `${body.service}/${body.method}`)
      runRef.current = current
      setResult(await current.result)
      setHistoryKey((n) => n + 1)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      runRef.current = null
      setRunning(false)
    }
  }

  const exportHtml = async () => {
    if (!result) return
    try {
      const url = URL.createObjectURL(new Blob([await renderReport(result, 'html')], { type: 'text/html' }))
      const a = document.createElement('a')
      a.href = url; a.download = `grpc-loadtest-${Date.now()}.html`; a.click()
      URL.revokeObjectURL(url)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }

  const metrics: Array<[string, string]> = result ? [
    ['Calls', `${result.successful}/${result.successful + result.failed} ok`], ['Error rate', `${result.errorRate}%`], ['Throughput', `${result.throughput}/s`],
    ['p50', `${result.p50Ms} ms`], ['p95', `${result.p95Ms} ms`], ['p99', `${result.p99Ms} ms`], ['Max', `${result.maxMs} ms`], ['Peak VUs', String(result.maxVUs ?? vus)],
  ] : []
  const action = running
    ? <MiniButton onClick={() => runRef.current?.stop()}><Square size={12} /> Stop</MiniButton>
    : <MiniButton onClick={() => void run()}><Gauge size={12} /> Run</MiniButton>
  return (
    <SectionBlock title="Load test" hint="Virtual users call the selected rpc with the current message, metadata and schema, on the same engine as HTTP load tests. Streams send their whole message list per call." right={action}>
      <div className="flex flex-wrap items-center gap-4">
        <NumberField label="Virtual users" value={vus} max={MAX_VUS} onChange={setVus} />
        <NumberField label="Calls" value={total} max={MAX_CALLS} onChange={setTotal} />
        <NumberField label="or duration" min={0} value={durationS} max={86_400} onChange={setDurationS} suffix="s" />
        <NumberField label="Timeout" min={100} value={timeoutMs} max={MAX_TIMEOUT_MS} onChange={setTimeoutMs} suffix="ms" />
      </div>
      {running && (
        <p className="mt-2 flex items-center gap-2 font-mono text-[11px] text-text-3" aria-live="polite">
          <Loader2 size={12} className="animate-spin" />
          {progress ? `${progress.elapsedS.toFixed(0)}s · ${progress.vus} VUs · ${progress.sent} calls · ${progress.rps.toFixed(0)}/s · p95 ${progress.p95Ms.toFixed(1)} ms · ${progress.errorRate.toFixed(1)}% errors` : 'Starting…'}
        </p>
      )}
      {error && <p className="mt-2 whitespace-pre-wrap font-mono text-[11px] text-error">{error}</p>}
      {result && (
        <>
          {result.aborted && <p className="mt-2 text-[11px] text-warning">Stopped before the end: these are the results up to the stop.</p>}
          <dl className="mt-3 grid grid-cols-4 gap-2">
            {metrics.map(([label, value]) => (
              <div key={label} className="rounded border border-border-2 bg-surface-0 px-2 py-1.5">
                <dt className="text-[10px] uppercase tracking-wide text-text-4">{label}</dt>
                <dd className="font-mono text-[12px] text-text-1">{value}</dd>
              </div>
            ))}
          </dl>
          {(result.errorGroups?.length ?? 0) > 0 && (
            <ul className="mt-2 space-y-0.5 font-mono text-[11px] text-text-3">
              {result.errorGroups?.map((g) => <li key={`${g.code}:${g.message}`}><b className="text-error">{g.code}</b> ×{g.count} — {g.message}</li>)}
            </ul>
          )}
          <div className="mt-2"><MiniButton onClick={() => void exportHtml()}>Export HTML report</MiniButton></div>
        </>
      )}
      <LoadTestHistory refreshKey={historyKey} targetLabel={(() => { try { const b = grpcCallBody(request, vars); return `${b.service}/${b.method}` } catch { return undefined } })()} onOpen={(saved) => setResult(saved)} disabled={running} />
    </SectionBlock>
  )
}
