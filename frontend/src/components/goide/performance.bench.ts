import { test } from 'vitest'
import { compareBenchmarkSamples } from './goStudioBenchmarkCompare'
import { splitTabsForPersistence } from '@/stores/tabs'
import { blankRequest, type Tab } from '@/lib/types'

const samples = (base: number) => Array.from({ length: 10 }, (_, i) => ({ iterations: 100, metrics: [{ unit: 'ns/op', value: base + i }] }))
const current = samples(110), baseline = samples(100)
const tabs: Tab[] = Array.from({ length: 25 }, (_, i) => ({
  id: `tab-${i}`, request: blankRequest(), dirty: false, loading: false,
  response: { status: 200, statusText: 'OK', headers: {}, body: 'x'.repeat(250_000), contentType: 'text/plain', ms: 1, size: 250_000 },
}))
test('frontend hardening microbenchmarks', async ({ bench }) => {
  await bench('benchmark comparison 10 samples', { writeResult: '.artifacts/performance-comparison.json' }, () => { compareBenchmarkSamples(current, baseline, 5) }).run({ time: 100, iterations: 20 })
  await bench('split 25 response tabs for persistence', { writeResult: '.artifacts/performance-tabs.json' }, () => { splitTabsForPersistence(tabs, 'tab-0', []) }).run({ time: 100, iterations: 20 })
})
