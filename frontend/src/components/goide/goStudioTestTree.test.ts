import { describe, expect, it } from 'vitest'
import type { GoIDETestResult, GoIDETestRun } from '@/lib/goide-tests-api'
import { buildTestTree, onlyFailed, packagePattern, requestForNode, rerunFailedRequest, runPatternFor } from './goStudioTestTree'

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
