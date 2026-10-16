// Aggregate adOmnia scenario recordings (<dataDir>/perf/*.jsonl) into a local
// per-component baseline report. Run: node scripts/perf-scenario-report.mjs
// <dir> [--out baseline-report.json] [--conditions "..."]. All output stays
// local; nothing is transmitted.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { arch, cpus, platform, totalmem } from 'node:os'
import { median } from './performance-report.mjs'

export const REPORT_VERSION = 1
export const REPORT_KIND = 'native-scenario-baseline'

// Components named by the baseline acceptance criterion (REFACTOR.md voce 1).
export function classifyProcess(usage, sample) {
  const name = String(usage.name ?? '')
  if (usage.pid === sample.rootPid) return 'backend-go'
  if (/msedgewebview2|webview/i.test(name)) return 'webview2'
  if (/^gopls(\.exe)?$/i.test(name)) return 'gopls'
  if (/^dlv(\.exe)?$/i.test(name) || /debug-adapter/i.test(name)) return 'debug-adapter'
  return 'other-children'
}

export function parseRecording(text, source = 'recording') {
  const samples = []
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line.trim()) continue
    let sample
    try {
      sample = JSON.parse(line)
    } catch {
      throw new Error(`${source}: invalid JSON line`)
    }
    if (typeof sample.at !== 'string' || typeof sample.scenario !== 'string' || !sample.runtime || !Array.isArray(sample.processes)) {
      throw new Error(`${source}: malformed sample`)
    }
    samples.push(sample)
  }
  return samples
}

function stats(values) {
  const numbers = values.filter(value => typeof value === 'number' && Number.isFinite(value))
  if (!numbers.length) return { samples: 0, avg: null, max: null, median: null }
  return {
    samples: numbers.length,
    avg: Math.round((numbers.reduce((sum, value) => sum + value, 0) / numbers.length) * 100) / 100,
    max: Math.round(Math.max(...numbers) * 100) / 100,
    median: Math.round(median(numbers) * 100) / 100,
  }
}

// Trailing minute at each elapsed checkpoint: never label a partial recording
// complete or infer inactivity from low CPU alone. Old recordings stay usable.
export function summarizeActivity(samples) {
  const first = Date.parse(samples[0]?.at)
  const last = Date.parse(samples.at(-1)?.at)
  return [5, 15, 30].map(minute => {
    const end = first + minute * 60_000
    const window = samples.filter(sample => {
      const at = Date.parse(sample.at)
      return at > end - 60_000 && at <= end
    })
    const states = [...new Set(window.map(sample => sample.activity?.state ?? 'Unknown'))].sort()
    return {
      minute,
      complete: Number.isFinite(first) && last >= end && window.length >= 2,
      states,
      cpuPercent: stats(window.map(sample => sample.cpu)),
      ramBytes: stats(window.map(sample => sample.ram)),
    }
  })
}

export function summarizeRecording(samples, source = 'recording') {
  if (!samples.length) throw new Error(`${source}: no samples`)
  const scenario = samples[0].scenario
  const ram = new Map()
  const goroutines = []
  const heapInuse = []
  const sys = []
  const frontend = { inputKeypresses: 0, inputSamples: 0, inputP50Ms: [], inputP95Ms: [], inputMaxMs: [] }
  for (const sample of samples) {
    if (sample.scenario !== scenario) throw new Error(`${source}: mixed scenarios in one recording`)
    goroutines.push(sample.runtime.goroutines)
    heapInuse.push(sample.runtime.heapInuse)
    sys.push(sample.runtime.sys)
    const componentTotals = new Map()
    for (const usage of sample.processes) {
      const component = classifyProcess(usage, sample)
      if (!ram.has(component)) {
        ram.set(component, { processes: new Set(), ram: [], cpu: [] })
      }
      const bucket = ram.get(component)
      bucket.processes.add(`${usage.pid}:${usage.name}`)
      const total = componentTotals.get(component) ?? { ram: 0, cpu: 0, cpuComplete: true }
      total.ram += usage.ram
      if (typeof usage.cpu === 'number' && Number.isFinite(usage.cpu)) total.cpu += usage.cpu
      else total.cpuComplete = false
      componentTotals.set(component, total)
    }
    // WebView2 has several processes: aggregate a component per sample before
    // computing statistics. A missing CPU delta must not become a false zero.
    for (const [component, total] of componentTotals) {
      const bucket = ram.get(component)
      bucket.ram.push(total.ram)
      if (total.cpuComplete) bucket.cpu.push(total.cpu)
    }
    if (sample.frontend) {
      frontend.inputKeypresses += Number(sample.frontend.inputKeypresses ?? 0)
      frontend.inputSamples += Number(sample.frontend.inputSamples ?? 0)
      frontend.inputP50Ms.push(sample.frontend.inputP50Ms)
      frontend.inputP95Ms.push(sample.frontend.inputP95Ms)
      frontend.inputMaxMs.push(sample.frontend.inputMaxMs)
    }
  }
  const components = {}
  for (const [component, bucket] of [...ram].sort(([left], [right]) => left.localeCompare(right))) {
    components[component] = {
      processesObserved: bucket.processes.size,
      ramBytes: stats(bucket.ram),
      cpuPercent: stats(bucket.cpu),
    }
  }
  const first = Date.parse(samples[0].at)
  const last = Date.parse(samples[samples.length - 1].at)
  const firstGc = Number(samples[0].runtime.gcPauseTotalNs ?? 0)
  const lastGc = Number(samples[samples.length - 1].runtime.gcPauseTotalNs ?? 0)
  return {
    scenario,
    source,
    startedAt: samples[0].at,
    endedAt: samples[samples.length - 1].at,
    durationSec: Number.isFinite(first) && Number.isFinite(last) ? Math.round((last - first) / 100) / 10 : 0,
    sampleCount: samples.length,
    activityCheckpoints: summarizeActivity(samples),
    components,
    runtime: {
      goroutines: stats(goroutines),
      heapInuseBytes: stats(heapInuse),
      sysBytes: stats(sys),
      gcPauseTotalNsDelta: Number.isFinite(firstGc) && Number.isFinite(lastGc) ? lastGc - firstGc : null,
    },
    frontend: {
      inputKeypresses: frontend.inputKeypresses,
      inputSamples: frontend.inputSamples,
      inputP50Ms: stats(frontend.inputP50Ms),
      inputP95Ms: stats(frontend.inputP95Ms),
      inputMaxMs: stats(frontend.inputMaxMs),
    },
  }
}

export function summarizeRecordings(recordings) {
  return {
    version: REPORT_VERSION,
    kind: REPORT_KIND,
    createdAt: new Date().toISOString(),
    scenarios: recordings
      .map(({ samples, source }) => summarizeRecording(samples, source))
      .sort((left, right) => left.scenario.localeCompare(right.scenario)),
  }
}

export function buildEnvironment(conditions = 'Local scenario recording; protocol in docs/PERFORMANCE.md.') {
  return {
    protocol: 1,
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model ?? 'unknown',
    logicalCPUs: cpus().length,
    totalMemoryBytes: totalmem(),
    conditions,
  }
}

const formatBytes = value => value === null ? 'n/a' : `${(value / 1024 / 1024).toFixed(1)} MiB`
const formatNumber = (value, suffix = '') => value === null ? 'n/a' : `${value}${suffix}`

export function renderMarkdown(report) {
  const lines = [
    `# adOmnia scenario baseline — ${report.createdAt}`,
    '',
    '| Scenario | Component | RAM avg | RAM max | CPU avg | CPU max | Processes |',
    '|---|---|---|---|---|---|---|',
  ]
  for (const scenario of report.scenarios) {
    for (const [name, component] of Object.entries(scenario.components)) {
      lines.push(`| ${scenario.scenario} | ${name} | ${formatBytes(component.ramBytes.avg)} | ${formatBytes(component.ramBytes.max)} | ${formatNumber(component.cpuPercent.avg, '%')} | ${formatNumber(component.cpuPercent.max, '%')} | ${component.processesObserved} |`)
    }
    lines.push(`| ${scenario.scenario} | backend runtime | goroutines max ${formatNumber(scenario.runtime.goroutines.max)} | heap max ${formatBytes(scenario.runtime.heapInuseBytes.max)} | gc pause Δ ${formatNumber(scenario.runtime.gcPauseTotalNsDelta, ' ns')} | input p95 max ${formatNumber(scenario.frontend.inputP95Ms.max, ' ms')} | ${scenario.sampleCount} samples |`)
    for (const checkpoint of scenario.activityCheckpoints ?? []) {
      if (!checkpoint.complete) continue
      lines.push(`| ${scenario.scenario} | ${checkpoint.minute} min (${checkpoint.states.join(', ')}) | ${formatBytes(checkpoint.ramBytes.avg)} | ${formatBytes(checkpoint.ramBytes.max)} | ${formatNumber(checkpoint.cpuPercent.avg, '%')} | ${formatNumber(checkpoint.cpuPercent.max, '%')} | trailing minute |`)
    }
  }
  return lines.join('\n')
}

function recordingFiles(input) {
  const target = resolve(input)
  if (statSync(target).isDirectory()) {
    return readdirSync(target)
      .filter(name => name.endsWith('.jsonl'))
      .sort()
      .map(name => resolve(target, name))
  }
  return [target]
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  const options = {}
  const inputs = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out' || args[i] === '--conditions') {
      if (!args[i + 1]) throw new Error(`Expected a value after ${args[i]}`)
      options[args[i].slice(2)] = args[++i]
    } else {
      inputs.push(args[i])
    }
  }
  if (!inputs.length) throw new Error('usage: node scripts/perf-scenario-report.mjs <perf-dir|recording.jsonl> [--out baseline-report.json] [--conditions "..."]')
  const files = inputs.flatMap(recordingFiles)
  const recordings = files.map(file => ({ source: file, samples: parseRecording(readFileSync(file, 'utf8'), file) }))
  const report = { environment: buildEnvironment(options.conditions), ...summarizeRecordings(recordings) }
  const out = resolve(options.out ?? 'baseline-report.json')
  writeFileSync(out, JSON.stringify(report, null, 2))
  console.log(renderMarkdown(report))
  console.log(`\nLocal report: ${out}`)
}
