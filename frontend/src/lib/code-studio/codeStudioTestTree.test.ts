import { describe, expect, it } from 'vitest'
import type { GoIDETestResult, GoIDETestRun } from '@/lib/code-studio-tests-api'
import { buildTestTree, filterTestTree, cpuCorrelationRequestForNode, cpuCorrelationVerdict, failureRateByCPU, flakyCauses, isFlaky, raceRepeatRequestForNode, reproduceCommandFor, isSlow, onlyFailed, onlyFlaky, packagePattern, repeatRequestForNode, repetitionStats, reproduceRequest, requestForNode, rerunFailedRequest, runPatternFor, isGoTestRun, isPythonTestRun, namePatternFor, pythonNodeId, pythonRerunFailedRequest, rollupOf, rustDebugRequestForNode } from './codeStudioTestTree'

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

describe('flaky causes', () => {
  it('reads hints from the output of every repetition', () => {
    expect(flakyCauses('==================\nWARNING: DATA RACE\nWrite at 0x00c', false)[0]).toMatch(/^Data race/)
    expect(flakyCauses('dial tcp 127.0.0.1:5432: connect: connection refused', false)[0]).toMatch(/^External dependency/)
    expect(flakyCauses('    x_test.go:12: context deadline exceeded', false)[0]).toMatch(/^Timing/)
    expect(flakyCauses('    x_test.go:12: got 2 want 3', true)[0]).toMatch(/^Order dependency/)
    expect(flakyCauses('    x_test.go:12: got 2 want 3', false)).toEqual([])
  })
  it('reruns a test with the race detector', () => {
    const current = run([node('example.com/svc/api', '', 'fail', { directory: 'svc/api' }), node('example.com/svc/api', 'TestRace', 'fail')])
    expect(raceRepeatRequestForNode(current, current.results[1], 20)).toMatchObject({ run: '^TestRace$', repeat: 20, shuffle: 'on', race: true })
  })
})

describe('reproduce command', () => {
  it('rebuilds the go test command with repetitions, seed and race', () => {
    const current = { ...run([node('example.com/svc/api', '', 'fail', { directory: 'svc/api', shuffleSeed: '42' }), node('example.com/svc/api', 'TestRace/case 1', 'fail')]), request: { sessionId: 's', workingDirectory: 'svc', packages: ['./...'], repeat: 20, shuffle: 'on', race: true, buildTags: ['integration'] } } as unknown as GoIDETestRun
    expect(reproduceCommandFor(current, current.results[1])).toBe("cd svc && go test -count=20 -shuffle=42 -race -tags integration -run '^TestRace$/^case 1$' ./api")
  })
})

describe('concurrency correlation', () => {
  it('splits outcomes per -cpu value and explains the trend', () => {
    const base = run([node('example.com/svc/api', '', 'fail', { directory: 'svc/api' }), node('example.com/svc/api', 'TestRace', 'fail', { runs: 8, failures: 3, outcomes: 'PPPFPFPF' })])
    expect(cpuCorrelationRequestForNode(base, base.results[1], 10)).toMatchObject({ run: '^TestRace$', repeat: 10, cpu: [1, 2, 4, 8] })
    const correlated = { ...base, request: { ...base.request, repeat: 2, cpu: [1, 2, 4, 8] } } as unknown as GoIDETestRun
    const rates = failureRateByCPU(correlated, correlated.results[1])
    expect(rates).toEqual([{ cpu: 1, runs: 2, failures: 0 }, { cpu: 2, runs: 2, failures: 1 }, { cpu: 4, runs: 2, failures: 1 }, { cpu: 8, runs: 2, failures: 1 }])
    expect(cpuCorrelationVerdict(rates)).toMatch(/only with parallelism \(GOMAXPROCS ≥ 2\)/)
    expect(failureRateByCPU(base, base.results[1])).toEqual([])
  })
})

describe('JS/TS test runs', () => {
  const jsRun = (workingDirectory = 'web') => ({ ...run([], workingDirectory), request: { sessionId: 's', language: 'typescript', workingDirectory, packages: [], coverage: false } }) as unknown as GoIDETestRun

  it('tells Go runs from other runners, including runs saved without a language', () => {
    expect(isGoTestRun(run([]))).toBe(true)
    expect(isGoTestRun(jsRun())).toBe(false)
  })

  it('reruns one JS test by file and by its describe/test names, relative to the unit folder', () => {
    const test = node('web/src/sum.test.ts', 'sum/edge∕cases/overflows', 'fail')
    expect(requestForNode(jsRun(), test)).toMatchObject({ language: 'typescript', packages: ['src/sum.test.ts'], run: String.raw`sum[\x20\x3e]+edge\x2fcases[\x20\x3e]+overflows$`, coverage: false })
  })

  it('reruns a whole JS file without a name filter', () => {
    expect(requestForNode(jsRun(''), node('src/sum.test.ts', '', 'fail'))).toMatchObject({ packages: ['src/sum.test.ts'], run: '' })
    expect(namePatternFor('a(b)')).toBe(String.raw`a\x28b\x29$`)
    // Nessuno spazio né simbolo di cmd.exe nell'argomento: `npm.cmd` passa da cmd e `&`, `|`, `^`, `%` verrebbero interpretati.
    expect(namePatternFor('x & y | z ^ 100% "q" é')).toMatch(/^[A-Za-z0-9_\\$]+$/)
  })
})

describe('Java roll-up and multi-method rerun', () => {
  const javaRun = (results: GoIDETestResult[]): GoIDETestRun => ({ ...run(results), request: { ...run(results).request, language: 'java', workingDirectory: '' } } as GoIDETestRun)
  const file = 'src/test/java/a/FooTest.java'
  const results = [node(file, '', 'fail'), node(file, 'one', 'fail'), node(file, 'two', 'fail'), node(file, 'three', 'pass'), node(file, 'four', 'skip')]

  it('counts the leaves of a class', () => {
    expect(rollupOf(buildTestTree(results)[0])).toEqual({ passed: 1, failed: 2, skipped: 1 })
  })

  it('reruns several failed methods of one class together', () => {
    expect(rerunFailedRequest(javaRun(results))).toMatchObject({ packages: [file], run: 'one,two' })
  })

  it('falls back to the whole class when a failed test has a display name', () => {
    expect(rerunFailedRequest(javaRun([node(file, '', 'fail'), node(file, 'one', 'fail'), node(file, 'a > b', 'fail')]))).toMatchObject({ run: '' })
  })
})

describe('Python test runs', () => {
  const pyRun = (results: GoIDETestResult[], workingDirectory = ''): GoIDETestRun =>
    ({ ...run(results, workingDirectory), request: { ...run(results, workingDirectory).request, language: 'python', workingDirectory, packages: ['tests'], coverage: false } }) as GoIDETestRun

  it('tells pytest runs from the other runners', () => {
    expect(isPythonTestRun(pyRun([]))).toBe(true)
    expect(isPythonTestRun(run([]))).toBe(false)
  })

  it('rebuilds the pytest node id from the file and the /-joined name', () => {
    expect(pythonNodeId(node('tests/test_demo.py', 'TestBox/test_ok[param∕1]', 'pass'))).toBe('tests/test_demo.py::TestBox::test_ok[param/1]')
    expect(pythonNodeId(node('tests/test_demo.py', 'TestBox/test_ok', 'pass'))).toBe('tests/test_demo.py::TestBox::test_ok')
    expect(pythonNodeId(node('tests/test_demo.py', '', 'fail'))).toBe('tests/test_demo.py')
  })

  it('reruns one node by its exact node id, without a run filter', () => {
    const test = node('tests/test_demo.py', 'TestBox/test_ok[param∕1]', 'fail')
    expect(requestForNode(pyRun([test]), test)).toMatchObject({ language: 'python', packages: ['tests/test_demo.py::TestBox::test_ok[param/1]'], run: '', coverage: false })
  })

  it('reruns a whole test file from its package node', () => {
    const file = node('tests/test_demo.py', '', 'fail')
    expect(requestForNode(pyRun([file]), file)).toMatchObject({ packages: ['tests/test_demo.py'], run: '' })
  })

  it('reruns failed node ids, or the whole file when the file failed without failed tests', () => {
    const results = [
      node('tests/test_a.py', '', 'fail'),
      node('tests/test_a.py', 'TestA/test_one', 'fail'),
      node('tests/test_a.py', 'TestA/test_two', 'pass'),
      node('tests/test_b.py', '', 'fail'),
    ]
    const expected = { packages: ['tests/test_a.py::TestA::test_one', 'tests/test_b.py'], run: '', coverage: false }
    expect(pythonRerunFailedRequest(pyRun(results))).toMatchObject(expected)
    expect(rerunFailedRequest(pyRun(results))).toMatchObject(expected)
    expect(pythonRerunFailedRequest(pyRun([node('tests/test_ok.py', '', 'pass'), node('tests/test_ok.py', 'TestOk', 'pass')]))).toBeNull()
  })
})

describe('Rust test runs', () => {
  const rustRun = (results: GoIDETestResult[]): GoIDETestRun =>
    ({ ...run(results, 'crates/api'), request: { ...run(results, 'crates/api').request, language: 'rust', packages: [], coverage: false } }) as GoIDETestRun

  it('reruns a single test by its libtest path, not a Vitest or Go pattern', () => {
    const test = node('api', 'tests/it_works', 'fail')
    expect(requestForNode(rustRun([node('api', 'tests', 'fail'), test]), test)).toMatchObject({ language: 'rust', packages: [], run: 'tests::it_works' })
  })

  it('drops the integration test file prefix and keeps doctest names as they are', () => {
    const integration = node('api', 'tests/api.rs/health_check', 'fail')
    expect(requestForNode(rustRun([integration]), integration).run).toBe('health_check')
    const doctest = node('api', 'src/lib.rs - add (line 3)', 'fail')
    expect(requestForNode(rustRun([doctest]), doctest).run).toBe('src/lib.rs - add (line 3)')
  })

  it('reruns a module node by prefix and a package node as a whole suite', () => {
    const module = node('api', 'tests', 'fail')
    const child = node('api', 'tests/it_works', 'fail')
    expect(requestForNode(rustRun([module, child]), module).run).toBe('tests::')
    expect(requestForNode(rustRun([node('api', '', 'fail')]), node('api', '', 'fail')).run).toBe('')
  })

  it('reruns every failed leaf test in one request, or everything when the build failed', () => {
    const results = [node('api', 'tests', 'fail'), node('api', 'tests/a', 'fail'), node('api', 'tests/b', 'fail'), node('api', 'tests/c', 'pass')]
    expect(rerunFailedRequest(rustRun(results))).toMatchObject({ packages: [], run: 'tests::a\ntests::b' })
    expect(rerunFailedRequest(rustRun([node('api', '', 'fail', { buildFailed: true })]))?.run).toBe('')
    expect(rerunFailedRequest(rustRun([node('api', 'tests/c', 'pass')]))).toBeNull()
  })

  it('debugs a single test keeping the tree name, so the backend picks the right test binary (RS-5.5)', () => {
    const unit = node('api', 'tests/it_works', 'fail')
    expect(rustDebugRequestForNode(rustRun([unit]), unit)).toMatchObject({ test: 'tests/it_works', workingDirectory: 'crates/api' })
    // Il nome dell'albero del test di integrazione porta il file: serve a scegliere `cargo test --no-run --test`.
    const integration = node('api', 'tests/api.rs/health_check', 'fail')
    expect(rustDebugRequestForNode(rustRun([integration]), integration)).toMatchObject({ test: 'tests/api.rs/health_check' })
    // I doctest non hanno binario compilato: niente richiesta di debug (limite dichiarato).
    const doctest = node('api', 'src/lib.rs - add (line 3)', 'fail')
    expect(rustDebugRequestForNode(rustRun([doctest]), doctest)).toBeNull()
  })
})
