import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ updateDocumentBuffer: vi.fn() }))

vi.mock('@/lib/code-studio-lsp-api', () => ({
  updateDocumentBuffer: mocks.updateDocumentBuffer,
  openExternalDocument: vi.fn(),
}))
vi.mock('@/lib/code-studio-api', () => ({ subscribeGoIDEEvents: vi.fn(() => () => undefined) }))

import { useCodeStudioStore, type GoIDEEditorDocument } from '@/stores/codeStudio'
import { currentCodeStudioDocumentVersion, flushCodeStudioDocument, startCodeStudioLspSync } from './codeStudioLspSync'

function editorDocument(id: string, name: string, content: string, readOnly = false): GoIDEEditorDocument {
  return {
    document: { id, sessionId: 'session-one', uri: `file:///p/${name}`, path: `/p/${name}`, relativePath: name, name, language: 'go', version: 1, dirty: false, readOnly },
    content, buffer: content, savedContent: content, diskToken: 't', modifiedAt: '2026-09-28T00:00:00Z',
    dirty: false, saving: false, saveError: null, externalState: null,
  }
}

function setBuffer(id: string, buffer: string): void {
  useCodeStudioStore.setState((state) => ({ documents: state.documents.map((item) => item.document.id === id ? { ...item, buffer, dirty: true } : item) }))
}

describe('Code Studio LSP buffer sync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.updateDocumentBuffer.mockReset().mockResolvedValue(undefined)
    useCodeStudioStore.setState({ documents: [editorDocument('main', 'main.go', 'package main\n'), editorDocument('sdk', 'fmt.go', 'package fmt\n', true), editorDocument('readme', 'README.md', '# x')] })
    startCodeStudioLspSync()
  })
  afterEach(() => {
    useCodeStudioStore.setState({ documents: [] })
    vi.useRealTimers()
  })

  it('debounces keystrokes into one monotonic full-text update', async () => {
    setBuffer('main', 'package main\n\nf')
    setBuffer('main', 'package main\n\nfu')
    setBuffer('main', 'package main\n\nfunc')
    expect(mocks.updateDocumentBuffer).not.toHaveBeenCalled()
    expect(currentCodeStudioDocumentVersion('main')).toBe(2)
    await vi.advanceTimersByTimeAsync(200)
    expect(mocks.updateDocumentBuffer).toHaveBeenCalledTimes(1)
    expect(mocks.updateDocumentBuffer).toHaveBeenLastCalledWith('session-one', 'main', 2, 'package main\n\nfunc')
  })

  it('flushes pending text before semantic requests and keeps versions increasing', async () => {
    setBuffer('main', 'package main\n// a')
    expect(await flushCodeStudioDocument('main')).toBe(2)
    setBuffer('main', 'package main\n// ab')
    expect(await flushCodeStudioDocument('main')).toBe(3)
    expect(mocks.updateDocumentBuffer.mock.calls.map((call) => call[2])).toEqual([2, 3])
    expect(currentCodeStudioDocumentVersion('main')).toBe(3)
  })

  it('never syncs read-only SDK sources or non-Go files', async () => {
    setBuffer('readme', '# changed')
    await vi.advanceTimersByTimeAsync(200)
    expect(mocks.updateDocumentBuffer).not.toHaveBeenCalled()
    expect(currentCodeStudioDocumentVersion('sdk')).toBeNull()
    expect(currentCodeStudioDocumentVersion('readme')).toBeNull()
  })

  it('restarts versions from 1 when a closed document is reopened', async () => {
    setBuffer('main', 'package main\n// x')
    await flushCodeStudioDocument('main')
    useCodeStudioStore.setState({ documents: [] })
    useCodeStudioStore.setState({ documents: [editorDocument('main', 'main.go', 'package main\n')] })
    expect(currentCodeStudioDocumentVersion('main')).toBe(1)
  })
})
