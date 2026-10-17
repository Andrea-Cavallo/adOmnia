import { describe, expect, it, vi } from 'vitest'
import type { GoIDEDependencySource } from '@/lib/code-studio-api'

const fixture = vi.hoisted(() => ({ state: { sessions: [] as unknown[], activeSessionId: 's1' } }))

vi.mock('@/lib/monacoSetup', () => ({ monaco: { Uri: { file: (path: string) => ({ toString: () => `file:///${path.replace(/\\/g, '/')}` }) } } }))
vi.mock('@/stores/codeStudio', () => ({ useCodeStudioStore: { getState: () => fixture.state, setState: vi.fn() } }))
vi.mock('@/lib/code-studio-api', () => ({ resolveGoIDEDependencySource: vi.fn(), startGoIDEDependencyAction: vi.fn() }))
vi.mock('@/lib/confirmDialog', () => ({ confirm: vi.fn() }))
vi.mock('@/lib/codeStudioFilePicker', () => ({ pickGoIDEFile: vi.fn() }))
vi.mock('./codeStudioQuickActions', () => ({ goModDirectoryOf: () => '' }))
vi.mock('./codeStudioNavigation', () => ({ navigateToLocation: vi.fn() }))

import { entryFileOf, goModDependencyAt, goModSourceLocation } from './codeStudioDependencySource'

const GO_MOD = `module example.com/app

go 1.23

require example.com/lib v1.0.0

replace example.com/lib => ../lib
`

function source(overrides: Partial<GoIDEDependencySource> = {}): GoIDEDependencySource {
  return {
    found: true, kind: 'module-cache', modulePath: 'example.com/lib', version: 'v1.0.0',
    directory: 'C:/mod/cache/example.com/lib@v1.0.0', relativeDir: '', entryFile: '',
    entryPath: 'lib.go', entryRelative: '', downloaded: true, files: [],
    ...overrides,
  } as unknown as GoIDEDependencySource
}

describe('goModDependencyAt', () => {
  it('finds the module of a require or replace line, and nothing elsewhere', () => {
    expect(goModDependencyAt(GO_MOD, 5)).toBe('example.com/lib')
    expect(goModDependencyAt(GO_MOD, 7)).toBe('example.com/lib')
    expect(goModDependencyAt(GO_MOD, 1)).toBeNull()
    expect(goModDependencyAt(GO_MOD, 3)).toBeNull()
  })
})

describe('entryFileOf', () => {
  it('prefers the entry file of the module, then its first file', () => {
    expect(entryFileOf(source())).toBe('lib.go')
    expect(entryFileOf(source({ entryPath: '', files: [{ path: 'pkg/a.go', name: 'a.go' }] }))).toBe('pkg/a.go')
  })
})

describe('goModSourceLocation', () => {
  it('opens a module of the project in edit, on its relative path', () => {
    const location = goModSourceLocation(source({ kind: 'project', directory: 'C:/repo/lib', relativeDir: 'lib', entryRelative: 'lib/lib.go' }), 's1', 'pkg/a.go')
    expect(location).toMatchObject({ relativePath: 'lib/pkg/a.go', external: false, targetSessionId: 's1' })
  })

  it('opens the module cache read-only when the source is outside every project', () => {
    fixture.state.sessions = []
    const location = goModSourceLocation(source(), 's1', 'pkg/a.go')
    expect(location).toMatchObject({ relativePath: 'C:/mod/cache/example.com/lib@v1.0.0/pkg/a.go', external: true })
  })

  it('opens a dependency of another imported project in that project', () => {
    fixture.state.sessions = [{ id: 'other', project: { realPath: 'C:/shared', rootPath: 'C:/shared' } }]
    const nested = goModSourceLocation(source({ kind: 'local', directory: 'C:/shared/lib' }), 's1', 'pkg/a.go')
    expect(nested).toMatchObject({ relativePath: 'lib/pkg/a.go', external: false, targetSessionId: 'other' })

    fixture.state.sessions = [{ id: 'other', project: { realPath: 'C:/shared/lib', rootPath: 'C:/shared/lib' } }]
    const ownRoot = goModSourceLocation(source({ kind: 'local', directory: 'C:/shared/lib' }), 's1', 'pkg/a.go')
    expect(ownRoot).toMatchObject({ relativePath: 'pkg/a.go', external: false, targetSessionId: 'other' })
    fixture.state.sessions = []
  })
})
