import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ pick: vi.fn(), notify: vi.fn(), tokenize: vi.fn(), activeSessionId: 's1', document: { document: { readOnly: false, sessionId: 's1' } } }))
vi.mock('@/lib/monacoRef', () => ({ monaco: { editor: { EditorOption: { readOnly: 1 }, tokenize: mock.tokenize } } }))
vi.mock('@/lib/codeStudioFilePicker', () => ({ pickGoIDEFile: mock.pick }))
vi.mock('@/lib/fileUtils', () => ({ saveTextFile: vi.fn() }))
vi.mock('@/stores/codeStudioLsp', () => ({ useCodeStudioLspStore: { setState: mock.notify } }))
vi.mock('@/stores/codeStudio', () => ({ useCodeStudioStore: { setState: mock.notify, getState: () => ({ activeSessionId: mock.activeSessionId }) } }))
vi.mock('./codeStudioLanguageFeatures', () => ({ documentForModel: () => mock.document }))

import { insertLiveTemplate, isTemplateCodePosition, liveTemplateCatalog } from './codeStudioLiveTemplates'
import type { Monaco } from '@/lib/monacoRef'

function fixture() {
  let version = 1
  const model = {
    getVersionId: () => version, getLanguageId: () => 'python', isDisposed: () => false,
    getLineContent: () => '    print("$value")', getValueInRange: () => 'print("$value")\n    print("next")',
  }
  const selection = { isEmpty: () => false, startLineNumber: 1, startColumn: 5 }
  const trigger = vi.fn()
  const editor = { getModel: () => model, getSelection: () => selection, getOption: () => false, setSelection: vi.fn(), focus: vi.fn(), trigger, getContribution: () => ({ insert: trigger }) }
  return { model, editor, change: () => { version++ }, target: editor as unknown as Monaco.editor.ICodeEditor }
}

describe('editor template workflow', () => {
  beforeEach(() => { vi.clearAllMocks(); mock.activeSessionId = 's1'; vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { callback(); return 0 }) })
  afterEach(() => vi.unstubAllGlobals())

  it('inserts a language-specific surround snippet and preserves relative indentation', async () => {
    mock.pick.mockResolvedValue('python.if.surround')
    const { target, editor } = fixture()
    await insertLiveTemplate(target, true)
    expect(editor.trigger).toHaveBeenCalledWith('if ${1:condition}:\n\tprint("\\$value")\n\tprint("next")\n$0')
    expect(editor.setSelection).toHaveBeenCalled()
  })

  it('refuses edits after the document changes while choosing', async () => {
    const { target, editor, change } = fixture()
    mock.pick.mockImplementation(async () => { change(); return 'python.if.surround' })
    await insertLiveTemplate(target, true)
    expect(editor.trigger).not.toHaveBeenCalled()
    expect(mock.notify).toHaveBeenCalledWith({ message: expect.stringContaining('document changed') })
  })

  it('cancels without modifying the editor and requires a selection for surround', async () => {
    const { target, editor } = fixture()
    mock.pick.mockResolvedValue(null)
    await insertLiveTemplate(target, true)
    expect(editor.trigger).not.toHaveBeenCalled()
    editor.getSelection = () => ({ isEmpty: () => true, startLineNumber: 1, startColumn: 1 })
    await insertLiveTemplate(target, true)
    expect(mock.notify).toHaveBeenCalledWith({ message: expect.stringContaining('Select code') })
  })

  it('keeps template ids unique across all language contributions', () => {
    const catalog = liveTemplateCatalog()
    expect(new Set(catalog.map(template => template.id)).size).toBe(catalog.length)
    for (const language of ['go', 'java', 'python', 'rust', 'typescript', 'javascript']) {
      expect(catalog.some(template => template.languages.includes(language))).toBe(true)
    }
  })

  it('does not insert into a session that became inactive', async () => {
    const { target, editor } = fixture()
    mock.pick.mockImplementation(async () => { mock.activeSessionId = 's2'; return 'python.if.surround' })
    await insertLiveTemplate(target, true)
    expect(editor.trigger).not.toHaveBeenCalled()
  })

  it('suppresses code completion inside multiline comments and bounds tokenization work', () => {
    const model = { getOffsetAt: () => 25, getLineMaxColumn: () => 10, getLineContent: () => 'log', getValueInRange: () => '/*\nlog', getLanguageId: () => 'typescript' }
    mock.tokenize.mockReturnValue([[{ offset: 0, type: 'comment.ts' }], [{ offset: 0, type: 'comment.ts' }]])
    expect(isTemplateCodePosition(model as unknown as Monaco.editor.ITextModel, { lineNumber: 2, column: 4 } as Monaco.Position)).toBe(false)
    model.getOffsetAt = () => 200_000
    mock.tokenize.mockClear()
    expect(isTemplateCodePosition(model as unknown as Monaco.editor.ITextModel, { lineNumber: 2, column: 4 } as Monaco.Position)).toBe(false)
    expect(mock.tokenize).not.toHaveBeenCalled()
  })
})
