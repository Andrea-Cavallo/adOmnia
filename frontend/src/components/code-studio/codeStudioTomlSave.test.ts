import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  document: { document: { id: 'd', sessionId: 's', relativePath: 'Cargo.toml', language: 'toml', name: 'Cargo.toml', readOnly: false }, dirty: true, buffer: 'text = """\nkeep spaces  \n"""\n' },
  formatOnSave: true, update: vi.fn(), message: vi.fn(), format: vi.fn(),
}))
vi.mock('@/lib/monacoRef', () => ({ monaco: {} }))
vi.mock('@/stores/codeStudio', () => ({ useCodeStudioStore: { getState: () => ({ documents: [fixture.document], updateDocument: fixture.update }) } }))
vi.mock('@/stores/codeStudioLsp', () => ({ useCodeStudioLspStore: { getState: () => ({ preferences: { formatOnSave: fixture.formatOnSave, trimTrailingWhitespace: true } }), setState: fixture.message } }))
vi.mock('./codeStudioEditorRegistry', () => ({ activeCodeStudioEditor: () => null }))
vi.mock('./codeStudioLanguageFeatures', () => ({ toMonacoEdits: vi.fn() }))
vi.mock('./codeStudioLspSync', () => ({ currentCodeStudioDocumentVersion: vi.fn(), flushCodeStudioDocument: vi.fn() }))
vi.mock('./codeStudioModelUri', () => ({ editorModelUri: () => 'file:///Cargo.toml', fileUri: (value: string) => value }))
vi.mock('./codeStudioEditorConfig', () => ({ editorConfigText: async () => '', parseEditorConfig: () => ({}), editorConfigFor: () => ({ trim_trailing_whitespace: true, indent_size: 4 }), applyWhitespaceRules: vi.fn(), forgetEditorConfig: vi.fn() }))
vi.mock('@/lib/code-studio/tomlFormatterClient', () => ({ formatTomlInWorker: fixture.format }))

import { runSaveActions } from './codeStudioSaveActions'

beforeEach(() => { vi.clearAllMocks(); fixture.formatOnSave = true; fixture.document.buffer = 'text = """\nkeep spaces  \n"""\n' })
describe('TOML save actions', () => {
  it('does not trim multiline string contents when formatting is disabled', async () => {
    fixture.formatOnSave = false
    await runSaveActions('d')
    expect(fixture.format).not.toHaveBeenCalled()
    expect(fixture.update).not.toHaveBeenCalled()
    expect(fixture.document.buffer).toContain('keep spaces  \n')
  })
  it('uses the configured indentation and preserves the original buffer on formatter failure', async () => {
    fixture.format.mockRejectedValueOnce(new Error('Invalid TOML'))
    await runSaveActions('d')
    expect(fixture.format).toHaveBeenCalledWith(fixture.document.buffer, expect.objectContaining({ tabSize: 4, insertSpaces: true }), undefined, 2500)
    expect(fixture.update).not.toHaveBeenCalled()
    expect(fixture.message).toHaveBeenCalledWith({ message: expect.stringContaining('Saving the unchanged TOML buffer') })
  })
  it('discards results calculated against an older buffer', async () => {
    fixture.format.mockImplementationOnce(async () => { fixture.document.buffer = 'new = "user edit"'; return 'old = "formatted"' })
    await runSaveActions('d')
    expect(fixture.update).not.toHaveBeenCalled()
  })
  it('updates only the requested document when formatting succeeds', async () => {
    fixture.format.mockResolvedValueOnce('text = "formatted"\n')
    await runSaveActions('d')
    expect(fixture.update).toHaveBeenCalledWith('d', 'text = "formatted"\n')
  })
})
