import { useEffect } from 'react'

export interface ThroughputBucket { second: number; reqs: number; avgMs: number }

export interface TimelinePoint {
  startMs?: number
  timeMs: number
  latencyMs: number
  status: number
  ok: boolean
  error?: string
}

export interface LoadTestResult {
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
  timeline?: TimelinePoint[]
  throughputTimeline?: ThroughputBucket[]
  warmupSkipped?: number
}

function drawThroughputChart(canvas: HTMLCanvasElement, timeline: ThroughputBucket[]) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const style = getComputedStyle(canvas)
  const accent = style.getPropertyValue('--color-accent').trim() || '#ffffff'
  const grid = style.getPropertyValue('--color-border-1').trim() || '#242424'
  const ink = style.getPropertyValue('--color-text-4').trim() || '#777777'
  const W = canvas.width
  const H = canvas.height
  const pad = { top: 10, right: 10, bottom: 18, left: 38 }
  const maxReqs = Math.max(...timeline.map((b) => b.reqs), 1)
  const areaW = W - pad.left - pad.right
  const areaH = H - pad.top - pad.bottom
  const barW = areaW / timeline.length

  ctx.clearRect(0, 0, W, H)
  ctx.strokeStyle = grid
  ctx.lineWidth = 1
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + areaH * (i / 4)
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke()
  }
  ctx.fillStyle = accent
  timeline.forEach((b, i) => {
    const barH = Math.max(2, (b.reqs / maxReqs) * areaH)
    ctx.fillRect(pad.left + i * barW + 0.5, H - pad.bottom - barH, Math.max(barW - 2, 1), barH)
  })
  ctx.fillStyle = ink
  ctx.font = '9px monospace'
  ctx.textAlign = 'right'
  ctx.fillText(String(maxReqs), pad.left - 3, pad.top + 9)
  ctx.fillText('0', pad.left - 3, H - pad.bottom - 1)
  ctx.textAlign = 'left'
  ctx.fillText('0s', pad.left, H - 2)
  ctx.textAlign = 'right'
  ctx.fillText(`${timeline[timeline.length - 1].second}s`, W - pad.right, H - 2)
}

export function ThroughputChart({ timeline, canvasRef }: { timeline: ThroughputBucket[]; canvasRef: React.RefObject<HTMLCanvasElement | null> }) {
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas && timeline.length > 0) drawThroughputChart(canvas, timeline)
  }, [timeline, canvasRef])
  return <canvas ref={canvasRef} width={640} height={90} style={{ width: '100%', height: 90 }} />
}

export function PercentileRow({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className="ltd-pct">
      <span className="ltd-pct-label">{label}</span>
      <div className="ltd-pct-track"><div className="ltd-pct-fill" style={{ width: `${Math.max(2, (value / max) * 100)}%` }} /></div>
      <span>{value.toFixed(1)}ms</span>
    </div>
  )
}

/** One row per request: when it left, how long it took, what came back. Shows races and gaps at a glance. */
export function Waterfall({ timeline }: { timeline: TimelinePoint[] }) {
  const rows = [...timeline].sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0))
  const end = Math.max(...rows.map((r) => (r.startMs ?? 0) + r.latencyMs), 1)
  return (
    <div>
      {rows.map((row, index) => {
        const start = row.startMs ?? 0
        return (
          <div key={index} className="ltd-wf-row">
            <span className="ltd-wf-idx">#{index + 1}</span>
            <span className="ltd-wf-start">+{start.toFixed(0)}ms</span>
            <div className="ltd-wf-track">
              <div className="ltd-wf-bar" data-ok={row.ok} style={{ left: `${(start / end) * 100}%`, width: `${Math.max(0.5, (row.latencyMs / end) * 100)}%` }} />
            </div>
            <span className="ltd-wf-ms">{row.latencyMs.toFixed(1)}ms</span>
            <span className="ltd-wf-code" data-ok={row.ok}>{row.status || 'ERR'}</span>
            {row.error && <span className="ltd-wf-err">{row.error}</span>}
          </div>
        )
      })}
    </div>
  )
}
