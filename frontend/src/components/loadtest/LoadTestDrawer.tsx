import { useState, useEffect, useRef } from 'react'
import { X, Gauge, Play, Download, FileJson } from 'lucide-react'
import type { RequestItem } from '@/lib/types'
import { useServerPort, serverUrl, sidecarFetch } from '@/lib/useServerPort'
import { substVars } from '@/lib/substVars'
import { useEnvironmentsStore } from '@/stores/environments'

interface ThroughputBucket { second: number; reqs: number; avgMs: number }

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

const METHOD_COLOR: Record<string, string> = {
  GET: '#22c55e', POST: '#f59e0b', PUT: '#3b82f6',
  PATCH: '#a855f7', DELETE: '#ef4444', HEAD: '#6b7280', OPTIONS: '#6b7280',
}

function drawThroughputChart(
  canvas: HTMLCanvasElement,
  timeline: ThroughputBucket[],
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const W = canvas.width
  const H = canvas.height
  const pad = { top: 10, right: 10, bottom: 18, left: 38 }
  const maxReqs = Math.max(...timeline.map((b) => b.reqs), 1)
  const areaW = W - pad.left - pad.right
  const areaH = H - pad.top - pad.bottom
  const barW = areaW / timeline.length

  ctx.clearRect(0, 0, W, H)

  // background
  ctx.fillStyle = '#0f0f1a'
  ctx.fillRect(0, 0, W, H)

  // grid
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'
  ctx.lineWidth = 1
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + areaH * (i / 4)
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke()
  }

  // bars
  const grad = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom)
  grad.addColorStop(0, 'rgba(99,102,241,0.95)')
  grad.addColorStop(1, 'rgba(99,102,241,0.35)')
  ctx.fillStyle = grad

  timeline.forEach((b, i) => {
    const barH = Math.max(2, (b.reqs / maxReqs) * areaH)
    const x = pad.left + i * barW
    const y = H - pad.bottom - barH
    const bw = Math.max(barW - 1, 1)
    ctx.beginPath(); ctx.rect(x + 0.5, y, bw, barH); ctx.fill()
  })

  // axis labels
  ctx.fillStyle = 'rgba(255,255,255,0.28)'
  ctx.font = '9px monospace'
  ctx.textAlign = 'right'
  ctx.fillText(String(maxReqs), pad.left - 3, pad.top + 9)
  ctx.fillText('0', pad.left - 3, H - pad.bottom - 1)
  ctx.textAlign = 'left'
  ctx.fillText('0s', pad.left, H - 2)
  ctx.textAlign = 'right'
  ctx.fillText(`${timeline[timeline.length - 1].second}s`, W - pad.right, H - 2)
}

function ThroughputChart({
  timeline,
  canvasRef,
}: {
  timeline: ThroughputBucket[]
  canvasRef: React.RefObject<HTMLCanvasElement>
}) {
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || timeline.length === 0) return
    drawThroughputChart(canvas, timeline)
  }, [timeline, canvasRef])

  return (
    <canvas
      ref={canvasRef}
      width={640}
      height={90}
      style={{ width: '100%', height: '90px' }}
      className="rounded"
    />
  )
}

function PercentileBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.max(3, (value / max) * 100)
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 text-right text-[10px] text-text-4 font-mono">{label}</span>
      <div className="relative flex-1 h-5 bg-surface-2 rounded overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 bg-accent/40 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
        <span className="absolute inset-0 flex items-center pl-2 text-[10px] font-mono text-text-1">
          {value.toFixed(1)}ms
        </span>
      </div>
    </div>
  )
}

interface LoadTestDrawerProps {
  request: RequestItem
  onClose: () => void
}

export function LoadTestDrawer({ request, onClose }: LoadTestDrawerProps) {
  const port = useServerPort()
  const getResolvedVars = useEnvironmentsStore((s) => s.getResolvedVars)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [concurrency, setConcurrency] = useState(10)
  const [totalReqs, setTotalReqs] = useState(100)
  const [durationS, setDurationS] = useState(30)
  const [useDuration, setUseDuration] = useState(false)
  const [timeoutMs, setTimeoutMs] = useState(5000)
  const [warmupReqs, setWarmupReqs] = useState(5)

  const [result, setResult] = useState<LoadTestResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState('')

  const vars = getResolvedVars()
  const resolvedUrl = substVars(request.url, vars)

  const handleRun = async () => {
    const apiUrl = serverUrl(port, '/loadtest')
    if (!apiUrl) { setError('Backend not ready'); return }
    if (!resolvedUrl) { setError('URL is empty'); return }
    setLoading(true); setError(''); setResult(null)
    setProgress(useDuration ? `Running for ${durationS}s…` : `Running ${totalReqs} requests…`)
    try {
      const headersObj = Object.fromEntries(
        request.headers
          .filter((h) => h.enabled && h.key)
          .map((h) => [h.key, substVars(h.value, vars)])
      )
      const activeBody = request.bodies[request.activeBodyIdx]
      const body = activeBody?.type !== 'none' ? activeBody?.raw : undefined
      const payload: Record<string, unknown> = {
        url: resolvedUrl,
        method: request.method,
        concurrency,
        timeoutMs,
        headers: headersObj,
        body: body || undefined,
        warmupReqs: warmupReqs || undefined,
      }
      if (useDuration) payload.durationS = durationS
      else payload.totalReqs = totalReqs

      const res = await sidecarFetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (res.ok) setResult(data)
      else setError(data.error || 'Load test failed')
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false); setProgress('')
    }
  }

  const exportJson = () => {
    if (!result) return
    const payload = {
      request: { url: resolvedUrl, method: request.method },
      config: { concurrency, timeoutMs, ...(useDuration ? { durationS } : { totalReqs }), warmupReqs },
      result,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    triggerDownload(blob, `loadtest-${Date.now()}.json`)
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
      ['error_rate_pct', (result.errorRate * 100).toFixed(2)],
    ]
    const csv = ['metric,value', ...rows.map((r) => r.join(','))].join('\n')
    triggerDownload(new Blob([csv], { type: 'text/csv' }), `loadtest-${Date.now()}.csv`)
  }

  const exportChartPng = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.toBlob((blob) => {
      if (blob) triggerDownload(blob, `loadtest-chart-${Date.now()}.png`)
    }, 'image/png')
  }

  const maxP = result
    ? Math.max(result.p50Ms, result.p75Ms, result.p90Ms, result.p95Ms, result.p99Ms, result.p999Ms, 1)
    : 1

  const methodColor = METHOD_COLOR[request.method] ?? '#6b7280'

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-1 bg-surface-1 flex-shrink-0">
        <Gauge size={13} className="text-accent flex-shrink-0" />
        <span className="text-xs font-semibold text-text-1">Load Test</span>
        <span className="text-[10px] font-mono font-bold ml-1" style={{ color: methodColor }}>
          {request.method}
        </span>
        <span className="text-[10px] text-text-3 font-mono truncate flex-1 ml-0.5">
          {resolvedUrl || request.url || '—'}
        </span>
        <button onClick={onClose} className="p-1 text-text-4 hover:text-text-1 rounded flex-shrink-0">
          <X size={13} />
        </button>
      </div>

      {/* Config row */}
      <div className="flex flex-wrap items-end gap-3 px-4 py-3 border-b border-border-1 bg-surface-1 flex-shrink-0">
        <label className="flex flex-col gap-1">
          <span className="text-[9px] text-text-4 uppercase tracking-wider">Concurrency</span>
          <input
            type="number" value={concurrency} min={1} max={500} disabled={loading}
            onChange={(e) => setConcurrency(Number(e.target.value))}
            className="w-18 h-6 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none focus:border-accent disabled:opacity-50"
          />
        </label>

        <label className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-text-4 uppercase tracking-wider">
              {useDuration ? 'Duration (s)' : 'Requests'}
            </span>
            <button
              onClick={() => setUseDuration(!useDuration)}
              className="text-[9px] text-accent hover:opacity-70 underline underline-offset-1"
            >
              {useDuration ? '→ count' : '→ time'}
            </button>
          </div>
          {useDuration ? (
            <input
              type="number" value={durationS} min={1} disabled={loading}
              onChange={(e) => setDurationS(Number(e.target.value))}
              className="w-20 h-6 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none focus:border-accent disabled:opacity-50"
            />
          ) : (
            <input
              type="number" value={totalReqs} min={1} disabled={loading}
              onChange={(e) => setTotalReqs(Number(e.target.value))}
              className="w-20 h-6 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none focus:border-accent disabled:opacity-50"
            />
          )}
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[9px] text-text-4 uppercase tracking-wider">Timeout (ms)</span>
          <input
            type="number" value={timeoutMs} min={100} disabled={loading}
            onChange={(e) => setTimeoutMs(Number(e.target.value))}
            className="w-22 h-6 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none focus:border-accent disabled:opacity-50"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[9px] text-text-4 uppercase tracking-wider">Warmup</span>
          <input
            type="number" value={warmupReqs} min={0} disabled={loading}
            onChange={(e) => setWarmupReqs(Number(e.target.value))}
            className="w-16 h-6 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none focus:border-accent disabled:opacity-50"
          />
        </label>

        <button
          onClick={handleRun}
          disabled={loading || !port || !resolvedUrl}
          className="h-6 px-4 flex items-center gap-1.5 bg-accent text-white rounded text-xs font-medium disabled:opacity-40 hover:bg-accent-hover transition-colors"
        >
          <Play size={10} fill="currentColor" />
          {loading ? 'Running…' : 'Run'}
        </button>

        {progress && (
          <span className="text-[10px] text-text-3 animate-pulse ml-1">{progress}</span>
        )}
        {error && (
          <span className="text-[10px] text-error ml-1">{error}</span>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        {!result && !loading && (
          <div className="flex-1 flex items-center justify-center text-xs text-text-4">
            Configure and run a load test against this request.
          </div>
        )}

        {result && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Total', value: result.totalRequests.toString(), bad: false },
                { label: 'Success', value: result.successful.toString(), bad: false },
                { label: 'Failed', value: result.failed.toString(), bad: result.failed > 0 },
                { label: 'Throughput', value: `${result.throughput.toFixed(1)} req/s`, bad: false },
                { label: 'Avg', value: `${result.avgMs.toFixed(1)}ms`, bad: false },
                { label: 'Min', value: `${result.minMs.toFixed(1)}ms`, bad: false },
                { label: 'Max', value: `${result.maxMs.toFixed(1)}ms`, bad: false },
                { label: 'Error %', value: `${(result.errorRate * 100).toFixed(1)}%`, bad: result.errorRate > 0.01 },
              ].map(({ label, value, bad }) => (
                <div key={label} className="bg-surface-1 border border-border-1 rounded p-2">
                  <div className="text-[9px] text-text-4 uppercase tracking-wider">{label}</div>
                  <div className={`text-xs font-mono mt-0.5 font-semibold ${bad ? 'text-error' : 'text-text-1'}`}>
                    {value}
                  </div>
                </div>
              ))}
            </div>

            {/* Throughput timeline */}
            {result.throughputTimeline && result.throughputTimeline.length > 0 && (
              <div className="bg-surface-1 border border-border-1 rounded p-3">
                <div className="text-[9px] text-text-4 uppercase tracking-wider mb-2">Throughput req/s</div>
                <ThroughputChart timeline={result.throughputTimeline} canvasRef={canvasRef} />
              </div>
            )}

            {/* Percentiles */}
            <div className="bg-surface-1 border border-border-1 rounded p-3">
              <div className="text-[9px] text-text-4 uppercase tracking-wider mb-2">Latency Percentiles</div>
              <div className="flex flex-col gap-1.5">
                {[
                  { label: 'p50', value: result.p50Ms },
                  { label: 'p75', value: result.p75Ms },
                  { label: 'p90', value: result.p90Ms },
                  { label: 'p95', value: result.p95Ms },
                  { label: 'p99', value: result.p99Ms },
                  { label: 'p99.9', value: result.p999Ms },
                ].map(({ label, value }) => (
                  <PercentileBar key={label} label={label} value={value} max={maxP} />
                ))}
              </div>
            </div>

            {/* Status codes */}
            <div className="bg-surface-1 border border-border-1 rounded p-3">
              <div className="text-[9px] text-text-4 uppercase tracking-wider mb-2">Status Codes</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(result.statusCodes)
                  .sort()
                  .map(([code, count]) => {
                    const n = Number(code)
                    const color = n < 300 ? 'text-success' : n < 500 ? 'text-warning' : 'text-error'
                    return (
                      <span
                        key={code}
                        className="px-2 py-1 bg-surface-2 rounded text-xs font-mono flex items-center gap-1.5"
                      >
                        <span className={color}>{code}</span>
                        <span className="text-text-4">×{count}</span>
                      </span>
                    )
                  })}
              </div>
            </div>

            {/* Export row */}
            <div className="flex items-center gap-2 pt-1 pb-2">
              <span className="text-[9px] text-text-4 uppercase tracking-wider">Export</span>
              <button
                onClick={exportJson}
                className="flex items-center gap-1 px-2.5 py-1 border border-border-2 rounded text-[10px] text-text-3 hover:text-text-1 hover:border-accent/30 transition-colors"
              >
                <FileJson size={10} /> JSON
              </button>
              <button
                onClick={exportCsv}
                className="flex items-center gap-1 px-2.5 py-1 border border-border-2 rounded text-[10px] text-text-3 hover:text-text-1 hover:border-accent/30 transition-colors"
              >
                <Download size={10} /> CSV
              </button>
              {result.throughputTimeline && result.throughputTimeline.length > 0 && (
                <button
                  onClick={exportChartPng}
                  className="flex items-center gap-1 px-2.5 py-1 border border-border-2 rounded text-[10px] text-text-3 hover:text-text-1 hover:border-accent/30 transition-colors"
                >
                  <Download size={10} /> Chart PNG
                </button>
              )}
              {result.warmupSkipped !== undefined && result.warmupSkipped > 0 && (
                <span className="text-[10px] text-text-4 ml-2">
                  {result.warmupSkipped} warmup reqs excluded
                </span>
              )}
            </div>
          </>
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
