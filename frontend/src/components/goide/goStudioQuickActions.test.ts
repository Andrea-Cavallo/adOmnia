import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/goide-api', () => ({ selectGoIDEFolder: vi.fn(), startGoIDEDependencyAction: vi.fn() }))
vi.mock('@/lib/confirmDialog', () => ({ confirm: vi.fn() }))
vi.mock('@/stores/goide', () => ({ useGoIDEStore: { getState: vi.fn(), setState: vi.fn() }, activeGoIDEDocument: vi.fn() }))

import { moduleScopeFor, quickRunFor } from './goStudioQuickActions'

const session = (modules: string[]) => ({
  project: { realPath: '/work/repo', modules: modules.map((path) => ({ path, modulePath: '' })) },
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
    const windows = { project: { realPath: 'C:\\work\\repo', modules: [{ path: 'C:\\work\\repo\\svc', modulePath: '' }] } } as unknown as Parameters<typeof moduleScopeFor>[0]
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
