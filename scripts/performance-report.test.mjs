import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseGoBenchmarks, median, comparisons, comparable } from './performance-report.mjs'
test('groups repeated Go samples and keeps allocation units separate', () => {
  const result = parseGoBenchmarks('BenchmarkX/Small-28 100 12.5 ns/op 32 B/op 2 allocs/op\nBenchmarkX/Small-28 100 14.5 ns/op 64 B/op 3 allocs/op')
  assert.equal(result.length, 3)
  assert.deepEqual(result[0].samples, [12.5, 14.5])
  assert.equal(median(result[0].samples), 13.5)
})
test('suppresses deltas when environment or units differ', () => {
  const environment = { platform: 'windows', arch: 'amd64', cpu: 'test', logicalCPUs: 4, go: 'go1', node: 'node1', protocol: 1, conditions: 'quiet' }
  const report = { environment, metrics: [{ name: 'X', unit: 'ns/op', samples: [20, 22] }] }
  const baseline = { environment: { ...environment, cpu: 'other' }, metrics: [{ name: 'X', unit: 'ns/op', samples: [10] }] }
  assert.equal(comparable(environment, baseline.environment), false)
  assert.equal(comparisons(report, baseline)[0].changePercent, null)
  baseline.environment = environment
  assert.ok(Math.abs(comparisons(report, baseline)[0].changePercent - 110) < 1e-9)
  baseline.metrics[0].unit = 'ms'
  assert.equal(comparisons(report, baseline)[0].changePercent, null)
})
