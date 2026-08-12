import { create } from 'zustand'
import type { Collection, CollectionWorkspace, TreeNode, RequestItem, FolderItem, RequestBody } from '@/lib/types'
import { uid, blankBody, blankKVRow, blankAuth } from '@/lib/types'
import {
  LoadCollectionWorkspace,
  SaveCollectionWorkspaces,
  StorageGet,
  StoragePut,
} from '@/wailsjs/go/main/App'
import { debouncedSave } from '@/lib/storeSave'
import { storageSchema } from '@/lib/storageSchemas'
import { decodePersistedJSON } from '@/lib/persistedJson'

const COLLECTIONS_SCHEMA = storageSchema('collections')
const BUCKET = COLLECTIONS_SCHEMA.bucket
const KEY = COLLECTIONS_SCHEMA.item

interface PersistedCollections {
  version: number
  activeWorkspaceId: string
  workspaces: CollectionWorkspace[]
}

interface PersistedWorkspaceMeta {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

interface PersistedCollectionsIndex {
  version: 3
  activeWorkspaceId: string
  workspaces: PersistedWorkspaceMeta[]
}

interface CollectionsState {
  collections: Collection[]
  workspaces: CollectionWorkspace[]
  activeWorkspaceId: string
  loadedWorkspaceIds: string[]
  shardsInitialized: boolean
  loaded: boolean
  loadError: boolean
  load: (rawOverride?: unknown, indexOverride?: unknown, activeWorkspaceOverride?: unknown) => Promise<void>
  save: (workspaceIds?: string[]) => void
  ensureWorkspaceLoaded: (id: string) => Promise<CollectionWorkspace | null>
  replaceCollections: (collections: Collection[]) => void
  addWorkspace: (name: string) => CollectionWorkspace
  renameWorkspace: (id: string, name: string) => void
  deleteWorkspace: (id: string) => Promise<string | null>
  setActiveWorkspace: (id: string) => Promise<boolean>
  moveCollectionToWorkspace: (collectionId: string, targetWorkspaceId: string) => Promise<boolean>
  addCollection: (name: string) => Collection
  deleteCollection: (id: string) => void
  renameCollection: (id: string, name: string) => void
  updateCollection: (id: string, patch: Partial<Collection>) => void
  addFolder: (collectionId: string, parentId: string | null, name: string) => void
  addRequest: (collectionId: string, parentId: string | null, request: RequestItem) => void
  deleteNode: (collectionId: string, nodeId: string) => void
  renameNode: (collectionId: string, nodeId: string, name: string) => void
  updateRequest: (collectionId: string, request: RequestItem) => void
  importCollection: (collection: Collection) => void
  moveNode: (collectionId: string, nodeId: string, targetCollectionId: string, targetParentId: string | null, targetIndex: number) => void
  deleteNodes: (collectionId: string, nodeIds: string[]) => void
  duplicateNode: (collectionId: string, nodeId: string) => TreeNode | null
  reorderCollections: (fromId: string, toId: string) => void
}

export const DEFAULT_WORKSPACE_ID = 'workspace-default'
const DEFAULT_WORKSPACE_NAME = 'Default Workspace'
const COLLECTIONS_INDEX_VERSION = 3
const pendingWorkspaceSaves = new Set<string>()

function makeWorkspace(name: string, collections: Collection[] = [], id = uid()): CollectionWorkspace {
  const now = new Date().toISOString()
  return { id, name, collections, createdAt: now, updatedAt: now }
}

function migrateWorkspaces(workspaces: CollectionWorkspace[]): CollectionWorkspace[] {
  return workspaces.map((workspace) => ({
    ...workspace,
    name: workspace.name || 'Untitled Workspace',
    collections: migrateCollections(Array.isArray(workspace.collections) ? workspace.collections : []),
    createdAt: workspace.createdAt || new Date().toISOString(),
    updatedAt: workspace.updatedAt || workspace.createdAt || new Date().toISOString(),
  }))
}

function syncActiveWorkspace(
  workspaces: CollectionWorkspace[],
  activeWorkspaceId: string,
  collections: Collection[],
): CollectionWorkspace[] {
  const now = new Date().toISOString()
  return workspaces.map((workspace) => (
    workspace.id === activeWorkspaceId
      ? { ...workspace, collections, updatedAt: now }
      : workspace
  ))
}

function collectionsIndex(
  workspaces: CollectionWorkspace[],
  activeWorkspaceId: string,
): PersistedCollectionsIndex {
  return {
    version: COLLECTIONS_INDEX_VERSION,
    activeWorkspaceId,
    workspaces: workspaces.map(({ id, name, createdAt, updatedAt }) => ({
      id,
      name,
      createdAt,
      updatedAt,
    })),
  }
}

export function parseCollectionsV3(
  indexRaw: unknown,
  activeWorkspaceRaw: unknown,
): { workspaces: CollectionWorkspace[]; activeWorkspaceId: string; collections: Collection[] } {
  const index = decodePersistedJSON<Partial<PersistedCollectionsIndex>>(indexRaw)
  if (index.version !== COLLECTIONS_INDEX_VERSION || !Array.isArray(index.workspaces) || index.workspaces.length === 0) {
    throw new Error('Invalid collections v3 index')
  }
  const ids = new Set<string>()
  for (const meta of index.workspaces) {
    if (!meta || typeof meta.id !== 'string' || !meta.id || ids.has(meta.id)) {
      throw new Error('Invalid collections v3 workspace metadata')
    }
    ids.add(meta.id)
  }
  if (typeof index.activeWorkspaceId !== 'string' || !ids.has(index.activeWorkspaceId)) {
    throw new Error('Invalid collections v3 active workspace')
  }

  const active = decodePersistedJSON<Partial<CollectionWorkspace>>(activeWorkspaceRaw)
  if (active.id !== index.activeWorkspaceId || !Array.isArray(active.collections)) {
    throw new Error('Invalid collections v3 active payload')
  }
  const activeCollections = migrateCollections(active.collections)
  const workspaces = index.workspaces.map((meta) => ({
    id: meta.id,
    name: typeof meta.name === 'string' && meta.name ? meta.name : 'Untitled Workspace',
    collections: meta.id === index.activeWorkspaceId ? activeCollections : [],
    createdAt: typeof meta.createdAt === 'string' && meta.createdAt ? meta.createdAt : new Date().toISOString(),
    updatedAt: typeof meta.updatedAt === 'string' && meta.updatedAt
      ? meta.updatedAt
      : (typeof meta.createdAt === 'string' ? meta.createdAt : new Date().toISOString()),
  }))
  return { workspaces, activeWorkspaceId: index.activeWorkspaceId, collections: activeCollections }
}

function migrateBody(b: RequestBody): RequestBody {
  return {
    id: b.id ?? uid(),
    name: b.name ?? 'Body 1',
    type: b.type ?? 'none',
    raw: b.raw ?? '',
    lang: b.lang ?? 'json',
    form: b.form ?? [],
    graphqlVariables: b.graphqlVariables,
  }
}

function migrateRequest(r: RequestItem): RequestItem {
  return {
    ...r,
    description: r.description ?? '',
    params: r.params ?? [blankKVRow()],
    headers: r.headers ?? [blankKVRow()],
    bodies: r.bodies?.length ? r.bodies.map(migrateBody) : [blankBody()],
    activeBodyIdx: r.activeBodyIdx ?? 0,
    auth: r.auth ?? blankAuth(),
    timeout: r.timeout ?? 0,
    followRedirects: r.followRedirects ?? true,
  }
}

function migrateNodes(nodes: TreeNode[]): TreeNode[] {
  return nodes.map((n) => {
    if (n.type === 'folder') return { ...n, children: migrateNodes(n.children) }
    return migrateRequest(n as RequestItem)
  })
}

export function migrateCollections(cols: Collection[]): Collection[] {
  return cols.map((c) => ({ ...c, children: migrateNodes(c.children) }))
}

function removeFromTree(nodes: TreeNode[], id: string): TreeNode[] {
  return nodes
    .filter((n) => n.id !== id)
    .map((n) => {
      if (n.type === 'folder') {
        return { ...n, children: removeFromTree(n.children, id) }
      }
      return n
    })
}

function updateInTree(nodes: TreeNode[], id: string, updater: (n: TreeNode) => TreeNode): TreeNode[] {
  return nodes.map((n) => {
    if (n.id === id) return updater(n)
    if (n.type === 'folder') {
      return { ...n, children: updateInTree(n.children, id, updater) }
    }
    return n
  })
}

function findInTree(nodes: TreeNode[], id: string): TreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n
    if (n.type === 'folder') {
      const found = findInTree(n.children, id)
      if (found) return found
    }
  }
  return null
}

function containsNode(nodes: TreeNode[], id: string): boolean {
  return Boolean(findInTree(nodes, id))
}

export function findParentInfo(nodes: TreeNode[], id: string, parentId: string | null = null): { parentId: string | null; index: number } | null {
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]
    if (node.id === id) return { parentId, index }
    if (node.type === 'folder') {
      const found = findParentInfo(node.children, id, node.id)
      if (found) return found
    }
  }
  return null
}

function insertAtIndexInTree(nodes: TreeNode[], parentId: string | null, item: TreeNode, index: number): TreeNode[] {
  if (!parentId) {
    const arr = [...nodes]
    arr.splice(index, 0, item)
    return arr
  }
  return nodes.map((n) => {
    if (n.id === parentId && n.type === 'folder') {
      const arr = [...n.children]
      arr.splice(index, 0, item)
      return { ...n, children: arr }
    }
    if (n.type === 'folder') {
      return { ...n, children: insertAtIndexInTree(n.children, parentId, item, index) }
    }
    return n
  })
}

function deepCloneWithNewIds(node: TreeNode): TreeNode {
  const newId = uid()
  if (node.type === 'folder') {
    return { ...node, id: newId, children: node.children.map(deepCloneWithNewIds) }
  }
  return { ...node, id: newId }
}

function insertIntoTree(nodes: TreeNode[], parentId: string | null, item: TreeNode): TreeNode[] {
  if (!parentId) return [...nodes, item]
  return nodes.map((n) => {
    if (n.id === parentId && n.type === 'folder') {
      return { ...n, children: [...n.children, item] }
    }
    if (n.type === 'folder') {
      return { ...n, children: insertIntoTree(n.children, parentId, item) }
    }
    return n
  })
}

export const useCollectionsStore = create<CollectionsState>((set, get) => ({
  collections: [],
  workspaces: [],
  activeWorkspaceId: DEFAULT_WORKSPACE_ID,
  loadedWorkspaceIds: [],
  shardsInitialized: false,
  loaded: false,
  loadError: false,

  load: async (rawOverride, indexOverride, activeWorkspaceOverride) => {
    try {
      if (indexOverride && activeWorkspaceOverride) {
        try {
          const v3 = parseCollectionsV3(indexOverride, activeWorkspaceOverride)
          set({
            ...v3,
            loadedWorkspaceIds: [v3.activeWorkspaceId],
            shardsInitialized: true,
            loaded: true,
            loadError: false,
          })
          return
        } catch {
          // A corrupt/incomplete v3 payload falls back to the complete v2
          // snapshot rather than presenting an empty workspace.
        }
      }
      const raw = rawOverride || await StorageGet(BUCKET, KEY)
      if (raw) {
        const parsed = decodePersistedJSON<any>(raw)
        let collections: Collection[]
        let workspaces: CollectionWorkspace[]
        let activeWorkspaceId: string
        let needsVersionUpgrade = false
        if (Array.isArray(parsed)) {
          // Legacy format: bare array, no version envelope; migrate and upgrade.
          collections = migrateCollections(parsed)
          workspaces = [makeWorkspace(DEFAULT_WORKSPACE_NAME, collections, DEFAULT_WORKSPACE_ID)]
          activeWorkspaceId = DEFAULT_WORKSPACE_ID
          needsVersionUpgrade = true
        } else if (parsed && typeof parsed === 'object' && parsed.version !== undefined) {
          const version = Number(parsed.version)
          if (version < 2 || !Array.isArray(parsed.workspaces)) {
            collections = migrateCollections(Array.isArray(parsed.collections) ? parsed.collections : [])
            workspaces = [makeWorkspace(DEFAULT_WORKSPACE_NAME, collections, DEFAULT_WORKSPACE_ID)]
            activeWorkspaceId = DEFAULT_WORKSPACE_ID
            needsVersionUpgrade = true
          } else {
            workspaces = migrateWorkspaces(parsed.workspaces as CollectionWorkspace[])
            if (workspaces.length === 0) {
              workspaces = [makeWorkspace(DEFAULT_WORKSPACE_NAME, [], DEFAULT_WORKSPACE_ID)]
              needsVersionUpgrade = true
            }
            activeWorkspaceId = typeof parsed.activeWorkspaceId === 'string' && workspaces.some((workspace) => workspace.id === parsed.activeWorkspaceId)
              ? parsed.activeWorkspaceId
              : workspaces[0].id
            if (activeWorkspaceId !== parsed.activeWorkspaceId) needsVersionUpgrade = true
            collections = workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.collections ?? []
          }
        } else {
          collections = []
          workspaces = [makeWorkspace(DEFAULT_WORKSPACE_NAME, [], DEFAULT_WORKSPACE_ID)]
          activeWorkspaceId = DEFAULT_WORKSPACE_ID
          needsVersionUpgrade = true
        }
        // Persist the migrated data immediately so the next load sees the current
        // schema version and does NOT re-run migrations (acceptance: idempotent load).
        if (needsVersionUpgrade) {
          const upgraded: PersistedCollections = {
            version: COLLECTIONS_SCHEMA.currentVersion,
            activeWorkspaceId,
            workspaces,
          }
          try {
            await StoragePut(BUCKET, KEY, JSON.stringify(upgraded))
          } catch {
            // Non-fatal: data is in memory; will be persisted on the next mutation.
          }
        }
        set({
          collections,
          workspaces,
          activeWorkspaceId,
          loadedWorkspaceIds: workspaces.map((workspace) => workspace.id),
          shardsInitialized: false,
          loaded: true,
          loadError: false,
        })
      } else {
        const workspace = makeWorkspace(DEFAULT_WORKSPACE_NAME, [], DEFAULT_WORKSPACE_ID)
        set({
          collections: [],
          workspaces: [workspace],
          activeWorkspaceId: workspace.id,
          loadedWorkspaceIds: [workspace.id],
          shardsInitialized: false,
          loaded: true,
          loadError: false,
        })
      }
    } catch {
      const workspace = makeWorkspace(DEFAULT_WORKSPACE_NAME, [], DEFAULT_WORKSPACE_ID)
      set({
        collections: [],
        workspaces: [workspace],
        activeWorkspaceId: workspace.id,
        loadedWorkspaceIds: [workspace.id],
        shardsInitialized: false,
        loaded: true,
        loadError: true,
      })
    }
  },

  save: (workspaceIds) => {
    const s = get()
    if (!s.loaded || s.loadError) return
    const workspaces = syncActiveWorkspace(s.workspaces, s.activeWorkspaceId, s.collections)
    set({ workspaces })
    const idsToQueue = s.shardsInitialized ? (workspaceIds ?? [s.activeWorkspaceId]) : s.loadedWorkspaceIds
    for (const id of idsToQueue) {
      if (s.loadedWorkspaceIds.includes(id) && workspaces.some((workspace) => workspace.id === id)) {
        pendingWorkspaceSaves.add(id)
      }
    }
    debouncedSave('collections', async () => {
      const latest = get()
      if (!latest.loaded || latest.loadError) return
      const latestWorkspaces = syncActiveWorkspace(
        latest.workspaces,
        latest.activeWorkspaceId,
        latest.collections,
      )
      set({ workspaces: latestWorkspaces })
      const savingIds = [...pendingWorkspaceSaves]
      savingIds.forEach((id) => pendingWorkspaceSaves.delete(id))
      const payloads = savingIds.flatMap((id) => {
        const workspace = latestWorkspaces.find((item) => item.id === id)
        return workspace ? [JSON.stringify(workspace)] : []
      })
      try {
        await SaveCollectionWorkspaces(
          JSON.stringify(collectionsIndex(latestWorkspaces, latest.activeWorkspaceId)),
          payloads,
        )
        set({ shardsInitialized: true })
      } catch (error) {
        savingIds.forEach((id) => pendingWorkspaceSaves.add(id))
        throw error
      }
    })
  },

  ensureWorkspaceLoaded: async (id) => {
    const current = get()
    const existing = current.workspaces.find((workspace) => workspace.id === id)
    if (!existing) return null
    if (current.loadedWorkspaceIds.includes(id)) return existing
    try {
      const raw = await LoadCollectionWorkspace(id)
      const loaded = migrateWorkspaces([JSON.parse(raw) as CollectionWorkspace])[0]
      if (!loaded || loaded.id !== id) return null
      const latest = get()
      const meta = latest.workspaces.find((workspace) => workspace.id === id)
      if (!meta) return null
      const workspace = {
        ...loaded,
        name: meta.name,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
      }
      set({
        workspaces: latest.workspaces.map((item) => item.id === id ? workspace : item),
        loadedWorkspaceIds: [...new Set([...latest.loadedWorkspaceIds, id])],
      })
      return workspace
    } catch {
      return null
    }
  },

  replaceCollections: (collections) => {
    const migrated = migrateCollections(collections)
    set((s) => ({
      collections: migrated,
      workspaces: syncActiveWorkspace(s.workspaces, s.activeWorkspaceId, migrated),
    }))
    get().save()
  },

  addWorkspace: (name) => {
    const workspace = makeWorkspace(name.trim() || 'Untitled Workspace')
    set((s) => ({
      workspaces: [...s.workspaces, workspace],
      loadedWorkspaceIds: [...s.loadedWorkspaceIds, workspace.id],
    }))
    get().save([workspace.id])
    return workspace
  },

  renameWorkspace: (id, name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    set((s) => ({
      workspaces: s.workspaces.map((workspace) => (
        workspace.id === id ? { ...workspace, name: trimmed, updatedAt: new Date().toISOString() } : workspace
      )),
    }))
    get().save(get().loadedWorkspaceIds.includes(id) ? [id] : [])
  },

  deleteWorkspace: async (id) => {
    const initial = get()
    if (initial.workspaces.length <= 1 || !initial.workspaces.some((workspace) => workspace.id === id)) return null
    const candidate = initial.workspaces.find((workspace) => workspace.id !== id)
    if (initial.activeWorkspaceId === id && candidate && !initial.loadedWorkspaceIds.includes(candidate.id)) {
      if (!await get().ensureWorkspaceLoaded(candidate.id)) return null
    }
    const state = get()
    const remaining = state.workspaces.filter((workspace) => workspace.id !== id)
    const nextActiveId = state.activeWorkspaceId === id ? remaining[0].id : state.activeWorkspaceId
    const nextCollections = remaining.find((workspace) => workspace.id === nextActiveId)?.collections ?? []
    set({
      workspaces: remaining,
      activeWorkspaceId: nextActiveId,
      collections: nextCollections,
      loadedWorkspaceIds: state.loadedWorkspaceIds.filter((workspaceId) => workspaceId !== id),
    })
    get().save([])
    return nextActiveId
  },

  setActiveWorkspace: async (id) => {
    const initial = get()
    if (id === initial.activeWorkspaceId) return true
    if (!initial.workspaces.some((workspace) => workspace.id === id)) return false
    if (!initial.loadedWorkspaceIds.includes(id) && !await get().ensureWorkspaceLoaded(id)) return false
    const state = get()
    const target = state.workspaces.find((workspace) => workspace.id === id)
    if (!target) return false
    const previousID = state.activeWorkspaceId
    const synced = syncActiveWorkspace(state.workspaces, previousID, state.collections)
    set({ workspaces: synced, activeWorkspaceId: id, collections: target.collections })
    get().save([previousID])
    return true
  },

  moveCollectionToWorkspace: async (collectionId, targetWorkspaceId) => {
    const initial = get()
    if (targetWorkspaceId === initial.activeWorkspaceId) return false
    if (!initial.workspaces.some((workspace) => workspace.id === targetWorkspaceId)) return false
    if (!initial.loadedWorkspaceIds.includes(targetWorkspaceId) && !await get().ensureWorkspaceLoaded(targetWorkspaceId)) {
      return false
    }
    const state = get()
    const collection = state.collections.find((item) => item.id === collectionId)
    if (!collection) return false
    const sourceWorkspaceId = state.activeWorkspaceId
    const remaining = state.collections.filter((item) => item.id !== collectionId)
    set((s) => ({
      collections: remaining,
      workspaces: s.workspaces.map((workspace) => {
        if (workspace.id === s.activeWorkspaceId) {
          return { ...workspace, collections: remaining, updatedAt: new Date().toISOString() }
        }
        if (workspace.id === targetWorkspaceId) {
          return { ...workspace, collections: [...workspace.collections, collection], updatedAt: new Date().toISOString() }
        }
        return workspace
      }),
    }))
    get().save([sourceWorkspaceId, targetWorkspaceId])
    return true
  },

  addCollection: (name) => {
    const col: Collection = { id: uid(), name, children: [] }
    set((s) => ({ collections: [...s.collections, col] }))
    get().save()
    return col
  },

  deleteCollection: (id) => {
    set((s) => ({ collections: s.collections.filter((c) => c.id !== id) }))
    get().save()
  },

  renameCollection: (id, name) => {
    set((s) => ({
      collections: s.collections.map((c) => (c.id === id ? { ...c, name } : c)),
    }))
    get().save()
  },

  updateCollection: (id, patch) => {
    set((s) => ({
      collections: s.collections.map((c) => (c.id === id ? { ...c, ...patch, id: c.id } : c)),
    }))
    get().save()
  },

  addFolder: (collectionId, parentId, name) => {
    const folder: FolderItem = { id: uid(), name, type: 'folder', children: [] }
    set((s) => ({
      collections: s.collections.map((c) =>
        c.id === collectionId ? { ...c, children: insertIntoTree(c.children, parentId, folder) } : c
      ),
    }))
    get().save()
  },

  addRequest: (collectionId, parentId, request) => {
    set((s) => ({
      collections: s.collections.map((c) =>
        c.id === collectionId ? { ...c, children: insertIntoTree(c.children, parentId, request) } : c
      ),
    }))
    get().save()
  },

  deleteNode: (collectionId, nodeId) => {
    set((s) => ({
      collections: s.collections.map((c) =>
        c.id === collectionId ? { ...c, children: removeFromTree(c.children, nodeId) } : c
      ),
    }))
    get().save()
  },

  renameNode: (collectionId, nodeId, name) => {
    set((s) => ({
      collections: s.collections.map((c) =>
        c.id === collectionId ? { ...c, children: updateInTree(c.children, nodeId, (n) => ({ ...n, name })) } : c
      ),
    }))
    get().save()
  },

  updateRequest: (collectionId, request) => {
    set((s) => ({
      collections: s.collections.map((c) =>
        c.id === collectionId ? { ...c, children: updateInTree(c.children, request.id, () => request) } : c
      ),
    }))
    get().save()
  },

  importCollection: (collection) => {
    const migrated = migrateCollections([collection])[0]
    set((s) => ({ collections: [...s.collections, migrated] }))
    get().save()
  },

  moveNode: (collectionId, nodeId, targetCollectionId, targetParentId, targetIndex) => {
    const state = get()
    let node: TreeNode | null = null
    let sourceParentInfo: { parentId: string | null; index: number } | null = null
    for (const c of state.collections) {
      const found = findInTree(c.children, nodeId)
      if (found) {
        node = found
        sourceParentInfo = findParentInfo(c.children, nodeId)
        break
      }
    }
    if (!node) return
    if (targetParentId === nodeId) return
    if (node.type === 'folder' && targetParentId && containsNode(node.children, targetParentId)) return
    const normalizedIndex =
      collectionId === targetCollectionId &&
      sourceParentInfo?.parentId === targetParentId &&
      sourceParentInfo.index < targetIndex
        ? Math.max(0, targetIndex - 1)
        : targetIndex
    set((s) => ({
      collections: s.collections.map((c) => {
        let col = c
        if (c.id === collectionId || c.id === targetCollectionId) {
          if (c.id === collectionId) col = { ...col, children: removeFromTree(col.children, nodeId) }
          if (c.id === targetCollectionId) col = { ...col, children: insertAtIndexInTree(col.children, targetParentId, node!, normalizedIndex) }
        }
        return col
      }),
    }))
    get().save()
  },

  deleteNodes: (collectionId, nodeIds) => {
    set((s) => ({
      collections: s.collections.map((c) =>
        c.id === collectionId
          ? { ...c, children: nodeIds.reduce((acc, id) => removeFromTree(acc, id), c.children) }
          : c
      ),
    }))
    get().save()
  },

  reorderCollections: (fromId, toId) => {
    set((s) => {
      const from = s.collections.findIndex((c) => c.id === fromId)
      const to = s.collections.findIndex((c) => c.id === toId)
      if (from === -1 || to === -1 || from === to) return s
      const next = [...s.collections]
      const [removed] = next.splice(from, 1)
      next.splice(to, 0, removed)
      return { collections: next }
    })
    get().save()
  },

  duplicateNode: (collectionId, nodeId) => {
    const state = get()
    const col = state.collections.find((c) => c.id === collectionId)
    if (!col) return null
    const original = findInTree(col.children, nodeId)
    if (!original) return null
    const clone = { ...deepCloneWithNewIds(original), name: `${original.name} (copy)` }
    const insertAfter = (nodes: TreeNode[]): TreeNode[] => {
      const result: TreeNode[] = []
      for (const n of nodes) {
        if (n.type === 'folder') {
          result.push({ ...n, children: insertAfter(n.children) })
        } else {
          result.push(n)
        }
        if (n.id === nodeId) result.push(clone)
      }
      return result
    }
    set((s) => ({
      collections: s.collections.map((c) =>
        c.id === collectionId ? { ...c, children: insertAfter(c.children) } : c
      ),
    }))
    get().save()
    return clone
  },
}))
