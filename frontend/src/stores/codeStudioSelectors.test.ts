import { describe, expect, it } from 'vitest'
import {
  activeGoIDERelativePath,
  goIDEDirtyDocuments,
  goIDEDirtyKey,
  sessionGoIDEDocument,
  type GoIDEEditorDocument,
  type GoIDEState,
} from './codeStudio'

const doc = (id: string, sessionId: string, relativePath: string, patch: Partial<GoIDEEditorDocument> = {}): GoIDEEditorDocument => ({
  document: {
    id,
    sessionId,
    uri: `file:///project/${relativePath}`,
    path: `/project/${relativePath}`,
    relativePath,
    name: relativePath.split('/').pop() ?? relativePath,
    language: 'go',
    version: 1,
    dirty: false,
  },
  content: 'package main\n',
  buffer: 'package main\n',
  savedContent: 'package main\n',
  diskToken: 'token',
  modifiedAt: '2026-10-15T00:00:00Z',
  dirty: false,
  saving: false,
  saveError: null,
  externalState: null,
  ...patch,
})

const state = (
  documents: GoIDEEditorDocument[],
  activeDocumentBySession: Record<string, string | null> = {},
): GoIDEState => ({ documents, activeDocumentBySession, activeSessionId: 'session-one' }) as GoIDEState

describe('code studio document selectors', () => {
  it('returns the active document of a session only', () => {
    const first = doc('doc-1', 'session-one', 'main.go')
    const second = doc('doc-2', 'session-two', 'main.go')
    const current = state([first, second], { 'session-one': 'doc-1', 'session-two': 'doc-2' })

    expect(sessionGoIDEDocument(current, 'session-one')).toBe(first)
    expect(sessionGoIDEDocument(current, 'session-two')).toBe(second)
    expect(sessionGoIDEDocument(current, 'session-three')).toBeNull()
  })

  it('keeps the active relative path stable while buffers churn', () => {
    const base = state([doc('doc-1', 'session-one', 'main.go')], { 'session-one': 'doc-1' })
    const before = activeGoIDERelativePath(base, 'session-one')

    // Simula updateDocument: nuovo oggetto documento e nuovo array, stesso path.
    const churned = state(
      [{ ...doc('doc-1', 'session-one', 'main.go'), buffer: 'package main\n// typed\n', dirty: true }],
      { 'session-one': 'doc-1' },
    )

    expect(before).toBe('main.go')
    expect(activeGoIDERelativePath(churned, 'session-one')).toBe(before)
  })

  it('changes the dirty key only when the dirty set changes', () => {
    const clean = state([doc('doc-1', 'session-one', 'main.go'), doc('doc-2', 'session-one', 'util.go')])
    const key = goIDEDirtyKey(clean)
    expect(key).toBe('')

    const churned = state([
      { ...doc('doc-1', 'session-one', 'main.go'), buffer: 'typing…', dirty: true },
      doc('doc-2', 'session-one', 'util.go'),
    ])
    const dirtyKey = goIDEDirtyKey(churned)
    expect(dirtyKey).not.toBe(key)

    // Stesso insieme di dirty, buffer diverso: la chiave non cambia.
    const moreTyping = state([
      { ...doc('doc-1', 'session-one', 'main.go'), buffer: 'typing more…', dirty: true },
      { ...doc('doc-2', 'session-one', 'util.go'), buffer: 'x' },
    ])
    expect(goIDEDirtyKey(moreTyping)).toBe(dirtyKey)
  })

  it('lists every dirty document regardless of the session', () => {
    const current = state([
      { ...doc('doc-1', 'session-one', 'main.go'), dirty: true },
      doc('doc-2', 'session-two', 'util.go'),
      { ...doc('doc-3', 'session-two', 'api.go'), dirty: true },
    ])

    expect(goIDEDirtyDocuments(current).map((item) => item.document.id)).toEqual(['doc-1', 'doc-3'])
  })
})
