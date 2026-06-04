import { create } from 'zustand'
import type { Collection, CollectionWorkspace, TreeNode, RequestItem, FolderItem, RequestBody } from '@/lib/types'
import { uid, blankBody, blankKVRow, blankAuth } from '@/lib/types'
import { StorageGet, StoragePut } from '@/wailsjs/go/main/App'
import { debouncedSave } from '@/lib/storeSave'
import { storageSchema } from '@/lib/storageSchemas'

const COLLECTIONS_SCHEMA = storageSchema('collections')
const BUCKET = COLLECTIONS_SCHEMA.bucket
const KEY = COLLECTIONS_SCHEMA.item

interface PersistedCollections {
  version: number
  activeWorkspaceId: string
  workspaces: CollectionWorkspace[]
}

interface CollectionsState {
  collections: Collection[]
  workspaces: CollectionWorkspace[]
  activeWorkspaceId: string
  loaded: boolean
  loadError: boolean
  load: () => Promise<void>
  save: () => void
  replaceCollections: (collections: Collection[]) => void
  addWorkspace: (name: string) => CollectionWorkspace
  renameWorkspace: (id: string, name: string) => void
  deleteWorkspace: (id: string) => string | null
  setActiveWorkspace: (id: string) => void
  moveCollectionToWorkspace: (collectionId: string, targetWorkspaceId: string) => void
  addCollection: (name: string) => Collection
  deleteCollection: (id: string) => void
  renameCollection: (id: string, name: string) => void
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

function findParentInfo(nodes: TreeNode[], id: string, parentId: string | null = null): { parentId: string | null; index: number } | null {
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
  loaded: false,
  loadError: false,

  load: async () => {
    try {
      const raw = await StorageGet(BUCKET, KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
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
        set({ collections, workspaces, activeWorkspaceId, loaded: true, loadError: false })
      } else {
        const workspace = makeWorkspace(DEFAULT_WORKSPACE_NAME, [], DEFAULT_WORKSPACE_ID)
        set({
          collections: [],
          workspaces: [workspace],
          activeWorkspaceId: workspace.id,
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
        loaded: true,
        loadError: true,
      })
    }
  },

  save: () => {
    const s = get()
    if (!s.loaded || s.loadError) return
    const workspaces = syncActiveWorkspace(s.workspaces, s.activeWorkspaceId, s.collections)
    set({ workspaces })
    const persisted: PersistedCollections = {
      version: COLLECTIONS_SCHEMA.currentVersion,
      activeWorkspaceId: s.activeWorkspaceId,
      workspaces,
    }
    debouncedSave('collections', () => StoragePut(BUCKET, KEY, JSON.stringify(persisted)))
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
    set((s) => ({ workspaces: [...s.workspaces, workspace] }))
    get().save()
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
    get().save()
  },

  deleteWorkspace: (id) => {
    const state = get()
    if (state.workspaces.length <= 1 || !state.workspaces.some((workspace) => workspace.id === id)) return null
    const remaining = state.workspaces.filter((workspace) => workspace.id !== id)
    const nextActiveId = state.activeWorkspaceId === id ? remaining[0].id : state.activeWorkspaceId
    const nextCollections = remaining.find((workspace) => workspace.id === nextActiveId)?.collections ?? []
    set({ workspaces: remaining, activeWorkspaceId: nextActiveId, collections: nextCollections })
    get().save()
    return nextActiveId
  },

  setActiveWorkspace: (id) => {
    const state = get()
    if (id === state.activeWorkspaceId) return
    const target = state.workspaces.find((workspace) => workspace.id === id)
    if (!target) return
    const synced = syncActiveWorkspace(state.workspaces, state.activeWorkspaceId, state.collections)
    set({ workspaces: synced, activeWorkspaceId: id, collections: target.collections })
    get().save()
  },

  moveCollectionToWorkspace: (collectionId, targetWorkspaceId) => {
    const state = get()
    if (targetWorkspaceId === state.activeWorkspaceId) return
    const collection = state.collections.find((item) => item.id === collectionId)
    if (!collection || !state.workspaces.some((workspace) => workspace.id === targetWorkspaceId)) return
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
    get().save()
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
    const clone = deepCloneWithNewIds(original)
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
