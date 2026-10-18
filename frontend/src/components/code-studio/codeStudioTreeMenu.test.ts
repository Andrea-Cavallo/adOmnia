import { describe, expect, it, vi } from 'vitest'
import type { GoIDEFileEntry } from '@/lib/code-studio-api'
import { moveGoIDEPath } from '@/lib/code-studio-api'
import { useCodeStudioStore } from '@/stores/codeStudio'

vi.mock('@/lib/code-studio-api', () => ({ duplicateGoIDEPath: vi.fn(), moveGoIDEPath: vi.fn() }))
vi.mock('./codeStudioFileHandoffs', () => ({ isApiCollectionCandidate: () => false, isPemCandidate: () => false }))
vi.mock('./codeStudioQuickActions', async () => {
  const actual = await vi.importActual<typeof import('./codeStudioQuickActions')>('./codeStudioQuickActions')
  return { moduleScopeFor: actual.moduleScopeFor, quickRunFor: actual.quickRunFor }
})

const { buildTreeMenu, treeKeyAction } = await import('./codeStudioTreeMenu')
const { freeName, goImportPath, moveTreePath, treeDropDestination } = await import('./codeStudioTreeActions')

const file = (relativePath: string): GoIDEFileEntry => ({ name: relativePath.split('/').pop()!, relativePath, directory: false } as GoIDEFileEntry)
const folder = (relativePath: string): GoIDEFileEntry => ({ name: relativePath.split('/').pop()!, relativePath, directory: true } as GoIDEFileEntry)
const context = { canPaste: false, vcsAvailable: true, hasGoModule: true, changedPaths: ['internal/api/server.go'] }
const ids = (items: { id: string; submenu?: { id: string }[] }[]): string[] => items.flatMap((item) => [item.id, ...ids(item.submenu ?? [])])

describe('treeKeyAction', () => {
  const key = (value: string, modifiers: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>> = {}) =>
    treeKeyAction({ key: value, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...modifiers })

  it('maps the GoLand project view shortcuts', () => {
    expect(key('x', { ctrlKey: true })).toBe('cut')
    expect(key('c', { metaKey: true })).toBe('copy')
    expect(key('v', { ctrlKey: true })).toBe('paste')
    expect(key('d', { ctrlKey: true })).toBe('compareWith')
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
    for (const id of ['open', 'splitRight', 'newGitignoreGo', 'cut', 'copy', 'paste', 'copyAbsolutePath', 'copyRelativePath', 'copyFileName', 'copyImportPath', 'findUsages', 'inspectCode', 'rename', 'semanticRename', 'refactorThis', 'moveToNewFile', 'moveSymbol', 'copyClasses', 'safeDelete', 'migratePackages', 'toggleBookmark', 'showBookmarks', 'reformat', 'optimizeImports', 'delete', 'reloadFromDisk', 'testPackage', 'runCurrent', 'debugCurrent', 'terminal', 'reveal', 'localHistory', 'gitPullQuick', 'gitResetHead', 'gitCommit', 'gitPull', 'gitPush', 'gitStage', 'gitUnstage', 'gitRevert', 'gitDiff', 'gitHistory', 'gitAnnotate', 'gitStudio', 'compareWith', 'createGist', 'diagramDependencies', 'diagramCalls', 'diagramInterfaces']) {
      expect(menu).toContain(id)
    }
    expect(menu).not.toContain('findInFolder')
  })

  it('offers Repair IDE on File (rebuild index) on files and folders', () => {
    const onFile = ids(buildTreeMenu(file('main.go'), context))
    const onFolder = ids(buildTreeMenu(folder('internal'), context))
    expect(onFile).toContain('repairIde')
    expect(onFolder).toContain('repairIde')
  })

  it('offers Find in Files and Replace in Files on files and folders', () => {
    const onFile = ids(buildTreeMenu(file('README.md'), context))
    const onFolder = ids(buildTreeMenu(folder('internal'), context))
    for (const id of ['findInFiles', 'replaceInFiles']) {
      expect(onFile).toContain(id)
      expect(onFolder).toContain(id)
    }
  })

  it('offers Open in Browser only for HTML files', () => {
    const html = ids(buildTreeMenu(file('index.html'), context))
    const go = ids(buildTreeMenu(file('main.go'), context))
    expect(html).toContain('openInBrowser')
    expect(go).not.toContain('openInBrowser')
  })

  it('offers Open with Live Preview only for HTML files', () => {
    expect(ids(buildTreeMenu(file('index.html'), context))).toContain('openWithLivePreview')
    expect(ids(buildTreeMenu(file('main.go'), context))).not.toContain('openWithLivePreview')
    expect(ids(buildTreeMenu(folder('internal'), context))).not.toContain('openWithLivePreview')
  })

  it('shows folder actions and hides file-only ones on a folder', () => {
    const menu = ids(buildTreeMenu(folder('internal'), context))
    expect(menu).toContain('findInFolder')
    expect(menu).not.toContain('open')
    expect(menu).not.toContain('localHistory')
    expect(menu).toContain('runCurrent')
    expect(menu).toContain('debugCurrent')
    expect(menu).toContain('refreshProject')
    expect(menu).toContain('markSources')
    expect(menu).toContain('markTests')
    expect(menu).toContain('markResources')
    expect(menu).toContain('markExcluded')
    expect(menu).toContain('unmarkDirectory')
    expect(menu).toContain('compareWith')
    expect(menu).toContain('gitPullQuick')
    expect(menu).toContain('gitResetHead')
    expect(menu).not.toContain('createGist')
  })

  it('offers quick pull at project root and reset only where changes exist', () => {
    const root = ids(buildTreeMenu(null, context))
    const cleanFile = ids(buildTreeMenu(file('README.md'), context))
    expect(root).toContain('gitPullQuick')
    expect(root).toContain('gitResetHead')
    expect(cleanFile).toContain('gitPullQuick')
    expect(cleanFile).not.toContain('gitResetHead')
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

describe('treeDropDestination', () => {
  it('moves files and packages into the selected folder', () => {
    expect(treeDropDestination('internal/api/server.go', 'cmd/server')).toBe('cmd/server/server.go')
    expect(treeDropDestination('internal/api', 'pkg')).toBe('pkg/api')
    expect(treeDropDestination('README.md', '')).toBeNull()
  })

  it('rejects self drops and descendants', () => {
    expect(treeDropDestination('internal/api', 'internal/api')).toBeNull()
    expect(treeDropDestination('internal/api', 'internal/api/testdata')).toBeNull()
  })

  it('sends a cross-package Go file drop to the semantic backend move', async () => {
    const loadDirectory = vi.fn().mockResolvedValue(undefined)
    const refreshProject = vi.fn().mockResolvedValue(undefined)
    useCodeStudioStore.setState({
      documents: [],
      directoryEntries: { session: { pricing: [] } },
      loadDirectory,
      refreshProject,
    })
    vi.mocked(moveGoIDEPath).mockResolvedValue(undefined)

    await expect(moveTreePath('session', 'money/money.go', 'pricing')).resolves.toBe(true)

    expect(moveGoIDEPath).toHaveBeenCalledWith('session', 'money/money.go', 'pricing/money.go')
    expect(refreshProject).toHaveBeenCalled()
  })
})

describe('Java entries in the New submenu', () => {
  const newItems = (hasJava: boolean) => (buildTreeMenu(null, { ...context, hasJava }).find((item) => item.id === 'new')?.submenu ?? []).map((item) => item.id)
  it('appear only for projects with a Java unit', () => {
    expect(newItems(true)).toEqual(expect.arrayContaining(['newJavaClass', 'newJavaPackage']))
    expect(newItems(false)).not.toContain('newJavaClass')
  })
})
