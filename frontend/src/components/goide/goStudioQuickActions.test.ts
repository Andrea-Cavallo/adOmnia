import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/goide-api', () => ({ selectGoIDEFolder: vi.fn(), startGoIDEDependencyAction: vi.fn() }))
vi.mock('@/lib/confirmDialog', () => ({ confirm: vi.fn() }))
vi.mock('@/stores/goide', () => ({ useGoIDEStore: { getState: vi.fn(), setState: vi.fn() }, activeGoIDEDocument: vi.fn() }))
vi.mock('@/stores/goideTests', () => ({ useGoIDETestsStore: { getState: vi.fn() } }))
vi.mock('@/stores/goideVcs', () => ({ useGoIDEVCSStore: { getState: vi.fn() } }))

import { changedPackageTestRequests, fuzzReplayRequestForTarget, fuzzRunRequestForTarget, moduleScopeFor, quickRunFor, testRequestForTarget } from './goStudioQuickActions'

const session = (modules: string[]) => ({
  project: { realPath: '/work/repo', units: modules.map((root) => ({ language: 'go', kind: 'module', root, name: '' })) },
}) as unknown as Parameters<typeof moduleScopeFor>[0]

describe('moduleScopeFor', () => {
  it('runs from the innermost module that owns the file', () => {
    const repo = session(['/work/repo', '/work/repo/tools/gen'])
    expect(moduleScopeFor(repo, 'internal/api/server.go')).toEqual({ moduleDirectory: '', packageTarget: './internal/api' })
    expect(moduleScopeFor(repo, 'tools/gen/cmd/main.go')).toEqual({ moduleDirectory: 'tools/gen', packageTarget: './cmd' })
    expect(moduleScopeFor(repo, 'tools/gen/gen.go')).toEqual({ moduleDirectory: 'tools/gen', packageTarget: '.' })
  })

  it('falls back to the first module without an active file and handles Windows paths', () => {
    expect(moduleScopeFor(session(['/work/repo/svc']), null)).toEqual({ moduleDirectory: 'svc', packageTarget: '.' })
    const windows = { project: { realPath: 'C:\\work\\repo', units: [{ language: 'go', kind: 'module', root: 'C:\\work\\repo\\svc', name: '' }] } } as unknown as Parameters<typeof moduleScopeFor>[0]
    expect(moduleScopeFor(windows, 'svc/api/a.go')).toEqual({ moduleDirectory: 'svc', packageTarget: './api' })
  })

  it('uses the project root for files outside every module', () => {
    expect(moduleScopeFor(session(['/work/repo/svc']), 'scripts/x.go')).toEqual({ moduleDirectory: '', packageTarget: './scripts' })
    expect(moduleScopeFor(session([]), 'x/y.go')).toEqual({ moduleDirectory: '', packageTarget: './x' })
  })
})

describe('quickRunFor', () => {
  it('targets the package or every package of the module', () => {
    const scope = { moduleDirectory: 'svc', packageTarget: './api' }
    expect(quickRunFor('vet', 'package', scope)).toEqual({ kind: 'vet', workingDirectory: 'svc', target: './api', label: 'go vet ./api' })
    expect(quickRunFor('build', 'module', scope)).toEqual({ kind: 'build', workingDirectory: 'svc', target: './...', label: 'go build ./...' })
  })
})

describe('testRequestForTarget', () => {
  it('runs exactly one test or benchmark in its module', () => {
    const repo = { ...session(['/work/repo', '/work/repo/tools/gen']), id: 's1' }
    expect(testRequestForTarget(repo, { line: 3, kind: 'test', name: 'TestParse', packagePath: './tools/gen/parser' })).toMatchObject({ workingDirectory: 'tools/gen', packages: ['./parser'], run: '^TestParse$', bench: '' })
    expect(testRequestForTarget(repo, { line: 9, kind: 'benchmark', name: 'BenchmarkX', packagePath: '.' }, true)).toMatchObject({ workingDirectory: '', packages: ['.'], run: '', bench: '^BenchmarkX$', coverage: true })
  })

  it('starts a fuzz target with an explicit bounded duration', () => {
    const repo = { ...session(['/work/repo', '/work/repo/tools/gen']), id: 's1' }
    expect(fuzzRunRequestForTarget(repo, { line: 9, kind: 'fuzz', name: 'FuzzParse', packagePath: './tools/gen/parser' })).toEqual({
      workingDirectory: 'tools/gen', target: './parser', programArguments: ['-run', '^$', '-fuzz', '^FuzzParse$', '-fuzztime=30s'],
    })
    const target = { line: 9, kind: 'fuzz' as const, name: 'FuzzParse', packagePath: './tools/gen/parser' }
    expect(fuzzRunRequestForTarget(repo, target, '', 4).programArguments).toEqual(['-run', '^$', '-fuzz', '^FuzzParse$', '-parallel=4'])
    expect(fuzzReplayRequestForTarget(repo, target, 'a1b2').programArguments).toEqual(['-run', '^FuzzParse$/^a1b2$', '-v'])
  })
})

describe('changedPackageTestRequests', () => {
  it('tests each changed Go package once, grouped by module, skipping deletions and non-Go files', () => {
    const repo = { id: 's', ...session(['/work/repo', '/work/repo/tools/gen']) }
    const change = (relativePath: string, status = 'M') => ({ relativePath, status, staged: false, untracked: false, conflicted: false })
    expect(changedPackageTestRequests(repo, [
      change('internal/api/server.go'), change('internal/api/server_test.go'), change('main.go', '??'),
      change('internal/old/gone.go', 'D'), change('README.md'), change('tools/gen/gen.go'),
    ])).toEqual([
      { sessionId: 's', workingDirectory: '', packages: ['.', './internal/api'], run: '', bench: '', coverage: false },
      { sessionId: 's', workingDirectory: 'tools/gen', packages: ['.'], run: '', bench: '', coverage: false },
    ])
    expect(changedPackageTestRequests(repo, [change('docs/a.md')])).toEqual([])
  })
})
