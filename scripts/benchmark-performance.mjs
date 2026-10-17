// Run from any directory: node scripts/benchmark-performance.mjs [--baseline report.json]
// All output stays local. No timing threshold is used as a CI gate.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus, totalmem, platform, arch } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadReport, parseGoBenchmarks, renderDashboard, comparable, comparisons } from './performance-report.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const frontend = resolve(root, 'frontend')
const args = process.argv.slice(2)
const options = {}
for (let i = 0; i < args.length; i += 2) {
  if (!['--baseline', '--out', '--conditions'].includes(args[i]) || !args[i + 1]) throw new Error('Expected --baseline, --out or --conditions followed by a value')
  options[args[i].slice(2)] = args[i + 1]
}
const createdAt = new Date().toISOString()
const out = resolve(root, options.out ?? `.artifacts/performance/${createdAt.replace(/[:.]/g, '-')}`)
const run = (command, argv, cwd = root) => execFileSync(command, argv, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 600_000, windowsHide: true })
const baseline = options.baseline ? loadReport(resolve(options.baseline)) : null
const commit = run('git', ['rev-parse', 'HEAD']).trim()
const dirty = !!run('git', ['status', '--porcelain', '--untracked-files=no']).trim()
mkdirSync(out, { recursive: true })
try {
 console.log('Running lifecycle checks...')
 const lifecycle = run('go', ['test', './internal/ide/process', './internal/codestudio', '-run', 'Job|SessionCycles', '-count=1', '-v', '-timeout', '2m'])
 writeFileSync(resolve(out, 'lifecycle.txt'), lifecycle)
 console.log('Running backend benchmarks (3 samples, 100ms each)...')
 const goOutput = run('go', ['test', './internal/ide/graph', './internal/codestudio', '-run', '^$', '-bench', 'BenchmarkWorkspaceFingerprint|BenchmarkDependencyGraph|BenchmarkReleaseRepository', '-benchmem', '-benchtime=100ms', '-count=3', '-timeout', '10m'])
 writeFileSync(resolve(out, 'go-bench.txt'), goOutput)
 console.log('Running frontend CPU benchmarks...')
 const vitest = run(process.execPath, [resolve(frontend, 'node_modules/vitest/vitest.mjs'), 'bench', '--run', 'src/components/code-studio/performance.bench.ts'], frontend)
 writeFileSync(resolve(out, 'frontend-bench.txt'), vitest)
 const frontendMetrics = [['benchmark comparison 10 samples', 'performance-comparison.json'], ['split 25 response tabs', 'performance-tabs.json']].map(([name, file]) => {
  const raw = JSON.parse(readFileSync(resolve(frontend, '.artifacts', file), 'utf8'))
  writeFileSync(resolve(out, file), JSON.stringify(raw, null, 2))
  return { name, unit: 'ms/op', samples: [raw.latency.p50] }
 })
 console.log('Checking startup production graph...')
 const startup = JSON.parse(run(process.execPath, ['scripts/check-startup-bundle.mjs'], frontend))
 const report = {
  version: 1, kind: 'developer-microbenchmark', createdAt, commit, dirty,
  environment: { protocol: 1, platform: platform(), arch: arch(), cpu: cpus()[0]?.model ?? 'unknown', logicalCPUs: cpus().length, totalMemoryBytes: totalmem(), go: run('go', ['version']).trim(), node: process.version, conditions: options.conditions ?? 'Developer workstation; background workload uncontrolled; not a native release baseline.' },
  startup, metrics: [...parseGoBenchmarks(goOutput), ...frontendMetrics],
  nativeBaseline: 'pending', timingGate: false,
 }
 if (!report.metrics.length || report.metrics.some(metric => metric.samples.some(value => !Number.isFinite(value)))) throw new Error('Invalid benchmark samples')
 report.comparison = baseline ? { baselineCommit: baseline.commit, baselineCreatedAt: baseline.createdAt, compatible: comparable(report.environment, baseline.environment), rows: comparisons(report, baseline) } : null
 writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2))
 writeFileSync(resolve(out, 'index.html'), renderDashboard(report, baseline))
 console.log(`Local report: ${resolve(out, 'index.html')}`)
} catch (error) {
 writeFileSync(resolve(out, 'failure.txt'), String(error) + '\n' + (error.stdout ?? '') + '\n' + (error.stderr ?? ''))
 console.error(`Benchmark failed; see ${resolve(out, 'failure.txt')}`)
 process.exitCode = 1
}
