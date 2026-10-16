import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyProcess,
  parseRecording,
  renderMarkdown,
  summarizeRecording,
  summarizeRecordings,
  summarizeActivity,
} from './perf-scenario-report.mjs'

const sample = (overrides = {}) => ({
  at: '2026-10-15T10:00:00.000Z',
  scenario: 'idle-30m',
  rootPid: 100,
  runtime: { goroutines: 42, heapInuse: 104857600, sys: 209715200, gcPauseTotalNs: 1000, gcCpuFraction: 0.01 },
  processes: [
    { pid: 100, name: 'adOmnia', ram: 200000000, cpu: 5 },
    { pid: 200, name: 'msedgewebview2.exe', ram: 300000000, cpu: 10 },
    { pid: 300, name: 'gopls.exe', ram: 150000000, cpu: 2 },
    { pid: 400, name: 'dlv.exe', ram: 50000000, cpu: 0.5 },
    { pid: 500, name: 'bash', ram: 1000000, cpu: null },
  ],
  ram: 701000000,
  cpu: 17.5,
  instances: 2,
  frontend: { inputKeypresses: 10, inputSamples: 8, inputP50Ms: 12, inputP95Ms: 30, inputMaxMs: 40 },
  ...overrides,
})

test('activity checkpoints require elapsed time and preserve actual mixed states', () => {
  const samples = Array.from({ length: 181 }, (_, i) => sample({
    at: new Date(Date.UTC(2026, 9, 15, 10) + i * 10_000).toISOString(),
    activity: { state: i < 30 ? 'Active' : 'Idle' },
    cpu: i < 30 ? 2 : 0.01,
  }))
  const checkpoints = summarizeActivity(samples)
  assert.equal(checkpoints[0].complete, true)
  assert.deepEqual(checkpoints[0].states, ['Active', 'Idle'])
  assert.deepEqual(checkpoints[1].states, ['Idle'])
  assert.equal(checkpoints[2].complete, true)
  assert.ok(Math.abs(checkpoints[2].cpuPercent.avg - 0.01) < 1e-10)
  assert.equal(summarizeActivity(samples.slice(0, 30))[0].complete, false)
  assert.deepEqual(summarizeActivity(samples.map(value => ({ ...value, activity: undefined })))[0].states, ['Unknown'])
})

test('classifies the baseline components by process identity', () => {
  const current = sample()
  assert.equal(classifyProcess({ pid: 100, name: 'adOmnia' }, current), 'backend-go')
  assert.equal(classifyProcess({ pid: 201, name: 'msedgewebview2.exe' }, current), 'webview2')
  assert.equal(classifyProcess({ pid: 301, name: 'gopls' }, current), 'gopls')
  assert.equal(classifyProcess({ pid: 401, name: 'dlv.exe' }, current), 'debug-adapter')
  assert.equal(classifyProcess({ pid: 501, name: 'bash' }, current), 'other-children')
})

test('sums all WebView children per sample and excludes incomplete CPU deltas', () => {
  const processes = [
    { pid: 200, name: 'msedgewebview2.exe', ram: 100, cpu: 1 },
    { pid: 201, name: 'msedgewebview2.exe', ram: 200, cpu: 2 },
  ]
  const summary = summarizeRecording([
    sample({ processes }),
    sample({ at: '2026-10-15T10:00:01Z', processes: processes.map(process => ({ ...process, cpu: null })) }),
  ])
  assert.equal(summary.components.webview2.ramBytes.avg, 300)
  assert.equal(summary.components.webview2.cpuPercent.avg, 3)
  assert.equal(summary.components.webview2.cpuPercent.samples, 1)
})

test('parses recordings and rejects malformed lines', () => {
  const parsed = parseRecording(JSON.stringify(sample()) + '\n\n' + JSON.stringify(sample({ at: '2026-10-15T10:00:01.000Z' })))
  assert.equal(parsed.length, 2)
  assert.equal(parseRecording('\uFEFF' + JSON.stringify(sample())).length, 1)
  assert.throws(() => parseRecording('not json'), /invalid JSON line/)
  assert.throws(() => parseRecording(JSON.stringify({ at: 'x' })), /malformed sample/)
})

test('summarizes per component with runtime and frontend aggregates', () => {
  const summary = summarizeRecording([
    sample(),
    sample({
      at: '2026-10-15T10:00:20.000Z',
      runtime: { goroutines: 44, heapInuse: 125829120, sys: 209715200, gcPauseTotalNs: 1500, gcCpuFraction: 0.01 },
      frontend: { inputKeypresses: 12, inputSamples: 9, inputP50Ms: 14, inputP95Ms: 44, inputMaxMs: 60 },
    }),
  ])
  assert.equal(summary.scenario, 'idle-30m')
  assert.equal(summary.sampleCount, 2)
  assert.equal(summary.durationSec, 20)
  assert.deepEqual(Object.keys(summary.components), ['backend-go', 'debug-adapter', 'gopls', 'other-children', 'webview2'])
  assert.equal(summary.components['backend-go'].processesObserved, 1)
  assert.equal(summary.components['webview2'].ramBytes.max, 300000000)
  assert.equal(summary.components['gopls'].cpuPercent.avg, 2)
  assert.equal(summary.components['other-children'].cpuPercent.samples, 0)
  assert.equal(summary.runtime.goroutines.max, 44)
  assert.equal(summary.runtime.gcPauseTotalNsDelta, 500)
  assert.equal(summary.frontend.inputKeypresses, 22)
  assert.equal(summary.frontend.inputP95Ms.max, 44)
})

test('rejects empty or mixed recordings', () => {
  assert.throws(() => summarizeRecording([], 'x'), /no samples/)
  assert.throws(() => summarizeRecording([sample(), sample({ scenario: 'cold-start' })], 'x'), /mixed scenarios/)
})

test('renders a markdown table covering every component', () => {
  const report = summarizeRecordings([{ source: 'a.jsonl', samples: [sample()] }])
  const markdown = renderMarkdown(report)
  for (const component of ['backend-go', 'webview2', 'gopls', 'debug-adapter', 'other-children', 'backend runtime']) {
    assert.ok(markdown.includes(`| ${component} |`), `missing ${component} row`)
  }
  assert.ok(markdown.includes('input p95 max 30 ms'))
})
