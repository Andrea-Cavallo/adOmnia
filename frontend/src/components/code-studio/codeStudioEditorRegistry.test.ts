import { describe, expect, it, vi } from 'vitest'
import type { monaco } from '@/lib/monacoSetup'
import { registerCodeStudioEditor, runCodeStudioEditorCommand } from './codeStudioEditorRegistry'

function fakeEditor(uri: string) {
  return { getModel: () => ({ uri: { toString: () => uri } }), focus: vi.fn(), trigger: vi.fn() }
}

describe('commands for a document in split editors', () => {
  it('targets the requested document even when another editor has focus', () => {
    const main = fakeEditor('file:///main#session=a')
    const split = fakeEditor('file:///split#session=a')
    const closeMain = registerCodeStudioEditor(main as unknown as monaco.editor.IStandaloneCodeEditor)
    const closeSplit = registerCodeStudioEditor(split as unknown as monaco.editor.IStandaloneCodeEditor)
    try {
      expect(runCodeStudioEditorCommand('edit.gotoLine', 'file:///main#session=a')).toBe(true)
      expect(main.trigger).toHaveBeenCalledWith('code-studio-menu', 'editor.action.gotoLine', null)
      expect(split.trigger).not.toHaveBeenCalled()
      expect(runCodeStudioEditorCommand('edit.gotoLine', 'file:///main#session=b')).toBe(false)
      closeMain()
      expect(runCodeStudioEditorCommand('edit.gotoLine', 'file:///main#session=a')).toBe(false)
    } finally { closeMain(); closeSplit() }
  })
})
