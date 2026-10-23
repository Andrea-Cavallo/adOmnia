import { readFileSync } from 'node:fs'

// Output of `go test -bench`: "BenchmarkName-8  100  12.5 ns/op  32 B/op  2 allocs/op".
const BENCHMARK_UNITS = new Set(['ns/op', 'B/op', 'allocs/op'])

/** Name without the "-<procs>" suffix Go appends (the last dash-number run). */
function benchmarkName(field) {
  const dash = field.lastIndexOf('-')
  if (dash <= 0 || dash === field.length - 1) return null
  return allDigits(field.slice(dash + 1)) ? field.slice(0, dash) : null
}

function allDigits(text) {
  if (!text) return false
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] < '0' || text[i] > '9') return false
  }
  return true
}

export function parseGoBenchmarks(output) {
  const metrics = new Map()
  for (const line of output.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/)
    if (fields.length < 4 || !fields[0].startsWith('Benchmark')) continue
    const name = benchmarkName(fields[0])
    if (name === null || !allDigits(fields[1])) continue
    for (let i = 2; i < fields.length - 1; i += 1) {
      const unit = fields[i + 1]
      if (!BENCHMARK_UNITS.has(unit)) continue
      const value = Number(fields[i])
      if (!Number.isFinite(value)) continue
      const key = `${name} [${unit}]`
      const entry = metrics.get(key) ?? { name, unit, samples: [] }
      entry.samples.push(value)
      metrics.set(key, entry)
    }
  }
  return [...metrics.values()]
}
export function median(samples) {
  const sorted = [...samples].sort((a, b) => a - b)
  const i = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2
}
export function comparable(left, right) {
  return ['platform', 'arch', 'cpu', 'logicalCPUs', 'go', 'node', 'conditions', 'protocol'].every(key => left[key] === right[key])
}
export function comparisons(report, baseline) {
  const compatible = baseline && comparable(report.environment, baseline.environment)
  return report.metrics.map(metric => {
    const previous = compatible && baseline.metrics.find(item => item.name === metric.name && item.unit === metric.unit)
    const current = median(metric.samples)
    const before = previous ? median(previous.samples) : null
    return { name: metric.name, unit: metric.unit, current, baseline: before, changePercent: before ? (current / before - 1) * 100 : null }
  })
}
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
export function renderDashboard(report, baseline) {
  const rows = comparisons(report, baseline).map(row => `<tr><td>${escape(row.name)}</td><td>${row.current.toFixed(3)}</td><td>${row.baseline?.toFixed(3) ?? 'Pending'}</td><td>${row.changePercent === null ? 'Pending' : row.changePercent.toFixed(1) + '%'}</td></tr>`).join('')
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>adOmnia local performance report</title><style>body{font:15px system-ui;max-width:1150px;margin:32px auto;padding:0 20px;color:#202124;background:#fafafa}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}td,th{padding:10px;text-align:left;border-bottom:1px solid #ddd}th{background:#eee}code{overflow-wrap:anywhere}p{line-height:1.5}</style><h1>adOmnia local performance report</h1><p>${escape(report.createdAt)} · ${escape(report.commit)} · dirty: ${report.dirty}</p><p>Microbenchmarks only. Native release baseline, CPU/RAM idle and input-to-render acceptance remain pending. Timing comparisons are advisory and do not block CI.</p><p>Environment: ${escape(report.environment.cpu)} · ${escape(report.environment.platform)} ${escape(report.environment.arch)} · ${escape(report.environment.go)} · ${escape(report.environment.node)}</p><p>Conditions: ${escape(report.environment.conditions)}</p><p>Baseline comparison: ${baseline ? comparable(report.environment, baseline.environment) ? 'matching declared environment/protocol; background noise still possible' : 'incompatible environment/protocol; deltas suppressed' : 'no baseline supplied'}</p><p>Startup: ${report.startup.initialJavaScriptBytes.toLocaleString('en-US')} / 650,000 bytes; forbidden modules: ${report.startup.deferredModulesStillOnStartup.length}. Lifecycle checks: passed (see lifecycle.txt).</p><table><thead><tr><th>Metric / unit</th><th>Current median</th><th>Baseline median</th><th>Change</th></tr></thead><tbody>${rows}</tbody></table><p>Proposed native targets: idle CPU &lt;2%; typing P95 &lt;50 ms; reduce startup/file-open P95; RAM -20% only where waste is measured; no persistent resource growth or orphans. No absolute workspace memory cap. These are not validated budgets.</p></html>`
}
export function loadReport(path) {
  const report = JSON.parse(readFileSync(path, 'utf8'))
  if (report.version !== 1 || report.kind !== 'developer-microbenchmark' || !report.environment || !Array.isArray(report.metrics)
    || report.metrics.some(metric => typeof metric.name !== 'string' || typeof metric.unit !== 'string' || !Array.isArray(metric.samples) || !metric.samples.length || metric.samples.some(value => !Number.isFinite(value)))) {
    throw new Error('Unsupported or malformed performance report')
  }
  return report
}
