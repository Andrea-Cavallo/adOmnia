import type { FlowStressConfig, StressRun } from '@/lib/flowStress'
import type { FlowGraphDefinition } from '@/lib/flowStorage'
import type { StepStats, StressSample, StressStats } from '@/lib/flowStressStats'
import { analyzeStressRun } from '@/lib/flowStressAnalysis'
import { chartPoints, distributionChartModel, latencyChartModel, timelineChartModel, workloadChartModel } from '@/lib/flowStressCharts'

export interface StressBaseline {
  flowName: string
  startedAt: string
  stats: StressStats
}

/** Reads a previous JSON export; the file is user-supplied, so validate before use. */
export function parseStressJson(text: string): StressBaseline {
  let data: unknown
  try { data = JSON.parse(text) } catch { throw new Error('This file is not valid JSON.') }
  const run = (data ?? {}) as { format?: unknown; version?: unknown; flowName?: unknown; startedAt?: unknown; stats?: Partial<StressStats> }
  if (run.format !== 'adomnia-flow-stress') throw new Error('This file is not an adOmnia flow stress export.')
  if (run.version !== 1) throw new Error(`Unsupported stress export version ${String(run.version)}.`)
  const steps = run.stats?.steps
  const validStep = (step: Partial<StepStats> | null) => Boolean(step) && typeof step?.nodeId === 'string' && typeof step?.step === 'string' && Number.isFinite(step?.p95)
  if (!Array.isArray(steps) || steps.length === 0 || !steps.every(validStep) || !Number.isFinite(run.stats?.rps)) throw new Error('The stress export has no valid statistics.')
  const legacy = run.stats as StressStats
  const statuses = legacy.statuses ?? (steps as StepStats[]).reduce<Record<string, number>>((all, step) => {
    Object.entries(step.statuses ?? {}).forEach(([code, count]) => { all[code] = (all[code] ?? 0) + count })
    return all
  }, {})
  const weightedAvg = (steps as StepStats[]).reduce((total, step) => total + step.avg * step.count, 0) / Math.max(1, (steps as StepStats[]).reduce((total, step) => total + step.count, 0))
  const overall = legacy.overall ?? {
    min: Math.min(...(steps as StepStats[]).map((step) => step.min)),
    avg: Math.round(weightedAvg * 10) / 10,
    p50: Math.max(...(steps as StepStats[]).map((step) => step.p50)),
    p90: Math.max(...(steps as StepStats[]).map((step) => step.p90)),
    p95: Math.max(...(steps as StepStats[]).map((step) => step.p95)),
    p99: Math.max(...(steps as StepStats[]).map((step) => step.p99)),
    max: Math.max(...(steps as StepStats[]).map((step) => step.max)),
  }
  return {
    flowName: typeof run.flowName === 'string' ? run.flowName : '',
    startedAt: typeof run.startedAt === 'string' ? run.startedAt : '',
    stats: {
      ...legacy,
      bytes: legacy.bytes ?? 0,
      bytesPerSecond: legacy.bytesPerSecond ?? 0,
      excludedRequests: legacy.excludedRequests ?? 0,
      measuredElapsedMs: legacy.measuredElapsedMs ?? legacy.elapsedMs,
      overall,
      statuses,
      errorGroups: legacy.errorGroups ?? [],
      distribution: legacy.distribution ?? [],
      apdex: legacy.apdex ?? { thresholdMs: 500, satisfied: 0, tolerated: 0, frustrated: 0, score: 0 },
      timeline: (legacy.timeline ?? []).map((point) => ({ ...point, activeVus: point.activeVus ?? 0 })),
    },
  }
}

/** Percentage change from base to current; undefined when base is 0. */
export function deltaPct(current: number, base: number): number | undefined {
  if (!base) return undefined
  return Math.round(((current - base) / base) * 1000) / 10
}

/** Same step in the baseline: by node id, falling back to the label for re-created nodes. */
export function baselineStep(baseline: StressStats, step: StepStats): StepStats | undefined {
  return baseline.steps.find((item) => item.nodeId === step.nodeId) ?? baseline.steps.find((item) => item.step === step.step)
}

const CSV_COLUMNS = ['t_ms', 'vu', 'iteration', 'phase', 'measured', 'step', 'status', 'http_status', 'latency_ms', 'step_ms', 'bytes', 'error'] as const

function csvCell(value: string | number | undefined): string {
  if (value === undefined) return ''
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function stressCsv(samples: StressSample[]): string {
  const rows = samples.map((s) => [s.t, s.vu, s.iteration, s.phase, s.measured === false ? 'false' : 'true', s.step, s.status, s.httpStatus, s.latencyMs, s.stepMs, s.bytes, s.error].map(csvCell).join(','))
  return [CSV_COLUMNS.join(','), ...rows].join('\r\n') + '\r\n'
}

export function stressJson(run: StressRun, flowName: string): string {
  return JSON.stringify({
    format: 'adomnia-flow-stress',
    version: 1,
    flowName,
    ...run,
    assessment: analyzeStressRun(run.stats, run.config),
  }, null, 2)
}

export function stressPlanJson(graph: FlowGraphDefinition, config: FlowStressConfig, flowName: string): string {
  return JSON.stringify({ format: 'adomnia-flow-stress-plan', version: 1, flowName, graph, config }, null, 2)
}

export function stressPlanFileName(flowName: string): string {
  const slug = flowName.trim().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'flow'
  return `${slug}.stress.json`
}

export function stressFileName(flowName: string, startedAt: string, ext: 'csv' | 'json' | 'html' | 'xml'): string {
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
const escapeXml = (text: string) => escapeHtml(text).replace(/'/g, '&apos;')

/** CI-ready JUnit evidence. Release gates are test cases and failures produce exit-friendly reports. */
export function stressJUnit(run: StressRun, flowName: string): string {
  const assessment = analyzeStressRun(run.stats, run.config)
  const cases = assessment.checks.map((check) => {
    const detail = `${check.label}: ${check.actual}${check.unit} / ${check.target}${check.unit}`
    return `<testcase classname="adomnia.flow-stress" name="${escapeXml(check.label)}">${check.passed ? '' : `<failure message="${escapeXml(detail)}">${escapeXml(detail)}</failure>`}</testcase>`
  }).join('')
  const failures = assessment.checks.filter((check) => !check.passed).length
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="${escapeXml(flowName)} stress SLOs" tests="${assessment.checks.length}" failures="${failures}" time="${(run.stats.elapsedMs / 1000).toFixed(3)}">${cases}</testsuite>\n`
}

/** SVG polyline points for requests/s over time. */
export function sparklinePoints(timeline: StressStats['timeline'], width: number, height: number, key: 'requests' | 'errors' = 'requests'): string {
  if (timeline.length === 0) return ''
  const peak = Math.max(1, ...timeline.map((point) => point.requests))
  const step = timeline.length > 1 ? width / (timeline.length - 1) : 0
  return timeline.map((point, i) => `${Math.round(i * step * 10) / 10},${Math.round((height - (point[key] / peak) * height) * 10) / 10}`).join(' ')
}

export function stressHtml(run: StressRun, flowName: string): string {
  const { stats, config } = run
  const assessment = analyzeStressRun(stats, config)
  const name = escapeHtml(flowName)
  const load = config.mode === 'iterations' ? `${config.iterations} iterations` : `${config.durationS}s`
  const cards = [
    ['Requests', String(stats.totalRequests)],
    ['Errors', `${stats.totalErrors} (${stats.totalRequests ? Math.round((stats.totalErrors / stats.totalRequests) * 1000) / 10 : 0}%)`],
    ['Throughput', `${stats.rps} req/s`],
    ['Overall p95 / p99', `${stats.overall.p95} / ${stats.overall.p99} ms`],
    ['APDEX', `${stats.apdex.score} (T=${stats.apdex.thresholdMs} ms)`],
    ['SLO verdict', assessment.verdict.toUpperCase()],
    ['Iterations', `${stats.iterationsOk} ok · ${stats.iterationsFailed} failed`],
    ['Duration', `${Math.round(stats.elapsedMs / 100) / 10}s`],
    ['Slowest step', stats.slowestStep ?? '-'],
  ].map(([label, value]) => `<div class="card"><span>${label}</span><b>${escapeHtml(value)}</b></div>`).join('')
  const rows = stats.steps.map((step) => `<tr><td>${escapeHtml(step.step)}</td><td>${step.count}</td><td>${step.min}</td><td>${step.avg}</td><td>${step.p50}</td><td>${step.p90}</td><td>${step.p95}</td><td>${step.p99}</td><td>${step.max}</td><td class="${step.errors ? 'bad' : ''}">${step.errorPct}%</td><td>${escapeHtml(Object.entries(step.statuses).map(([code, n]) => `${code}×${n}`).join(' '))}</td></tr>`).join('')
  const trafficModel = timelineChartModel(stats.timeline)
  const trafficArea = trafficModel.requestPoints.length ? `${trafficModel.plot.left},${trafficModel.plot.top + trafficModel.plot.height} ${chartPoints(trafficModel.requestPoints)} ${trafficModel.plot.left + trafficModel.plot.width},${trafficModel.plot.top + trafficModel.plot.height}` : ''
  const trafficChart = stats.timeline.length > 1 ? `<div class="chart"><div class="chart-head"><div><h2>Traffic over time</h2><p>Completed requests per one-second bucket. Error rate uses the right axis.</p></div><div class="legend"><span><i class="swatch throughput"></i>Throughput · left</span><span><i class="swatch errors"></i>Error rate · right</span></div></div><svg viewBox="0 0 ${trafficModel.width} ${trafficModel.height}" role="img" aria-label="Throughput and error rate over time">
  ${trafficModel.requestTicks.map((tick) => `<line class="gridline" x1="${trafficModel.plot.left}" x2="${trafficModel.plot.left + trafficModel.plot.width}" y1="${tick.y}" y2="${tick.y}"/>`).join('')}
  <polygon points="${trafficArea}" fill="var(--accent-soft)"/><polyline class="traffic-line" points="${chartPoints(trafficModel.requestPoints)}"/><polyline class="error-line" points="${chartPoints(trafficModel.errorRatePoints)}"/>
  ${trafficModel.requestPoints.map((point) => `<circle class="hit" cx="${point.x}" cy="${point.y}" r="7"><title>${escapeHtml(point.label)}</title></circle>`).join('')}
  ${trafficModel.errorRatePoints.map((point) => point.value ? `<circle class="error-dot" cx="${point.x}" cy="${point.y}" r="2.5"><title>${escapeHtml(point.label)}</title></circle>` : '').join('')}
  ${trafficModel.requestTicks.map((tick) => `<text x="${trafficModel.plot.left - 7}" y="${tick.y + 3}" text-anchor="end">${tick.label}</text>`).join('')}
  ${trafficModel.errorTicks.map((tick) => `<text x="${trafficModel.plot.left + trafficModel.plot.width + 7}" y="${tick.y + 3}">${tick.label}</text>`).join('')}
  ${trafficModel.xTicks.map((tick) => `<text x="${tick.x}" y="${trafficModel.height - 8}" text-anchor="middle">${tick.label}</text>`).join('')}
  <text x="8" y="11">req/s</text><text x="${trafficModel.width - 5}" y="11" text-anchor="end">errors</text></svg></div>` : '<p class="muted">Run too short for a traffic timeline.</p>'
  const latencyModel = latencyChartModel(stats.steps, config.maxP95Ms ?? 0)
  const latencyChart = stats.steps.length ? `<div class="chart"><div class="chart-head"><div><h2>Latency by flow step</h2><p>The p95 bar identifies the bottleneck; p50 and p99 show the spread.</p></div><div class="legend"><span><i class="swatch p95"></i>p95</span><span><i class="dot p50"></i>p50</span><span><i class="swatch p99"></i>p99 range</span>${latencyModel.thresholdX === undefined ? '' : '<span><i class="swatch slo"></i>SLO</span>'}</div></div><svg viewBox="0 0 ${latencyModel.width} ${latencyModel.height}" role="img" aria-label="Latency percentiles by flow step">
  ${latencyModel.ticks.map((tick) => `<line class="gridline" x1="${tick.x}" x2="${tick.x}" y1="${latencyModel.plot.top - 5}" y2="${latencyModel.height - latencyModel.plot.bottom}"/><text x="${tick.x}" y="${latencyModel.height - 7}" text-anchor="middle">${tick.label}</text>`).join('')}
  ${latencyModel.rows.map((row) => `<g><text class="step-label" x="${latencyModel.plot.left - 9}" y="${row.y + 3}" text-anchor="end">${escapeHtml(row.step.step.length > 24 ? `${row.step.step.slice(0, 22)}…` : row.step.step)}<title>${escapeHtml(row.step.step)}</title></text><rect class="p99-bar" x="${latencyModel.plot.left}" y="${row.y - 7}" width="${Math.max(1, row.p99X - latencyModel.plot.left)}" height="14" rx="3"/><rect class="p95-bar" x="${latencyModel.plot.left}" y="${row.y - 3}" width="${Math.max(1, row.p95X - latencyModel.plot.left)}" height="6" rx="3"/><circle class="p50-dot" cx="${row.p50X}" cy="${row.y}" r="3"/><rect class="hit" x="${latencyModel.plot.left}" y="${row.y - 12}" width="${latencyModel.plot.width}" height="24"><title>${escapeHtml(`${row.step.step}: p50 ${row.step.p50} ms · p95 ${row.step.p95} ms · p99 ${row.step.p99} ms`)}</title></rect><text class="value-label" x="${Math.min(latencyModel.width - 4, row.p95X + 6)}" y="${row.y + 3}">${row.step.p95}</text></g>`).join('')}
  ${latencyModel.thresholdX === undefined ? '' : `<line class="slo-line" x1="${latencyModel.thresholdX}" x2="${latencyModel.thresholdX}" y1="${latencyModel.plot.top - 8}" y2="${latencyModel.height - latencyModel.plot.bottom}"/><text class="slo-label" x="${latencyModel.thresholdX + 4}" y="11">SLO ${config.maxP95Ms} ms</text>`}</svg></div>` : ''
  const workloadModel = workloadChartModel(stats.timeline)
  const workloadChart = stats.timeline.length > 1 ? `<div class="chart"><div class="chart-head"><div><h2>Active virtual users</h2><p>Actual concurrency shows ramps, spikes and recovery instead of only the configured target.</p></div><div class="legend"><span><i class="swatch vus"></i>Active VUs</span></div></div><svg viewBox="0 0 ${workloadModel.width} ${workloadModel.height}" role="img" aria-label="Active virtual users over time">
  ${workloadModel.ticks.map((tick) => `<line class="gridline" x1="${workloadModel.plot.left}" x2="${workloadModel.plot.left + workloadModel.plot.width}" y1="${tick.y}" y2="${tick.y}"/><text x="${workloadModel.plot.left - 7}" y="${tick.y + 3}" text-anchor="end">${tick.label}</text>`).join('')}
  <polyline class="vu-line" points="${chartPoints(workloadModel.points)}"/>${workloadModel.points.map((point) => `<circle class="hit" cx="${point.x}" cy="${point.y}" r="7"><title>${escapeHtml(point.label)}</title></circle>`).join('')}
  ${workloadModel.xTicks.map((tick) => `<text x="${tick.x}" y="${workloadModel.height - 8}" text-anchor="middle">${tick.label}</text>`).join('')}</svg></div>` : ''
  const distributionModel = distributionChartModel(stats.distribution)
  const distributionChart = stats.distribution.length ? `<div class="chart"><div class="chart-head"><div><h2>Latency distribution</h2><p>Request percentage in each latency band; the overflow band isolates values beyond p99.</p></div><div class="legend">APDEX ${stats.apdex.score} · T=${stats.apdex.thresholdMs} ms</div></div><svg viewBox="0 0 ${distributionModel.width} ${distributionModel.height}" role="img" aria-label="Latency distribution histogram">
  ${distributionModel.ticks.map((tick) => `<line class="gridline" x1="${distributionModel.plot.left}" x2="${distributionModel.plot.left + distributionModel.plot.width}" y1="${tick.y}" y2="${tick.y}"/><text x="${distributionModel.plot.left - 7}" y="${tick.y + 3}" text-anchor="end">${tick.label}</text>`).join('')}
  ${distributionModel.bars.map((bar, index) => `<rect class="distribution-bar${stats.distribution[index]?.overflow ? ' overflow' : ''}" x="${bar.x}" y="${bar.y}" width="${bar.width}" height="${Math.max(1, bar.height)}" rx="2"><title>${escapeHtml(bar.label)}</title></rect><text x="${bar.x + bar.width / 2}" y="${distributionModel.height - 20 + (index % 2) * 9}" text-anchor="middle">${stats.distribution[index]?.overflow ? `&gt;${stats.distribution[index].fromMs}` : stats.distribution[index]?.toMs}</text>`).join('')}</svg></div>` : ''
  const checks = assessment.checks.map((check) => `<li class="${check.passed ? 'good' : 'bad'}">${escapeHtml(check.label)}: ${check.actual}${check.unit} / ${check.target}${check.unit} — ${check.passed ? 'PASS' : 'FAIL'}</li>`).join('')
  const insights = assessment.insights.map((insight) => `<article><b>${escapeHtml(insight.title)}</b><p>${escapeHtml(insight.detail)}</p><p class="muted">Next: ${escapeHtml(insight.action)}</p></article>`).join('')
  const errorGroups = stats.errorGroups.map((group) => `<tr><td>${escapeHtml(group.fingerprint)}</td><td>${group.count}</td><td>${escapeHtml(group.steps.join(', '))}</td><td>${escapeHtml(group.statuses.join(', '))}</td></tr>`).join('')

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name} — stress test</title>
<style>
:root{--bg:#f7f7f5;--fg:#1c1c1e;--muted:#6b6b70;--line:#e2e2de;--card:#fff;--accent:#5b5bd6;--accent-soft:rgba(91,91,214,.13);--bad:#d4403a;--good:#16855b;--bar:#d9d9e2}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--fg:#ececef;--muted:#9a9aa2;--line:#2a2a2e;--card:#1c1c1f;--accent:#8b8bf5;--accent-soft:rgba(139,139,245,.14);--bad:#f0645e;--good:#4fd19b;--bar:#34343d}}
body{margin:0;padding:32px 20px;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif}
main{max-width:1100px;margin:0 auto}h1{margin:0 0 4px;font-size:22px}.muted{color:var(--muted)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin:20px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}.card span{display:block;color:var(--muted);font-size:12px}.card b{font-size:17px}
.scroll{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:10px}
table{border-collapse:collapse;width:100%;font:12px ui-monospace,monospace}th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}
th:first-child,td:first-child,th:last-child,td:last-child{text-align:left}th{color:var(--muted);font-weight:600}.bad{color:var(--bad);font-weight:600}.good{color:var(--good);font-weight:600}
svg{display:block;width:100%;height:auto;min-width:620px}.chart{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;margin:10px 0 18px}.chart-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.chart h2{margin:0;font-size:16px}.chart-head p{margin:2px 0 0;color:var(--muted);font-size:12px}.legend{display:flex;flex-wrap:wrap;gap:12px;color:var(--muted);font-size:11px}.legend span{display:inline-flex;align-items:center;gap:5px}.swatch{display:inline-block;width:16px;height:3px;background:var(--accent)}.swatch.errors,.swatch.slo{background:repeating-linear-gradient(90deg,var(--bad) 0 5px,transparent 5px 8px)}.swatch.p99{background:var(--bar)}.dot{display:inline-block;width:7px;height:7px;border-radius:50%}.dot.p50{background:var(--fg)}
.gridline{stroke:var(--line);stroke-width:1}.traffic-line{fill:none;stroke:var(--accent);stroke-width:2.25;stroke-linejoin:round}.error-line{fill:none;stroke:var(--bad);stroke-width:1.75;stroke-dasharray:5 4;stroke-linejoin:round}.error-dot{fill:var(--bad)}.hit{fill:transparent}.p99-bar{fill:var(--bar)}.p95-bar{fill:var(--accent)}.p50-dot{fill:var(--fg);stroke:var(--card);stroke-width:1.5}.slo-line{stroke:var(--bad);stroke-width:1.5;stroke-dasharray:5 4}.slo-label{fill:var(--bad)}.vu-line{fill:none;stroke:#268bd2;stroke-width:2.25;stroke-linejoin:round}.swatch.vus{background:#268bd2}.distribution-bar{fill:var(--accent)}.distribution-bar.overflow{fill:#d18b18}svg text{fill:var(--muted);font:9px ui-monospace,monospace}.step-label,.value-label{fill:var(--fg);font-size:10px}
section.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px}article{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}article p{margin:6px 0 0}ul{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 12px 12px 32px}
</style></head><body><main>
<h1>${name} — stress test</h1>
<p class="muted">${escapeHtml(run.startedAt)} · ${config.vus} virtual users · ramp-up ${config.rampUpS}s · ${load} · think time ${config.thinkTimeMs}ms · ${run.status}${run.truncated ? ' · raw samples truncated' : ''}</p>
<div class="cards">${cards}</div>
<h2>Release gates</h2>${checks ? `<ul>${checks}</ul>` : '<p class="muted">No release gates configured.</p>'}
<h2>Diagnosis</h2><section class="grid">${insights}</section>
${trafficChart}
${workloadChart}
${latencyChart}
${distributionChart}
<h2>Steps</h2><p class="muted">Latency in ms, measured by the HTTP executor.</p>
<div class="scroll"><table><thead><tr><th>Step</th><th>Count</th><th>Min</th><th>Avg</th><th>p50</th><th>p90</th><th>p95</th><th>p99</th><th>Max</th><th>Errors</th><th>Status codes</th></tr></thead><tbody>${rows}</tbody></table></div>
${errorGroups ? `<h2>Error fingerprints</h2><div class="scroll"><table><thead><tr><th>Error</th><th>Count</th><th>Steps</th><th>Status</th></tr></thead><tbody>${errorGroups}</tbody></table></div>` : ''}
<p class="muted">Generated by adOmnia.</p>
</main></body></html>
`
}
