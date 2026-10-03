import { describe, expect, it, vi } from 'vitest'
import type { GoIDEFileEntry } from '@/lib/goide-api'

vi.mock('@/lib/goide-api', () => ({ duplicateGoIDEPath: vi.fn(), moveGoIDEPath: vi.fn() }))
vi.mock('./goStudioFileHandoffs', () => ({ isApiCollectionCandidate: () => false, isPemCandidate: () => false }))
vi.mock('./goStudioQuickActions', async () => {
  const actual = await vi.importActual<typeof import('./goStudioQuickActions')>('./goStudioQuickActions')
  return { moduleScopeFor: actual.moduleScopeFor, quickRunFor: actual.quickRunFor }
})

const { buildTreeMenu, treeKeyAction } = await import('./goStudioTreeMenu')
const { freeName, goImportPath } = await import('./goStudioTreeActions')

const file = (relativePath: string): GoIDEFileEntry => ({ name: relativePath.split('/').pop()!, relativePath, directory: false } as GoIDEFileEntry)
const folder = (relativePath: string): GoIDEFileEntry => ({ name: relativePath.split('/').pop()!, relativePath, directory: true } as GoIDEFileEntry)
const context = { canPaste: false, vcsAvailable: true, hasGoModule: true }
const ids = (items: { id: string; submenu?: { id: string }[] }[]): string[] => items.flatMap((item) => [item.id, ...ids(item.submenu ?? [])])

describe('treeKeyAction', () => {
  const key = (value: string, modifiers: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>> = {}) =>
    treeKeyAction({ key: value, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...modifiers })

  it('maps the GoLand project view shortcuts', () => {
    expect(key('x', { ctrlKey: true })).toBe('cut')
    expect(key('c', { metaKey: true })).toBe('copy')
    expect(key('v', { ctrlKey: true })).toBe('paste')
    expect(key('C', { ctrlKey: true, shiftKey: true })).toBe('copyAbsolutePath')
    expect(key('C', { ctrlKey: true, shiftKey: true, altKey: true })).toBe('copyRelativePath')
    expect(key('F6', { shiftKey: true })).toBe('rename')
    expect(key('Delete')).toBe('delete')
  })

  it('leaves plain typing alone', () => {
    expect(key('c')).toBeNull()
    expect(key('v', { ctrlKey: true, altKey: true })).toBeNull()
  })
})

describe('buildTreeMenu', () => {
  it('offers the full IDE menu on a Go file', () => {
    const menu = ids(buildTreeMenu(file('internal/api/server.go'), context))
    for (const id of ['open', 'splitRight', 'cut', 'copy', 'paste', 'copyAbsolutePath', 'copyRelativePath', 'copyFileName', 'copyImportPath', 'findUsages', 'inspectCode', 'rename', 'refactorThis', 'moveToNewFile', 'toggleBookmark', 'showBookmarks', 'reformat', 'optimizeImports', 'delete', 'reloadFromDisk', 'testPackage', 'runCurrent', 'debugCurrent', 'terminal', 'reveal', 'localHistory', 'gitHistory']) {
      expect(menu).toContain(id)
    }
    expect(menu).not.toContain('findInFolder')
  })

  it('shows folder actions and hides file-only ones on a folder', () => {
    const menu = ids(buildTreeMenu(folder('internal'), context))
    expect(menu).toContain('findInFolder')
    expect(menu).not.toContain('open')
    expect(menu).not.toContain('localHistory')
    expect(menu).toContain('runCurrent')
    expect(menu).toContain('debugCurrent')
    expect(menu).toContain('refreshProject')
  })

  it('hides Go and Git entries where they do not apply', () => {
    const menu = ids(buildTreeMenu(file('README.md'), { ...context, vcsAvailable: false }))
    expect(menu).not.toContain('testPackage')
    expect(menu).not.toContain('findUsages')
    expect(menu).not.toContain('inspectCode')
    expect(menu).not.toContain('refactorThis')
    expect(menu).not.toContain('copyImportPath')
    expect(menu).not.toContain('gitHistory')
  })

  it('disables Paste with an empty clipboard', () => {
    const paste = buildTreeMenu(folder('internal'), context).find((item) => item.id === 'paste')
    expect(paste?.disabled).toBe(true)
  })
})

describe('freeName', () => {
  it('keeps the name when free and never overwrites', () => {
    expect(freeName('main.go', new Set(['util.go']))).toBe('main.go')
    expect(freeName('main.go', new Set(['main.go', 'main_copy.go']))).toBe('main_copy_copy.go')
  })
})

describe('goImportPath', () => {
  const session = {
    project: {
      realPath: '/work/app',
      units: [{ language: 'go', kind: 'module', root: '/work/app', name: 'example.com/app' }, { language: 'go', kind: 'module', root: '/work/app/tools', name: 'example.com/app/tools' }],
    },
  } as never

  it('joins the owning module path with the package folder', () => {
    expect(goImportPath(session, 'internal/api', true)).toBe('example.com/app/internal/api')
    expect(goImportPath(session, 'internal/api/server.go', false)).toBe('example.com/app/internal/api')
    expect(goImportPath(session, 'main.go', false)).toBe('example.com/app')
  })

  it('uses the innermost module', () => {
    expect(goImportPath(session, 'tools/gen', true)).toBe('example.com/app/tools/gen')
  })
})
