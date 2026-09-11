import type { StressRun } from '@/lib/flowStress'
import type { StressSample, StressStats } from '@/lib/flowStressStats'

const CSV_COLUMNS = ['t_ms', 'vu', 'iteration', 'step', 'status', 'http_status', 'latency_ms', 'step_ms', 'bytes', 'error'] as const

function csvCell(value: string | number | undefined): string {
  if (value === undefined) return ''
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function stressCsv(samples: StressSample[]): string {
  const rows = samples.map((s) => [s.t, s.vu, s.iteration, s.step, s.status, s.httpStatus, s.latencyMs, s.stepMs, s.bytes, s.error].map(csvCell).join(','))
  return [CSV_COLUMNS.join(','), ...rows].join('\r\n') + '\r\n'
}

export function stressJson(run: StressRun, flowName: string): string {
  return JSON.stringify({ format: 'adomnia-flow-stress', version: 1, flowName, ...run }, null, 2)
}

export function stressFileName(flowName: string, startedAt: string, ext: 'csv' | 'json' | 'html'): string {
  const slug = flowName.trim().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'flow'
  return `${slug}-stress-${startedAt.slice(0, 19).replace(/[:T]/g, '-')}.${ext}`
}

export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** SVG polyline points for requests/s over time. */
export function sparklinePoints(timeline: StressStats['timeline'], width: number, height: number, key: 'requests' | 'errors' = 'requests'): string {
  if (timeline.length === 0) return ''
  const peak = Math.max(1, ...timeline.map((point) => point.requests))
  const step = timeline.length > 1 ? width / (timeline.length - 1) : 0
  return timeline.map((point, i) => `${Math.round(i * step * 10) / 10},${Math.round((height - (point[key] / peak) * height) * 10) / 10}`).join(' ')
}

export function stressHtml(run: StressRun, flowName: string): string {
  const { stats, config } = run
  const name = escapeHtml(flowName)
  const load = config.mode === 'iterations' ? `${config.iterations} iterations` : `${config.durationS}s`
  const cards = [
    ['Requests', String(stats.totalRequests)],
    ['Errors', `${stats.totalErrors} (${stats.totalRequests ? Math.round((stats.totalErrors / stats.totalRequests) * 1000) / 10 : 0}%)`],
    ['Throughput', `${stats.rps} req/s`],
    ['Iterations', `${stats.iterationsOk} ok · ${stats.iterationsFailed} failed`],
    ['Duration', `${Math.round(stats.elapsedMs / 100) / 10}s`],
    ['Slowest step', stats.slowestStep ?? '-'],
  ].map(([label, value]) => `<div class="card"><span>${label}</span><b>${escapeHtml(value)}</b></div>`).join('')
  const rows = stats.steps.map((step) => `<tr><td>${escapeHtml(step.step)}</td><td>${step.count}</td><td>${step.min}</td><td>${step.avg}</td><td>${step.p50}</td><td>${step.p90}</td><td>${step.p95}</td><td>${step.p99}</td><td>${step.max}</td><td class="${step.errors ? 'bad' : ''}">${step.errorPct}%</td><td>${escapeHtml(Object.entries(step.statuses).map(([code, n]) => `${code}×${n}`).join(' '))}</td></tr>`).join('')
  const chart = stats.timeline.length > 1
    ? `<svg viewBox="0 0 600 120" preserveAspectRatio="none" role="img" aria-label="Requests per second"><polyline fill="none" stroke="var(--accent)" stroke-width="2" points="${sparklinePoints(stats.timeline, 600, 110)}"/><polyline fill="none" stroke="var(--bad)" stroke-width="1.5" points="${sparklinePoints(stats.timeline, 600, 110, 'errors')}"/></svg>`
    : '<p class="muted">Run too short for a timeline.</p>'

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name} — stress test</title>
<style>
:root{--bg:#f7f7f5;--fg:#1c1c1e;--muted:#6b6b70;--line:#e2e2de;--card:#fff;--accent:#5b5bd6;--bad:#d4403a}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--fg:#ececef;--muted:#9a9aa2;--line:#2a2a2e;--card:#1c1c1f;--accent:#8b8bf5;--bad:#f0645e}}
body{margin:0;padding:32px 20px;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif}
main{max-width:1100px;margin:0 auto}h1{margin:0 0 4px;font-size:22px}.muted{color:var(--muted)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin:20px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}.card span{display:block;color:var(--muted);font-size:12px}.card b{font-size:17px}
.scroll{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:10px}
table{border-collapse:collapse;width:100%;font:12px ui-monospace,monospace}th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}
th:first-child,td:first-child,th:last-child,td:last-child{text-align:left}th{color:var(--muted);font-weight:600}.bad{color:var(--bad);font-weight:600}
svg{width:100%;height:120px;background:var(--card);border:1px solid var(--line);border-radius:10px}
</style></head><body><main>
<h1>${name} — stress test</h1>
<p class="muted">${escapeHtml(run.startedAt)} · ${config.vus} virtual users · ramp-up ${config.rampUpS}s · ${load} · think time ${config.thinkTimeMs}ms · ${run.status}${run.truncated ? ' · raw samples truncated' : ''}</p>
<div class="cards">${cards}</div>
<h2>Throughput</h2><p class="muted">Requests per second (accent) and errors per second (red).</p>${chart}
<h2>Steps</h2><p class="muted">Latency in ms, measured by the HTTP executor.</p>
<div class="scroll"><table><thead><tr><th>Step</th><th>Count</th><th>Min</th><th>Avg</th><th>p50</th><th>p90</th><th>p95</th><th>p99</th><th>Max</th><th>Errors</th><th>Status codes</th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="muted">Generated by adOmnia.</p>
</main></body></html>
`
}
