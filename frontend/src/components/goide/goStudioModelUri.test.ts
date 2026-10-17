import { afterEach, beforeEach, expect, it, vi } from 'vitest'
type ModelDocuments = Array<{ document: { uri: string; sessionId: string } }>
type ModelState = { documents: ModelDocuments }
const mock = vi.hoisted(() => ({
  documents: [] as ModelDocuments,
  listener: null as null | ((state: ModelState, previous: ModelState) => void),
  models: new Map<string, { dispose: () => void; isAttachedToEditor?: () => boolean; canUndo?: () => boolean; canRedo?: () => boolean; getValue?: () => string }>(),
  subscribe: vi.fn(),
}))
vi.mock('@/lib/monacoSetup', () => ({ monaco: {
  Uri: { parse: (uri: string) => ({
    toString: () => uri,
    with: ({ fragment }: { fragment: string }) => ({ toString: () => uri.split('#')[0] + (fragment ? '#' + fragment : '') }),
  }) },
  editor: { getModel: (uri: { toString(): string }) => mock.models.get(uri.toString()) },
} }))
vi.mock('@/stores/goide', () => ({ useGoIDEStore: {
  getState: () => ({ documents: mock.documents }),
  subscribe: (listener: typeof mock.listener) => { mock.subscribe(); mock.listener = listener },
} }))
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); vi.stubGlobal('window', { setTimeout })
  mock.documents = []; mock.models.clear(); mock.subscribe.mockClear(); mock.listener = null
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
const doc = { document: { uri: 'file:///project/file.go', sessionId: 'one' } }
function update(documents: typeof mock.documents) {
  const previous = { documents: mock.documents }
  mock.documents = documents
  mock.listener!({ documents }, previous)
}
it('keeps a model when its document reopens before deferred cleanup', async () => {
  const { editorModelUri, releaseModelsOfClosedDocuments } = await import('./goStudioModelUri')
  await releaseModelsOfClosedDocuments()
  const dispose = vi.fn()
  mock.models.set(editorModelUri(doc.document), { dispose })
  update([doc]); update([]); update([doc])
  vi.runAllTimers()
  expect(dispose).not.toHaveBeenCalled()
})
it('releases every closed model across 50 cycles with one subscription', async () => {
  const { editorModelUri, releaseModelsOfClosedDocuments } = await import('./goStudioModelUri')
  await releaseModelsOfClosedDocuments(); await releaseModelsOfClosedDocuments()
  for (let i = 0; i < 50; i++) {
    const uri = editorModelUri(doc.document)
    mock.models.set(uri, { dispose: () => { mock.models.delete(uri) } })
    update([doc]); update([]); vi.runAllTimers()
    expect(mock.models.size).toBe(0)
  }
  expect(mock.subscribe).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})
it('does not retain the closed session model when another session has the same file', async () => {
  const { editorModelUri, releaseModelsOfClosedDocuments } = await import('./goStudioModelUri')
  await releaseModelsOfClosedDocuments()
  const dispose = vi.fn()
  mock.models.set(editorModelUri(doc.document), { dispose })
  update([doc]); update([{ document: { ...doc.document, sessionId: 'two' } }]); vi.runAllTimers()
  expect(dispose).toHaveBeenCalledTimes(1)
})
it('reuses the models when switching tabs: reordering open documents disposes nothing', async () => {
  const { editorModelUri, releaseModelsOfClosedDocuments } = await import('./goStudioModelUri')
  await releaseModelsOfClosedDocuments()
  const other = { document: { uri: 'file:///project/other.go', sessionId: 'one' } }
  const disposeA = vi.fn(); const disposeB = vi.fn()
  mock.models.set(editorModelUri(doc.document), { dispose: disposeA })
  mock.models.set(editorModelUri(other.document), { dispose: disposeB })
  update([doc, other])
  for (let i = 0; i < 20; i++) update(i % 2 ? [doc, other] : [other, doc])
  vi.runAllTimers()
  expect(disposeA).not.toHaveBeenCalled()
  expect(disposeB).not.toHaveBeenCalled()
})

it('hibernates reconstructible models but protects dirty text, undo, redo and attached editors', async () => {
  const { editorModelUri, releaseDormantModels } = await import('./goStudioModelUri')
  for (const protection of ['none', 'dirty', 'attached', 'undo', 'redo', 'unsynced']) {
    const dispose = vi.fn()
    mock.models.set(editorModelUri(doc.document), {
      dispose, isAttachedToEditor: () => protection === 'attached',
      canUndo: () => protection === 'undo', canRedo: () => protection === 'redo',
      getValue: () => protection === 'unsynced' ? 'new edit' : 'saved',
    })
    releaseDormantModels([{ ...doc, dirty: protection === 'dirty', buffer: 'saved' }])
    expect(dispose).toHaveBeenCalledTimes(protection === 'none' ? 1 : 0)
  }
})
