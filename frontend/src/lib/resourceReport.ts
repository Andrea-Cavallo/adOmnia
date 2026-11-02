import type { Environment, Snapshot, Usage } from '../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/resources/models'
import type { ResourceUiContext } from './resourceObservation'

/**
 * Export format. `schemaVersion` 2 is not compatible with 1: identity fields are
 * listed once in `processes` and every sample references them by `id`, and the
 * duplicated top-level snapshot is gone.
 */
export const SCHEMA_VERSION = 2

/** Matches the history kept by the status bar: what an export can ever contain. */
export const SAMPLE_LIMIT = 300

/** Below these thresholds a report describes a moment, not a behaviour. */
export const MINIMUM_SAMPLES = 20
export const MINIMUM_DURATION_SECONDS = 30

export type ReportEnvironment = Partial<Environment>

const round = (value: number, digits: number) => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** One timestamp format everywhere: ISO 8601 in UTC with milliseconds. */
const iso = (value: string) => {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value
}

const timeOf = (value: string) => {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : NaN
}

/** A process identity is a PID plus its creation time: PIDs are reused. */
export const processId = (process: Pick<Usage, 'pid' | 'createdAt'>) => `${process.pid}:${process.createdAt}`

const hasCpu = (sample: Snapshot) => sample.processes.some(process => process.cpu != null)

/** Caller order is never trusted: charts, deltas and averages need time order. */
export function orderedSamples(history: Snapshot[]) {
  return history
    .map((sample, index) => ({ sample, index, time: timeOf(sample.at) }))
    .sort((left, right) => {
      const leftTime = Number.isFinite(left.time) ? left.time : 0
      const rightTime = Number.isFinite(right.time) ? right.time : 0
      return leftTime - rightTime || left.index - right.index
    })
    .map(entry => entry.sample)
}

/** The window each sample measured. The first sample has none: nothing precedes it. */
function spansInOrder(samples: Snapshot[]) {
  return samples.map((sample, index): number | null => {
    if (index === 0) return null
    const time = timeOf(sample.at)
    const previous = timeOf(samples[index - 1].at)
    if (!Number.isFinite(time) || !Number.isFinite(previous)) return null
    return Math.max(0, (time - previous) / 1000)
  })
}

/**
 * The window a sample's CPU actually covers. It comes from the process counters,
 * not from the clock: the first sample of an export measures CPU from before it,
 * and hiding that would misreport how much time the number refers to.
 */
function measuredSpansInOrder(samples: Snapshot[]) {
  const clockSpans = spansInOrder(samples)
  return samples.map((sample, index) => {
    const measured = Math.max(0, ...sample.processes.map(process => process.cpuIntervalSeconds ?? 0))
    return measured > 0 ? measured : clockSpans[index]
  })
}

function medianOfSpans(spans: (number | null)[]) {
  const values = spans.filter((span): span is number => span != null && span > 0).sort((a, b) => a - b)
  if (!values.length) return null
  const middle = Math.floor(values.length / 2)
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2
}

/** A silence is a whole missing sampling cycle, not polling jitter. */
const gapThreshold = (spans: (number | null)[]) => {
  const positive = spans.filter((span): span is number => span != null && span > 0)
  const cadence = positive.length ? Math.min(...positive) : 1
  return Math.max(2, cadence * 2.5)
}
const isGap = (span: number | null, threshold: number) => span != null && span >= threshold

export interface ResourceStats {
  samples: number
  durationSeconds: number
  cpuAverage: number | null
  cpuPeak: number | null
  cpuAverageCores: number | null
  cpuPeakCores: number | null
  cpuMeasuredSamples: number
  cpuCompleteSamples: number
  cpuWeighting: 'time' | 'sample'
  ramPeak: number | null
  ramChange: number | null
}

/**
 * Averages are weighted by the interval each sample actually measured. Polling
 * intervals differ (1 s while recording, 5 s live), so an arithmetic mean would
 * over-count the denser part of the window. A sample without a baseline carries
 * no CPU and is excluded instead of being read as zero.
 */
export function resourceStats(history: Snapshot[]): ResourceStats {
  const samples = orderedSamples(history)
  const spans = measuredSpansInOrder(samples)
  let weightedCpu = 0
  let weightedSpan = 0
  let summedCpu = 0
  let measured = 0
  let peak: number | null = null
  samples.forEach((sample, index) => {
    if (!hasCpu(sample)) return
    measured++
    summedCpu += sample.cpu
    peak = peak == null ? sample.cpu : Math.max(peak, sample.cpu)
    const span = spans[index]
    if (span != null && span > 0) {
      weightedCpu += sample.cpu * span
      weightedSpan += span
    }
  })
  const ram = samples.map(sample => sample.ram)
  const logicalCores = samples.length ? samples[samples.length - 1].logicalCores : 0
  const cpuAverage = measured === 0 ? null : weightedSpan > 0 ? weightedCpu / weightedSpan : summedCpu / measured
  const duration = samples.length > 1 ? (timeOf(samples[samples.length - 1].at) - timeOf(samples[0].at)) / 1000 : 0
  return {
    samples: samples.length,
    durationSeconds: Number.isFinite(duration) ? Math.max(0, round(duration, 3)) : 0,
    cpuAverage: cpuAverage == null ? null : round(cpuAverage, 2),
    cpuPeak: peak == null ? null : round(peak, 2),
    cpuAverageCores: cpuAverage == null || !logicalCores ? null : round(cpuAverage / 100 * logicalCores, 2),
    cpuPeakCores: peak == null || !logicalCores ? null : round(peak / 100 * logicalCores, 2),
    cpuMeasuredSamples: measured,
    cpuCompleteSamples: samples.filter(sample => sample.cpuComplete).length,
    cpuWeighting: weightedSpan > 0 ? 'time' : 'sample',
    ramPeak: ram.length ? Math.max(...ram) : null,
    ramChange: ram.length > 1 ? samples[samples.length - 1].ram - samples[0].ram : null,
  }
}

export interface ReportQuality {
  samples: number
  durationSeconds: number
  medianIntervalSeconds: number | null
  maxGapSeconds: number | null
  gaps: number
  sampleLimit: number
  sufficient: boolean
  caveats: string[]
}

/**
 * A three-sample export and a two-minute recording used to look identical. This
 * block is what tells a reader whether the numbers can carry a conclusion.
 */
export function reportQuality(history: Snapshot[]): ReportQuality {
  const samples = orderedSamples(history)
  const spans = spansInOrder(samples)
  const median = medianOfSpans(spans)
  const threshold = gapThreshold(spans)
  const gaps = spans.filter(span => isGap(span, threshold))
  const stats = resourceStats(samples)
  const caveats: string[] = []
  if (stats.samples < MINIMUM_SAMPLES) caveats.push(`only ${stats.samples} samples: a stable average needs at least ${MINIMUM_SAMPLES}`)
  if (stats.durationSeconds < MINIMUM_DURATION_SECONDS) caveats.push(`the window lasts ${stats.durationSeconds.toFixed(1)} s: below ${MINIMUM_DURATION_SECONDS} s a single spike dominates the average`)
  if (stats.cpuMeasuredSamples < stats.samples) caveats.push(`${stats.samples - stats.cpuMeasuredSamples} samples have no CPU baseline and are excluded from the average`)
  if (gaps.length) caveats.push(`${gaps.length} gaps longer than ${round(threshold, 2)} s: the application was not sampled there, so the charts break the line`)
  if (stats.samples >= SAMPLE_LIMIT) caveats.push(`the history is capped at ${SAMPLE_LIMIT} samples: older observations were dropped`)
  return {
    samples: stats.samples,
    durationSeconds: stats.durationSeconds,
    medianIntervalSeconds: median == null ? null : round(median, 3),
    maxGapSeconds: spans.length ? round(Math.max(0, ...spans.filter((span): span is number => span != null)), 3) : null,
    gaps: gaps.length,
    sampleLimit: SAMPLE_LIMIT,
    sufficient: stats.samples >= MINIMUM_SAMPLES && stats.durationSeconds >= MINIMUM_DURATION_SECONDS,
    caveats,
  }
}

export interface ReportProcess {
  id: string
  pid: number
  createdAt: number
  name: string
  role?: string
  owner?: string
  workspace?: string
  sessionId?: string
  executable?: string
  memoryLimit?: string
  parentPid: number
  parentName?: string
  attribution: string
  firstSeen: string
  lastSeen: string
  samples: number
  ramPeakBytes: number
  cpuPeak: number | null
  cpuAverage: number | null
  cpuSamples: number
  cpuSeconds: number | null
}

/**
 * One row per process identity, carrying the provenance that used to exist only
 * inside each sample: without owner and workspace the large `node.exe` rows of a
 * report are anonymous.
 */
export function resourceProcessSummary(history: Snapshot[]): ReportProcess[] {
  const accumulated = new Map<string, { row: ReportProcess; weightedCpu: number; weightedSpan: number; summedCpu: number; cpuCount: number }>()
  for (const sample of orderedSamples(history)) {
    const at = iso(sample.at)
    for (const process of sample.processes) {
      const id = processId(process)
      const entry = accumulated.get(id) ?? {
        row: {
          id,
          pid: process.pid,
          createdAt: process.createdAt,
          name: process.name,
          parentPid: process.parentPid,
          attribution: process.attribution,
          firstSeen: at,
          lastSeen: at,
          samples: 0,
          ramPeakBytes: 0,
          cpuPeak: null,
          cpuAverage: null,
          cpuSamples: 0,
          cpuSeconds: null,
        },
        weightedCpu: 0,
        weightedSpan: 0,
        summedCpu: 0,
        cpuCount: 0,
      }
      const row = entry.row
      row.samples++
      row.lastSeen = at
      row.ramPeakBytes = Math.max(row.ramPeakBytes, process.ram)
      // Identity can be discovered after the first sighting: keep the latest value.
      row.name = process.name || row.name
      row.role = process.role ?? row.role
      row.owner = process.owner ?? row.owner
      row.workspace = process.workspace || row.workspace
      row.sessionId = process.sessionId ?? row.sessionId
      row.executable = process.executable ?? row.executable
      row.memoryLimit = process.memoryLimit ?? row.memoryLimit
      row.parentPid = process.parentPid || row.parentPid
      row.parentName = process.parentName ?? row.parentName
      row.attribution = process.attribution || row.attribution
      row.cpuSeconds = process.cpuSeconds
      if (process.cpu != null) {
        entry.summedCpu += process.cpu
        entry.cpuCount++
        row.cpuPeak = Math.max(row.cpuPeak ?? 0, process.cpu)
        if (process.cpuIntervalSeconds > 0) {
          entry.weightedCpu += process.cpu * process.cpuIntervalSeconds
          entry.weightedSpan += process.cpuIntervalSeconds
        }
      }
      accumulated.set(id, entry)
    }
  }
  return [...accumulated.values()]
    .map(entry => {
      const row = entry.row
      const average = entry.weightedSpan > 0 ? entry.weightedCpu / entry.weightedSpan : entry.cpuCount > 0 ? entry.summedCpu / entry.cpuCount : null
      return {
        ...row,
        cpuSamples: entry.cpuCount,
        cpuPeak: row.cpuPeak == null ? null : round(row.cpuPeak, 2),
        cpuAverage: average == null ? null : round(average, 2),
        cpuSeconds: row.cpuSeconds == null ? null : round(row.cpuSeconds, 3),
      }
    })
    .sort((left, right) => (right.cpuAverage ?? -1) - (left.cpuAverage ?? -1) || right.ramPeakBytes - left.ramPeakBytes || left.name.localeCompare(right.name))
}

interface ReportSampleProcess {
  id: string
  ram: number
  cpu: number | null
  cpuSeconds: number
  cpuIntervalSeconds: number
  error?: string
}

interface ReportSample {
  at: string
  intervalSeconds: number | null
  gapSeconds: number | null
  ram: number
  cpu: number
  cpuComplete: boolean
  instances: number
  incomplete: boolean
  warnings?: string[]
  budget?: Snapshot['budget']
  runtime?: Snapshot['runtime']
  processes: ReportSampleProcess[]
  uiContext?: ResourceUiContext
}

function withCurrent(history: Snapshot[], sample: Snapshot) {
  if (!history.length) return [sample]
  const ordered = orderedSamples(history)
  const last = ordered[ordered.length - 1]
  const current = timeOf(sample.at)
  const previous = timeOf(last.at)
  if (Number.isFinite(current) && (!Number.isFinite(previous) || current > previous)) return [...ordered, sample]
  return ordered
}

function reportSample(sample: Snapshot & { uiContext?: ResourceUiContext }, span: number | null, clockSpan: number | null, threshold: number): ReportSample {
  return {
    at: iso(sample.at),
    intervalSeconds: span == null ? null : round(span, 3),
    gapSeconds: isGap(clockSpan, threshold) ? round(clockSpan as number, 3) : null,
    ram: sample.ram,
    cpu: round(sample.cpu, 2),
    cpuComplete: sample.cpuComplete,
    instances: sample.instances,
    incomplete: sample.incomplete,
    ...(sample.uiContext ? { uiContext: { ...sample.uiContext } } : {}),
    ...(sample.warnings?.length ? { warnings: [...sample.warnings] } : {}),
    ...(sample.budget ? { budget: sample.budget } : {}),
    ...(sample.runtime ? { runtime: { ...sample.runtime, gcCpuFraction: round(sample.runtime.gcCpuFraction, 8) } } : {}),
    processes: sample.processes.map(process => ({
      id: processId(process),
      ram: process.ram,
      cpu: process.cpu == null ? null : round(process.cpu, 2),
      cpuSeconds: round(process.cpuSeconds, 3),
      cpuIntervalSeconds: round(process.cpuIntervalSeconds, 3),
      ...(process.error ? { error: process.error } : {}),
    })),
  }
}

export function resourceReport(sample: Snapshot, history: Snapshot[], scenario = 'Observation', environment: ReportEnvironment | null = null) {
  const samples = orderedSamples(withCurrent(history, sample))
  const spans = measuredSpansInOrder(samples)
  const clockSpans = spansInOrder(samples)
  const threshold = gapThreshold(clockSpans)
  const latest = samples[samples.length - 1]
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'adomnia-resource-report',
    scenario,
    exportedAt: new Date().toISOString(),
    environment: {
      ...(environment ?? {}),
      logicalCores: environment?.logicalCores ?? latest?.logicalCores,
      rootPid: environment?.rootPid ?? latest?.rootPid,
    },
    methodology: {
      scope: 'One adOmnia root PID and observed descendants only; unrelated applications excluded.',
      cpu: 'Percent of total logical CPU capacity; divide by 100 and multiply by logicalCores for busy cores. Null means no baseline or unavailable; never zero-filled. CPUSeconds is cumulative user+system time since process start. IntervalSeconds is the window this sample measured, taken from the process counters: the first sample of an export covers CPU spent before it. cpuComplete=false means the aggregate omits unavailable process CPU.',
      averages: 'Averages are weighted by the window each sample measured, not arithmetic means: polling is 1 s while recording and 5 s live. A sample without a baseline is excluded from the average instead of counting as zero. ramPeak and cpuPeak are the highest sample observed in this window.',
      gaps: 'gapSeconds is set when the time since the previous sample exceeds 2.5x the shortest observed interval, meaning the application was not sampled and the timeline is not continuous. The charts break the line there.',
      ram: 'Process RSS in bytes, summed. Shared pages can be counted multiple times; not private committed memory.',
      identity: 'A process is identified by id = pid:createdAt (Unix milliseconds); PIDs are reused. Each sample lists process id, RSS, CPU and counters; name, role, owner, workspace, executable and parent are listed once in processes.',
      timestamps: 'All timestamps are ISO 8601 in UTC with milliseconds. createdAt is Unix milliseconds. Exports made before schemaVersion 2 used the local offset and seven fractional digits.',
      provenance: 'managed-session = Code Studio registration; observed-parent = current OS parent, not proof of original creator.',
      limits: 'Go GOMEMLIMIT is a soft GC budget, not an RSS or CPU cap. Backend runtime and language-server limits are independent.',
      environment: 'environment describes the machine and build the recording came from; memoryBudgetSource distinguishes an explicit ADOMNIA_MEMORY_BUDGET_MIB override from the automatic rule.',
      privacy: 'No raw command-line arguments, environment values (except GOMEMLIMIT), credentials or source code. Executables, workspaces and user paths are included as absolute paths.',
      csvSafety: 'Formula-like string cells are prefixed with an apostrophe in CSV; JSON retains exact original strings.',
      coverage: 'Bounded to 256 processes and depth 16. Incomplete snapshots and OS access errors are retained. History is limited to 300 samples. Activity/visibility may cause gaps.',
    },
    quality: reportQuality(samples),
    summary: resourceStats(samples),
    processes: resourceProcessSummary(samples),
    samples: samples.map((item, index) => reportSample(item, spans[index], clockSpans[index], threshold)),
  }
}

export type ResourceReport = ReturnType<typeof resourceReport>

const csvCell = (value: unknown) => {
  const safe = typeof value === 'string' && /^[=+\-@\t\r]/.test(value) ? `'${value}` : String(value ?? '')
  return `"${safe.replace(/"/g, '""')}"`
}

const csvHeader = ['appVersion', 'os', 'at', 'sampleIntervalSeconds', 'gapSeconds', 'sampleRamBytes', 'sampleCpuPercent', 'rootPid', 'logicalCores', 'processId', 'pid', 'createdAtUnixMs', 'parentPid', 'parentName', 'name', 'role', 'owner', 'sessionId', 'workspace', 'executable', 'attribution', 'ramBytes', 'cpuPercentTotalCapacity', 'cpuSeconds', 'cpuIntervalSeconds', 'cpuComplete', 'processMemoryLimit', 'backendGoMemoryLimitBytes', 'heapAllocBytes', 'numGC', 'gcCpuFractionLifetime', 'incomplete', 'error']

/** One row per process per sample, identity joined from the registry. */
export function resourcesToCSV(sample: Snapshot, history: Snapshot[], scenario = 'Observation', environment: ReportEnvironment | null = null) {
  const report = resourceReport(sample, history, scenario, environment)
  const identities = new Map(report.processes.map(process => [process.id, process]))
  const rows = report.samples.flatMap(item => {
    const shared = [report.environment.appVersion, report.environment.os, item.at, item.intervalSeconds, item.gapSeconds, item.ram, item.cpu, report.environment.rootPid, report.environment.logicalCores]
    const runtime = [item.runtime?.memoryLimit, item.runtime?.heapAlloc, item.runtime?.numGC, item.runtime?.gcCpuFraction, item.incomplete]
    if (!item.processes.length) {
      // An empty sample is still a row: silently dropping it would hide the gap it represents.
      const emptyIdentity = Array(12).fill('')
      const emptyUsage = Array(4).fill('')
      return [[...shared, ...emptyIdentity, ...emptyUsage, item.cpuComplete, '', ...runtime, ''].map(csvCell).join(',')]
    }
    return item.processes.map(process => {
      const identity = identities.get(process.id)
      return [
        ...shared,
        process.id, identity?.pid, identity?.createdAt, identity?.parentPid, identity?.parentName, identity?.name, identity?.role, identity?.owner, identity?.sessionId, identity?.workspace, identity?.executable, identity?.attribution,
        process.ram, process.cpu, process.cpuSeconds, process.cpuIntervalSeconds, item.cpuComplete, identity?.memoryLimit,
        ...runtime,
        process.error,
      ].map(csvCell).join(',')
    })
  })
  return [csvHeader.join(','), ...rows].join('\r\n')
}

/** Real timestamps, distinct scales; missing CPU values and silences break the line. */
export function resourceChartPath(samples: Snapshot[], metric: 'cpu' | 'ram', width = 600, height = 88) {
  const ordered = orderedSamples(samples)
  const spans = spansInOrder(ordered)
  const threshold = gapThreshold(spans)
  const times = ordered.map(sample => timeOf(sample.at))
  const peak = metric === 'cpu' ? 100 : Math.max(1, ...ordered.map(sample => sample.ram))
  const max = metric === 'cpu' ? 100 : peak * 1.1
  const start = times[0]
  const span = Math.max(1, times[times.length - 1] - start)
  let pen = false
  const path = ordered.map((sample, index) => {
    if (!Number.isFinite(times[index]) || !sample.processes.length || (metric === 'cpu' && !hasCpu(sample))) { pen = false; return '' }
    if (isGap(spans[index], threshold)) pen = false
    const x = ((times[index] - start) / span * width).toFixed(2)
    const y = (height - Math.min(max, sample[metric]) / max * (height - 4)).toFixed(2)
    const next = `${pen ? 'L' : 'M'}${x},${y}`
    pen = true
    return next
  }).join(' ')
  return { path, max, peak }
}

const html = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const mib = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MiB`
const percent = (value: number | null | undefined) => (value == null ? '—' : `${value.toFixed(2)}%`)

export function resourcesToHTML(sample: Snapshot, history: Snapshot[], scenario = 'Observation', environment: ReportEnvironment | null = null) {
  const report = resourceReport(sample, history, scenario, environment)
  const charts = (['cpu', 'ram'] as const).map(metric => {
    const graph = resourceChartPath(history.length ? history : [sample], metric)
    const scale = metric === 'cpu' ? '0–100% total capacity' : `0–${(graph.max / 1048576).toFixed(0)} MiB RSS (peak ${(graph.peak / 1048576).toFixed(0)} MiB)`
    return `<h2>${metric === 'cpu' ? 'CPU' : 'RAM'} · ${scale}</h2><svg viewBox="0 0 600 88" role="img" aria-label="${metric} over time"><path d="${graph.path}" fill="none" stroke="#e7984c" stroke-width="2"/></svg>`
  }).join('')
  const meta = [
    report.environment.appVersion && `adOmnia ${report.environment.appVersion}`,
    report.environment.gitCommit && `commit ${report.environment.gitCommit}`,
    report.environment.osVersion ?? report.environment.os,
    report.environment.arch,
    report.environment.logicalCores != null && `${report.environment.logicalCores} logical cores`,
    report.environment.totalRamBytes != null && `${(report.environment.totalRamBytes / 1073741824).toFixed(1)} GiB physical RAM`,
    report.environment.memoryBudgetTarget != null && `budget ${mib(report.environment.memoryBudgetTarget)} (${report.environment.memoryBudgetSource})`,
    report.environment.goVersion,
  ].filter(Boolean).map(html).join(' · ')
  const quality = `<p class="${report.quality.sufficient ? '' : 'warn'}">${report.quality.samples} samples over ${report.quality.durationSeconds.toFixed(1)} s · median interval ${report.quality.medianIntervalSeconds ?? '—'} s · ${report.quality.gaps} gaps · ${report.quality.sufficient ? 'sufficient for an average' : 'insufficient for an average'}</p>${report.quality.caveats.map(caveat => `<p class="warn">${html(caveat)}</p>`).join('')}`
  const rows = report.processes.map(process => `<tr>${[process.name, process.pid, process.parentPid, process.parentName, process.role, process.owner, process.workspace, process.samples, (process.ramPeakBytes / 1048576).toFixed(1), percent(process.cpuAverage), percent(process.cpuPeak)].map(value => `<td>${html(value)}</td>`).join('')}</tr>`).join('')
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>adOmnia resource report</title><style>body{font:14px system-ui;background:#101010;color:#eee;max-width:1100px;margin:40px auto;padding:24px}h1{letter-spacing:-1px}h2{font-size:14px;margin-top:28px}p.warn{color:#e7984c}svg{width:100%;border-bottom:1px solid #555}table{border-collapse:collapse;width:100%;font-size:12px}td,th{border-bottom:1px solid #444;padding:9px;text-align:left;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#bbb}summary{cursor:pointer}</style><h1>adOmnia · Resource report</h1><p>${html(report.scenario)} · ${html(report.exportedAt)} · schemaVersion ${report.schemaVersion}</p><p>${meta}</p>${quality}<pre>${html(JSON.stringify(report.summary, null, 2))}</pre>${charts}<p>Averages are time-weighted over each measured interval; gaps break the line because nothing was sampled there. RAM and CPU use separate scales. RSS sums shared pages. Historical observation does not prove the cause of a spike.</p><h2>Processes · peak RSS and average CPU over the window</h2><table><thead><tr>${['Process', 'PID', 'Parent', 'Parent name', 'Role', 'Owner', 'Workspace', 'Samples', 'Peak MiB', 'Avg CPU', 'Peak CPU'].map(value => `<th>${value}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table><details><summary>Methodology</summary><pre>${html(Object.entries(report.methodology).map(([key, value]) => `${key}: ${value}`).join('\n\n'))}</pre></details><details><summary>Full machine-readable recording</summary><pre>${html(JSON.stringify(report, null, 2))}</pre></details></html>`
}
