import { beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => ({
  get: vi.fn<(bucket: string, key: string) => Promise<string>>(),
  put: vi.fn<(bucket: string, key: string, value: string) => Promise<void>>(),
  loadWorkspace: vi.fn<(id: string) => Promise<string>>(),
  saveWorkspaces: vi.fn<(index: string, workspaces: string[]) => Promise<void>>(),
}))

vi.mock('@/wailsjs/go/main/App', () => ({
  StorageGet: storage.get,
  StoragePut: storage.put,
  LoadCollectionWorkspace: storage.loadWorkspace,
  SaveCollectionWorkspaces: storage.saveWorkspaces,
}))

vi.mock('@/lib/storeSave', () => ({
  debouncedSave: (_key: string, save: () => Promise<void>) => {
    void save()
  },
}))

import { DEFAULT_WORKSPACE_ID, parseCollectionsV3, useCollectionsStore } from '@/stores/collections'

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

describe('collections workspaces', () => {
  beforeEach(() => {
    storage.get.mockReset()
    storage.put.mockReset()
    storage.put.mockResolvedValue()
    storage.loadWorkspace.mockReset()
    storage.saveWorkspaces.mockReset()
    storage.saveWorkspaces.mockResolvedValue()
    useCollectionsStore.setState({
      collections: [],
      workspaces: [],
      activeWorkspaceId: DEFAULT_WORKSPACE_ID,
      loadedWorkspaceIds: [],
      shardsInitialized: false,
      loaded: false,
      loadError: false,
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
    storage.loadWorkspace.mockResolvedValue(workspaceB)
    await useCollectionsStore.getState().load('', indexV3, workspaceA)

    expect(await useCollectionsStore.getState().setActiveWorkspace('ws-b')).toBe(true)
    expect(useCollectionsStore.getState().collections[0].id).toBe('col-b')
    expect(storage.loadWorkspace).toHaveBeenCalledOnce()

    expect(await useCollectionsStore.getState().setActiveWorkspace('ws-a')).toBe(true)
    expect(await useCollectionsStore.getState().setActiveWorkspace('ws-b')).toBe(true)
    expect(storage.loadWorkspace).toHaveBeenCalledOnce()
  })

  it('does not delete the active workspace if its lazy successor cannot load', async () => {
    storage.loadWorkspace.mockRejectedValue(new Error('unavailable'))
    await useCollectionsStore.getState().load('', indexV3, workspaceA)

    expect(await useCollectionsStore.getState().deleteWorkspace('ws-a')).toBeNull()
    expect(useCollectionsStore.getState().workspaces.map((workspace) => workspace.id)).toEqual(['ws-a', 'ws-b'])
    expect(useCollectionsStore.getState().activeWorkspaceId).toBe('ws-a')
  })

  it('loads a lazy target before moving a collection across workspaces', async () => {
    storage.loadWorkspace.mockResolvedValue(workspaceB)
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
    storage.loadWorkspace.mockResolvedValue(workspaceB)
    await useCollectionsStore.getState().load('', indexV3, workspaceA)

    expect(await useCollectionsStore.getState().deleteWorkspace('ws-a')).toBe('ws-b')
    expect(useCollectionsStore.getState().activeWorkspaceId).toBe('ws-b')
    expect(useCollectionsStore.getState().collections[0].id).toBe('col-b')
    expect(useCollectionsStore.getState().workspaces.map((workspace) => workspace.id)).toEqual(['ws-b'])
  })

  it('rejects mismatched v3 active payloads', () => {
    expect(() => parseCollectionsV3(indexV3, workspaceB)).toThrow('active payload')
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
