import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ open: vi.fn(), close: vi.fn() }))

vi.mock('@/lib/goide-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/goide-api')>()),
  openGoIDEDocument: mocks.open,
  closeGoIDEDocument: mocks.close,
  forgetGoIDEBuffer: vi.fn(() => Promise.resolve()),
  rememberGoIDEBuffer: vi.fn(() => Promise.resolve()),
  checkGoIDEPathConflicts: vi.fn(() => Promise.resolve([])),
}))

import { useGoIDEStore } from './goide'

function opened(path: string) {
  return {
    document: { id: `doc:${path}`, sessionId: 's1', uri: `file:///p/${path}`, path: `/p/${path}`, relativePath: path, name: path, language: 'go', version: 1, dirty: false },
    content: 'x', diskToken: 't', modifiedAt: '2026-09-29T00:00:00Z',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.open.mockImplementation((_session: string, path: string) => Promise.resolve(opened(path)))
  mocks.close.mockResolvedValue(undefined)
  useGoIDEStore.setState({ activeSessionId: 's1', documents: [], activeDocumentBySession: {}, previewDocumentBySession: {}, pinnedDocuments: {}, closedDocuments: {}, splitBySession: {} })
  useGoIDEStore.setState({ persistSessionView: vi.fn(() => Promise.resolve()), checkPathConflicts: vi.fn(() => Promise.resolve()) } as never)
})

const paths = () => useGoIDEStore.getState().documents.map((item) => item.document.relativePath)
const preview = () => useGoIDEStore.getState().previewDocumentBySession.s1 ?? null

describe('preview tab', () => {
  it('replaces the previous preview instead of opening a new tab', async () => {
    const store = useGoIDEStore.getState()
    await store.openDocument('a.go', { preview: true })
    await store.openDocument('b.go', { preview: true })
    await vi.waitFor(() => expect(paths()).toEqual(['b.go']))
    expect(preview()).toBe('doc:b.go')
  })

  it('keeps a preview that was edited, pinned or opened permanently', async () => {
    const store = useGoIDEStore.getState()
    await store.openDocument('a.go', { preview: true })
    store.updateDocument('doc:a.go', 'changed')
    expect(preview()).toBeNull()
    await store.openDocument('b.go', { preview: true })
    await store.openDocument('b.go')
    expect(preview()).toBeNull()
    await store.openDocument('c.go', { preview: true })
    store.togglePinned('doc:c.go')
    await store.openDocument('d.go', { preview: true })
    await vi.waitFor(() => expect(paths()).toEqual(['a.go', 'b.go', 'c.go', 'd.go']))
  })

  it('opens normal tabs when preview is not requested', async () => {
    const store = useGoIDEStore.getState()
    await store.openDocument('a.go')
    await store.openDocument('b.go')
    expect(paths()).toEqual(['a.go', 'b.go'])
    expect(preview()).toBeNull()
  })
})
