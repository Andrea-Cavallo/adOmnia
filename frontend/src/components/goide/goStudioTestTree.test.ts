import { describe, expect, it } from 'vitest'
import type { GoIDETestResult, GoIDETestRun } from '@/lib/goide-tests-api'
import { buildTestTree, filterTestTree, isFlaky, isSlow, onlyFailed, onlyFlaky, packagePattern, repeatRequestForNode, repetitionStats, reproduceRequest, requestForNode, rerunFailedRequest, runPatternFor } from './goStudioTestTree'

const node = (pkg: string, name: string, status: string, extra: Partial<GoIDETestResult> = {}): GoIDETestResult => ({
  id: name ? `${pkg}\u0000${name}` : pkg,
  parentId: name ? (name.includes('/') ? `${pkg}\u0000${name.slice(0, name.lastIndexOf('/'))}` : pkg) : undefined,
  package: pkg, name, status, elapsedMillis: 0, ...extra,
} as GoIDETestResult)

const run = (results: GoIDETestResult[], workingDirectory = 'svc'): GoIDETestRun => ({
  runId: 'r', sessionId: 's', command: '', status: 'finished', startedAt: '', summary: { passed: 0, failed: 0, skipped: 0, running: 0 },
  request: { sessionId: 's', workingDirectory, packages: ['./...'], coverage: true }, results,
} as unknown as GoIDETestRun)

const results = [
  node('example.com/svc/api', '', 'fail', { directory: 'svc/api' }),
  node('example.com/svc/api', 'TestAdd', 'fail'),
  node('example.com/svc/api', 'TestAdd/negative', 'fail'),
  node('example.com/svc/api', 'TestAdd/positive', 'pass'),
  node('example.com/svc/api', 'TestOK', 'pass'),
  node('example.com/svc/db', '', 'pass', { directory: 'svc/db' }),
  node('example.com/svc/db', 'TestDB', 'pass'),
]

describe('test tree', () => {
  it('nests packages, tests and subtests', () => {
    const tree = buildTestTree(results)
    expect(tree.map((item) => item.label)).toEqual(['example.com/svc/api', 'example.com/svc/db'])
    expect(tree[0].children.map((item) => item.label)).toEqual(['TestAdd', 'TestOK'])
    expect(tree[0].children[0].children.map((item) => item.label)).toEqual(['negative', 'positive'])
    expect(onlyFailed(tree).map((item) => item.label)).toEqual(['example.com/svc/api'])
    expect(onlyFailed(tree)[0].children[0].children.map((item) => item.label)).toEqual(['negative'])
  })

  it('anchors every level of a subtest and escapes regex characters', () => {
    expect(runPatternFor('TestAdd/negative')).toBe('^TestAdd$/^negative$')
    expect(runPatternFor('TestParse/a.b(c)')).toBe('^TestParse$/^a\\.b\\(c\\)$')
  })

  it('builds package patterns relative to the module', () => {
    expect(packagePattern('svc/api', 'svc')).toBe('./api')
    expect(packagePattern('svc', 'svc')).toBe('.')
    expect(packagePattern('calc', '')).toBe('./calc')
  })
})

describe('test tree filters', () => {
  it('keeps package context for matching test names and detects slow tests', () => {
    const tree = buildTestTree([
      node('example.com/p', '', 'pass'),
      node('example.com/p', 'TestFast', 'pass', { elapsedMillis: 20 }),
      node('example.com/p', 'TestSlow', 'pass', { elapsedMillis: 1200 }),
    ])
    const filtered = filterTestTree(tree, (result) => (result.name ?? '').toLowerCase().includes('slow'))
    expect(filtered).toHaveLength(1)
    expect(filtered[0].children.map((item) => item.result.name)).toEqual(['TestSlow'])
    expect(isSlow(tree[0].children[0].result)).toBe(false)
    expect(isSlow(tree[0].children[1].result)).toBe(true)
  })
})

describe('rerun requests', () => {
  it('reruns only failed top-level tests in their packages, without coverage', () => {
    expect(rerunFailedRequest(run(results))).toMatchObject({ packages: ['./api'], run: '^(TestAdd)$', coverage: false })
  })

  it('reruns a whole package that failed to build and returns null when all passed', () => {
    const broken = [node('example.com/svc/x', '', 'fail', { directory: 'svc/x', buildFailed: true })]
    expect(rerunFailedRequest(run(broken))).toMatchObject({ packages: ['./x'], run: '' })
    expect(rerunFailedRequest(run([node('p', '', 'pass'), node('p', 'TestA', 'pass')]))).toBeNull()
  })

  it('reruns a single subtest exactly', () => {
    expect(requestForNode(run(results), results[2])).toMatchObject({ packages: ['./api'], run: '^TestAdd$/^negative$', bench: '' })
  })
})

describe('flaky detector', () => {
  const flaky = node('example.com/svc/api', 'TestRace', 'fail', { runs: 4, failures: 1, minMillis: 2, maxMillis: 40, totalMillis: 60 })
  const broken = node('example.com/svc/api', 'TestBroken', 'fail', { runs: 4, failures: 4 })
  const pkg = node('example.com/svc/api', '', 'fail', { directory: 'svc/api', shuffleSeed: '42' })
  it('flags only tests that both passed and failed', () => {
    expect(isFlaky(flaky)).toBe(true)
    expect(isFlaky(broken)).toBe(false)
    expect(isFlaky(node('p', 'TestOnce', 'fail', { runs: 1, failures: 1 }))).toBe(false)
    expect(onlyFlaky(buildTestTree([pkg, flaky, broken]))[0].children.map((item) => item.label)).toEqual(['TestRace'])
  })
  it('summarises the repetitions', () => {
    expect(repetitionStats(flaky)).toEqual({ runs: 4, failures: 1, failureRate: 0.25, minMillis: 2, avgMillis: 15, maxMillis: 40 })
    expect(repetitionStats(node('p', 'T', 'pass', { runs: 1 }))).toBeNull()
  })
  it('repeats a test shuffled and replays the shuffle seed', () => {
    const current = run([pkg, flaky])
    expect(repeatRequestForNode(current, flaky, 50)).toMatchObject({ packages: ['./api'], run: '^TestRace$', repeat: 50, shuffle: 'on' })
    expect(reproduceRequest(current, pkg)).toMatchObject({ packages: ['./api'], run: '', shuffle: '42' })
    expect(reproduceRequest(current, node('p', '', 'pass'))).toBeNull()
  })
})
