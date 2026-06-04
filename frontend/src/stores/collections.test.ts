import { beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => ({
  get: vi.fn<(bucket: string, key: string) => Promise<string>>(),
  put: vi.fn<(bucket: string, key: string, value: string) => Promise<void>>(),
}))

vi.mock('@/wailsjs/go/main/App', () => ({
  StorageGet: storage.get,
  StoragePut: storage.put,
}))

vi.mock('@/lib/storeSave', () => ({
  debouncedSave: (_key: string, save: () => Promise<void>) => {
    void save()
  },
}))

import { DEFAULT_WORKSPACE_ID, useCollectionsStore } from '@/stores/collections'

describe('collections workspaces', () => {
  beforeEach(() => {
    storage.get.mockReset()
    storage.put.mockReset()
    storage.put.mockResolvedValue()
    useCollectionsStore.setState({
      collections: [],
      workspaces: [],
      activeWorkspaceId: DEFAULT_WORKSPACE_ID,
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

  it('moves collections between workspaces and restores the target collection list', () => {
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
      loaded: true,
      loadError: false,
    })

    const collection = useCollectionsStore.getState().addCollection('Payments')
    const target = useCollectionsStore.getState().addWorkspace('Banking')
    useCollectionsStore.getState().moveCollectionToWorkspace(collection.id, target.id)

    expect(useCollectionsStore.getState().collections).toHaveLength(0)
    expect(useCollectionsStore.getState().workspaces.find((workspace) => workspace.id === target.id)?.collections[0].name).toBe('Payments')

    useCollectionsStore.getState().setActiveWorkspace(target.id)

    expect(useCollectionsStore.getState().collections[0].id).toBe(collection.id)
  })
})
