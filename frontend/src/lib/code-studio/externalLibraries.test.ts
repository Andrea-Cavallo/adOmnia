import { describe, expect, it } from 'vitest'
import type { GoIDEDependencyState } from '@/lib/code-studio-api'
import { displayName, displayVersion, libraryOfPath, mergeLibraries, type ExternalLibrary } from './externalLibraries'

function state(moduleDirectory: string, dependencies: Array<[string, string, boolean?]>, replacements: Array<Record<string, unknown>> = []): GoIDEDependencyState {
  return { moduleDirectory, dependencies: dependencies.map(([path, version, indirect]) => ({ path, version, indirect: !!indirect })), replacements } as unknown as GoIDEDependencyState
}

function library(overrides: Partial<ExternalLibrary>): ExternalLibrary {
  return { path: 'example.com/lib', version: 'v1.0.0', indirect: false, moduleDirectory: '', replaced: false, local: false, ...overrides }
}

describe('mergeLibraries', () => {
  it('lists every go.mod once per module@version, direct first, without the modules of the project', () => {
    const merged = mergeLibraries([
      state('/a', [['z.example/direct', 'v1.0.0'], ['b.example/lib', 'v1.0.0', true], ['own.example/mod', 'v0.1.0']]),
      state('/b', [['b.example/lib', 'v1.0.0'], ['b.example/lib', 'v2.0.0', true]]),
    ], new Set(['own.example/mod']))
    expect(merged.map((item) => `${item.path}@${item.version}`)).toEqual(['b.example/lib@v1.0.0', 'z.example/direct@v1.0.0', 'b.example/lib@v2.0.0'])
    expect(merged[0]).toMatchObject({ indirect: false, moduleDirectory: '/a' })
  })

  it('marks replaces, honouring a replace bound to another version', () => {
    const merged = mergeLibraries([state('/a', [['a.example/local', 'v1.0.0'], ['a.example/other', 'v1.0.0']], [
      { path: 'a.example/local', newPath: '../local', local: true },
      { path: 'a.example/other', version: 'v9.0.0', newPath: 'fork.example/other', newVersion: 'v9.0.1', local: false },
    ])], new Set())
    expect(merged[0]).toMatchObject({ replaced: true, local: true })
    expect(merged[1]).toMatchObject({ replaced: false, local: false })
  })
})

describe('libraryOfPath', () => {
  it('finds the module cache folder, escaped as Go writes it, on Windows paths', () => {
    const azure = library({ path: 'github.com/Azure/sdk', version: 'v1.2.0-RC1' })
    expect(libraryOfPath('C:\\Users\\me\\go\\pkg\\mod\\github.com\\!azure\\sdk@v1.2.0-!r!c1\\Pkg\\A.go', [library({}), azure])).toEqual({ library: azure, file: 'Pkg/A.go' })
  })

  it('finds a replace by its folder, not by the cache of the original', () => {
    const replaced = library({ replaced: true, local: true, directory: 'C:\\work\\lib' })
    expect(libraryOfPath('C:/Work/lib/pkg/a.go', [replaced])).toEqual({ library: replaced, file: 'pkg/a.go' })
    expect(libraryOfPath('C:/mod/example.com/lib@v1.0.0/a.go', [replaced])).toBeNull()
  })

  it('ignores files of other versions, of the SDK and of folders with a similar name', () => {
    const libraries = [library({})]
    expect(libraryOfPath('C:/mod/example.com/lib@v1.0.1/a.go', libraries)).toBeNull()
    expect(libraryOfPath('C:/go/src/fmt/print.go', libraries)).toBeNull()
    expect(libraryOfPath('C:/work/lib2/a.go', [library({ replaced: true, directory: 'C:/work/lib' })])).toBeNull()
  })
})

describe('displayName', () => {
  it('drops the host, keeping names without one', () => {
    expect(displayName('github.com/BurntSushi/toml')).toBe('BurntSushi/toml')
    expect(displayName('gitlab.corp.it/group/sub/mod/v2')).toBe('group/sub/mod/v2')
    expect(displayName('example.com')).toBe('example.com')
    expect(displayName('corp/internal/mod')).toBe('corp/internal/mod')
  })
})

describe('displayVersion', () => {
  it('turns a pseudo-version into commit and date, and leaves releases alone', () => {
    expect(displayVersion('v0.0.0-20261001120000-abcdef123456')).toBe('abcdef1 · 2026-10-01')
    expect(displayVersion('v1.2.4-0.20261001120000-abcdef123456')).toBe('abcdef1 · 2026-10-01')
    expect(displayVersion('v2.0.0-pre.0.20261001120000-abcdef123456+incompatible')).toBe('abcdef1 · 2026-10-01')
    expect(displayVersion('v1.2.3')).toBe('v1.2.3')
    expect(displayVersion('v1.2.3-rc.1')).toBe('v1.2.3-rc.1')
  })
})
