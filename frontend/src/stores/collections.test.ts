import { beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => ({
  get: vi.fn<(bucket: string, key: string) => Promise<string>>(),
  put: vi.fn<(bucket: string, key: string, value: string) => Promise<void>>(),
  loadWorkspace: vi.fn<(id: string) => Promise<string>>(),
  loadWorkspaceV2: vi.fn<(id: string) => Promise<unknown>>(),
  saveWorkspaces: vi.fn<(index: string, workspaces: string[]) => Promise<void>>(),
}))

vi.mock('@/wailsjs/go/main/App', () => ({
  StorageGet: storage.get,
  StoragePut: storage.put,
  LoadCollectionWorkspace: storage.loadWorkspace,
  LoadCollectionWorkspaceV2: storage.loadWorkspaceV2,
  SaveCollectionWorkspaces: storage.saveWorkspaces,
}))

vi.mock('@/lib/storeSave', () => ({
  debouncedSave: (_key: string, save: () => Promise<void>) => {
    void save()
  },
}))

import { DEFAULT_WORKSPACE_ID, QUICK_REQUESTS_COLLECTION_ID, parseCollectionsV3, useCollectionsStore } from '@/stores/collections'
import { blankRequest, type RequestItem } from '@/lib/types'

function makeRequest(name: string): RequestItem {
  return blankRequest('GET', name)
}

const indexV3 = JSON.stringify({
  version: 3,
  activeWorkspaceId: 'ws-a',
  workspaces: [
    { id: 'ws-a', name: 'A', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' },
    { id: 'ws-b', name: 'B', createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-02-02T00:00:00.000Z' },
  ],
})
const workspaceA = JSON.stringify({
  id: 'ws-a', name: 'A', collections: [{ id: 'col-a', name: 'A API', children: [] }],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
})
const workspaceB = JSON.stringify({
  id: 'ws-b', name: 'B', collections: [{ id: 'col-b', name: 'B API', children: [] }],
  createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-02-02T00:00:00.000Z',
})

// Structured workspace payload: the tree projection renders first, request
// contents stay JSON text until the renderer hydrates them.
const workspaceBContents = [{
  id: 'col-b', name: 'B API', children: [{
    id: 'req-b', name: 'Get B', type: 'request', method: 'GET', url: 'https://b.test',
    headers: [{ id: 'h1', key: 'X-Test', value: '1', enabled: true }],
    bodies: [{ id: 'body1', name: 'Body 1', type: 'raw', raw: '{"big":true}', lang: 'json', form: [] }],
  }],
}]
const workspaceBPayload = {
  workspace: {
    id: 'ws-b', name: 'B',
    createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-02-02T00:00:00.000Z',
    tree: [{ id: 'col-b', name: 'B API', children: [{ id: 'req-b', name: 'Get B', type: 'request', method: 'GET', url: 'https://b.test' }] }],
  },
  collectionsJson: JSON.stringify(workspaceBContents),
}
// Shards written before the tree split carry no projection: they hydrate in one
// step and receive the projection on their next save.
const workspaceBLegacyPayload = {
  workspace: { id: 'ws-b', name: 'B', createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-02-02T00:00:00.000Z' },
  collectionsJson: JSON.stringify(workspaceBContents),
}

describe('collections workspaces', () => {
  beforeEach(() => {
    storage.get.mockReset()
    storage.put.mockReset()
    storage.put.mockResolvedValue()
    storage.loadWorkspace.mockReset()
    storage.loadWorkspaceV2.mockReset()
    storage.saveWorkspaces.mockReset()
    storage.saveWorkspaces.mockResolvedValue()
    // Close any pending hydration left by the previous test before resetting.
    useCollectionsStore.getState().hydrateNow()
    useCollectionsStore.setState({
      collections: [],
      workspaces: [],
      activeWorkspaceId: DEFAULT_WORKSPACE_ID,
      loadedWorkspaceIds: [],
      shardsInitialized: false,
      loaded: false,
      loadError: false,
      treePreview: null,
    })
  })

  it('migrates legacy collections into the default workspace', async () => {
    storage.get.mockResolvedValue(JSON.stringify({
      version: 1,
      collections: [{ id: 'legacy-col', name: 'Legacy API', children: [] }],
    }))

    await useCollectionsStore.getState().load()

    const state = useCollectionsStore.getState()
    expect(state.activeWorkspaceId).toBe(DEFAULT_WORKSPACE_ID)
    expect(state.workspaces).toHaveLength(1)
    expect(state.workspaces[0].collections[0].name).toBe('Legacy API')
    expect(state.collections[0].id).toBe('legacy-col')

    const migrated = JSON.parse(storage.put.mock.calls[0][2])
    expect(migrated.version).toBe(2)
    expect(migrated.workspaces[0].collections[0].id).toBe('legacy-col')
  })

  it('moves collections between workspaces and restores the target collection list', async () => {
    useCollectionsStore.setState({
      collections: [],
      workspaces: [{
        id: DEFAULT_WORKSPACE_ID,
        name: 'Default Workspace',
        collections: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }],
      activeWorkspaceId: DEFAULT_WORKSPACE_ID,
      loadedWorkspaceIds: [DEFAULT_WORKSPACE_ID],
      shardsInitialized: true,
      loaded: true,
      loadError: false,
    })

    const collection = useCollectionsStore.getState().addCollection('Payments')
    const target = useCollectionsStore.getState().addWorkspace('Banking')
    await useCollectionsStore.getState().moveCollectionToWorkspace(collection.id, target.id)

    expect(useCollectionsStore.getState().collections).toHaveLength(0)
    expect(useCollectionsStore.getState().workspaces.find((workspace) => workspace.id === target.id)?.collections[0].name).toBe('Payments')

    await useCollectionsStore.getState().setActiveWorkspace(target.id)

    expect(useCollectionsStore.getState().collections[0].id).toBe(collection.id)
  })

  it('hydrates only the active workspace from a v3 bootstrap payload', async () => {
    await useCollectionsStore.getState().load('', indexV3, workspaceA)

    const state = useCollectionsStore.getState()
    expect(state.activeWorkspaceId).toBe('ws-a')
    expect(state.collections[0].id).toBe('col-a')
    expect(state.workspaces.find((workspace) => workspace.id === 'ws-b')?.collections).toEqual([])
    expect(state.loadedWorkspaceIds).toEqual(['ws-a'])
    expect(storage.get).not.toHaveBeenCalled()
  })

  it('loads a non-active workspace on first switch and reuses it afterwards', async () => {
    storage.loadWorkspaceV2.mockResolvedValue(workspaceBPayload)
    await useCollectionsStore.getState().load('', indexV3, workspaceA)

    expect(await useCollectionsStore.getState().setActiveWorkspace('ws-b')).toBe(true)
    // Tree metadata renders first; request contents hydrate right after.
    expect(useCollectionsStore.getState().treePreview?.[0]?.id).toBe('col-b')
    expect(useCollectionsStore.getState().collections).toEqual([])
    useCollectionsStore.getState().hydrateNow()
    expect(useCollectionsStore.getState().treePreview).toBeNull()
    expect(useCollectionsStore.getState().collections[0].id).toBe('col-b')
    expect(storage.loadWorkspaceV2).toHaveBeenCalledOnce()

    expect(await useCollectionsStore.getState().setActiveWorkspace('ws-a')).toBe(true)
    expect(await useCollectionsStore.getState().setActiveWorkspace('ws-b')).toBe(true)
    expect(storage.loadWorkspaceV2).toHaveBeenCalledOnce()
    expect(useCollectionsStore.getState().collections[0].id).toBe('col-b')
  })

  it('hydrates a shard without a tree projection in one step', async () => {
    storage.loadWorkspaceV2.mockResolvedValue(workspaceBLegacyPayload)
    await useCollectionsStore.getState().load('', indexV3, workspaceA)

    expect(await useCollectionsStore.getState().setActiveWorkspace('ws-b')).toBe(true)
    expect(useCollectionsStore.getState().treePreview).toBeNull()
    expect(useCollectionsStore.getState().collections[0].id).toBe('col-b')
  })

  it('hydrates request contents before mutating or saving', async () => {
    storage.loadWorkspaceV2.mockResolvedValue(workspaceBPayload)
    await useCollectionsStore.getState().load('', indexV3, workspaceA)
    await useCollectionsStore.getState().setActiveWorkspace('ws-b')

    // A mutation during the pending window hydrates first, so nothing is lost.
    useCollectionsStore.getState().addCollection('Payments')

    const state = useCollectionsStore.getState()
    expect(state.collections.map((collection) => collection.name)).toEqual(['B API', 'Payments'])
    expect(state.treePreview).toBeNull()
    await vi.waitFor(() => expect(storage.saveWorkspaces).toHaveBeenCalled())
    const saved = storage.saveWorkspaces.mock.calls[storage.saveWorkspaces.mock.calls.length - 1]?.[1] ?? []
    const payload = JSON.parse(saved[0] ?? '{}')
    expect(payload.tree.map((collection: { name: string }) => collection.name)).toEqual(['B API', 'Payments'])
    expect(payload.collections[0].children[0].bodies[0].raw).toBe('{"big":true}')
  })

  it('never serializes a workspace whose request contents are still pending', async () => {
    storage.loadWorkspaceV2.mockResolvedValue(workspaceBPayload)
    await useCollectionsStore.getState().load('', indexV3, workspaceA)
    await useCollectionsStore.getState().setActiveWorkspace('ws-b')

    // A rename touches only workspace metadata and saves the pending workspace.
    useCollectionsStore.getState().renameWorkspace('ws-b', 'Renamed B')
    // The stored contents are untouched until hydration completes.
    expect(useCollectionsStore.getState().collections).toEqual([])

    await vi.waitFor(() => expect(storage.saveWorkspaces).toHaveBeenCalled())
    const saved = storage.saveWorkspaces.mock.calls[storage.saveWorkspaces.mock.calls.length - 1]?.[1] ?? []
    expect(saved).toEqual([])
    useCollectionsStore.getState().hydrateNow()
    expect(useCollectionsStore.getState().collections[0].children).toHaveLength(1)
  })

  it('does not delete the active workspace if its lazy successor cannot load', async () => {
    storage.loadWorkspaceV2.mockRejectedValue(new Error('unavailable'))
    await useCollectionsStore.getState().load('', indexV3, workspaceA)

    expect(await useCollectionsStore.getState().deleteWorkspace('ws-a')).toBeNull()
    expect(useCollectionsStore.getState().workspaces.map((workspace) => workspace.id)).toEqual(['ws-a', 'ws-b'])
    expect(useCollectionsStore.getState().activeWorkspaceId).toBe('ws-a')
  })

  it('loads a lazy target before moving a collection across workspaces', async () => {
    storage.loadWorkspaceV2.mockResolvedValue(workspaceBPayload)
    await useCollectionsStore.getState().load('', indexV3, workspaceA)

    expect(await useCollectionsStore.getState().moveCollectionToWorkspace('col-a', 'ws-b')).toBe(true)

    const state = useCollectionsStore.getState()
    expect(state.collections).toEqual([])
    expect(state.workspaces.find((workspace) => workspace.id === 'ws-b')?.collections.map((item) => item.id))
      .toEqual(['col-b', 'col-a'])
    await vi.waitFor(() => expect(storage.saveWorkspaces).toHaveBeenCalled())
    expect(storage.saveWorkspaces.mock.calls[storage.saveWorkspaces.mock.calls.length - 1]?.[1]).toHaveLength(2)
  })

  it('loads the successor before deleting the active workspace', async () => {
    storage.loadWorkspaceV2.mockResolvedValue(workspaceBPayload)
    await useCollectionsStore.getState().load('', indexV3, workspaceA)

    expect(await useCollectionsStore.getState().deleteWorkspace('ws-a')).toBe('ws-b')
    expect(useCollectionsStore.getState().activeWorkspaceId).toBe('ws-b')
    expect(useCollectionsStore.getState().collections[0].id).toBe('col-b')
    expect(useCollectionsStore.getState().workspaces.map((workspace) => workspace.id)).toEqual(['ws-b'])
  })

  it('rejects mismatched v3 active payloads', () => {
    expect(() => parseCollectionsV3(indexV3, workspaceB)).toThrow('active payload')
  })

  it('reorders a request within the same folder', async () => {
    const a = { ...makeRequest('A') }
    const b = { ...makeRequest('B') }
    const c = { ...makeRequest('C') }
    const folder = { id: 'folder-1', name: 'Folder', type: 'folder' as const, children: [a, b, c] }
    useCollectionsStore.setState({
      collections: [{ id: 'col-a', name: 'A API', children: [folder] }],
      workspaces: [],
      activeWorkspaceId: DEFAULT_WORKSPACE_ID,
      loadedWorkspaceIds: [],
      shardsInitialized: false,
      loaded: true,
      loadError: false,
    })

    // Drag A after C (targetIndex = 3) inside the same folder.
    useCollectionsStore.getState().moveNode('col-a', a.id, 'col-a', 'folder-1', 3)

    const children = (useCollectionsStore.getState().collections[0].children[0] as { children: { id: string }[] }).children
    expect(children.map((n) => n.id)).toEqual([b.id, c.id, a.id])
  })

  it('keeps quick requests at workspace root without changing existing collections', () => {
    const existingCollection = { id: 'payments', name: 'Payments API', children: [] }
    useCollectionsStore.setState({
      collections: [existingCollection],
      workspaces: [{
        id: DEFAULT_WORKSPACE_ID,
        name: 'Default Workspace',
        collections: [existingCollection],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }],
      activeWorkspaceId: DEFAULT_WORKSPACE_ID,
      loadedWorkspaceIds: [DEFAULT_WORKSPACE_ID],
      shardsInitialized: true,
      loaded: true,
      loadError: false,
    })

    const first = makeRequest('Quick one')
    const second = makeRequest('Quick two')
    expect(useCollectionsStore.getState().addQuickRequest(first)).toBe(QUICK_REQUESTS_COLLECTION_ID)
    useCollectionsStore.getState().addQuickRequest(second)

    const collections = useCollectionsStore.getState().collections
    expect(collections.map((collection) => collection.id)).toEqual([QUICK_REQUESTS_COLLECTION_ID, 'payments'])
    expect(collections[0].children.map((request) => request.id)).toEqual([first.id, second.id])
    expect(collections[1]).toEqual(existingCollection)
  })

  it('reorders a request before a sibling within the same folder', async () => {
    const a = { ...makeRequest('A') }
    const b = { ...makeRequest('B') }
    const c = { ...makeRequest('C') }
    const folder = { id: 'folder-1', name: 'Folder', type: 'folder' as const, children: [a, b, c] }
    useCollectionsStore.setState({
      collections: [{ id: 'col-a', name: 'A API', children: [folder] }],
      workspaces: [],
      activeWorkspaceId: DEFAULT_WORKSPACE_ID,
      loadedWorkspaceIds: [],
      shardsInitialized: false,
      loaded: true,
      loadError: false,
    })

    // Drag C before A (targetIndex = 0) inside the same folder.
    useCollectionsStore.getState().moveNode('col-a', c.id, 'col-a', 'folder-1', 0)

    const children = (useCollectionsStore.getState().collections[0].children[0] as { children: { id: string }[] }).children
    expect(children.map((n) => n.id)).toEqual([c.id, a.id, b.id])
  })

  it('initializes every shard on the first save after a legacy fallback', async () => {
    storage.get.mockResolvedValue(JSON.stringify({
      version: 2,
      activeWorkspaceId: 'ws-a',
      workspaces: [JSON.parse(workspaceA), JSON.parse(workspaceB)],
    }))
    await useCollectionsStore.getState().load()

    useCollectionsStore.getState().renameCollection('col-a', 'Renamed API')

    await vi.waitFor(() => expect(storage.saveWorkspaces).toHaveBeenCalled())
    const lastCall = storage.saveWorkspaces.mock.calls[storage.saveWorkspaces.mock.calls.length - 1]
    expect(lastCall?.[1]).toHaveLength(2)
    expect(useCollectionsStore.getState().shardsInitialized).toBe(true)
  })
})
