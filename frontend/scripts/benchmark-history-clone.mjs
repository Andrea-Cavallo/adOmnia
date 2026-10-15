// Local microbenchmark only: this does not measure renderer or native launch time.
import { performance } from 'node:perf_hooks'
const value = { body: 'x'.repeat(1_000_000), headers: { test: 'value' }, meta: { flags: [1, 2, 3] } }
function medianMs(clone) {
  for (let i = 0; i < 20; i++) clone(value)
  const samples = []
  for (let i = 0; i < 100; i++) {
    const start = performance.now()
    clone(value)
    samples.push(performance.now() - start)
  }
  return samples.sort((a, b) => a - b)[50]
}
console.log(JSON.stringify({
  runtime: process.version,
  bodyBytes: value.body.length,
  jsonMedianMs: medianMs(value => JSON.parse(JSON.stringify(value))),
  structuredCloneMedianMs: medianMs(value => structuredClone(value)),
}, null, 2))
