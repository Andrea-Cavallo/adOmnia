import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGoIDEFiles } from '@/lib/code-studio-api'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { runPathAction } from './codeStudioFileActions'

vi.mock('@/lib/code-studio-api', async (original) => ({
  ...await original<typeof import('@/lib/code-studio-api')>(),
  createGoIDEFiles: vi.fn().mockResolvedValue(undefined),
}))
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })

describe('Explorer quick file creation', () => {
  it.each([
    ['newMarkdownFile', 'notes', 'docs/notes.md', ''],
    ['newMarkdownFile', 'notes.md', 'docs/notes.md', ''],
    ['newTextFile', 'notes', 'docs/notes.txt', ''],
    ['newTextFile', 'nested/notes.txt', 'docs/nested/notes.txt', ''],
    ['newGoFile', 'handler', 'docs/handler.go', 'package docs\n'],
  ] as const)('creates %s in the selected folder', async (action, name, path, content) => {
    const store = useCodeStudioStore.getState()
    const load = vi.spyOn(store, 'loadDirectory').mockResolvedValue(undefined)
    const open = vi.spyOn(store, 'openDocument').mockResolvedValue(null)
    expect(await runPathAction('session', action, 'docs', name)).toBe(true)
    expect(createGoIDEFiles).toHaveBeenCalledWith('session', [{ relativePath: path, content }])
    expect(load).toHaveBeenCalledWith('docs')
    expect(open).toHaveBeenCalledWith(path)
  })

  it('keeps the dialog open when file creation fails', async () => {
    vi.mocked(createGoIDEFiles).mockRejectedValueOnce(new Error('File already exists'))
    expect(await runPathAction('session', 'newTextFile', '', 'notes')).toBe(false)
    expect(useCodeStudioStore.getState().error).toBe('File already exists')
  })
})

