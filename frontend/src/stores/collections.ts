import { create } from 'zustand'
import type { Collection, TreeNode, RequestItem, FolderItem, RequestBody } from '@/lib/types'
import { uid, blankBody, blankKVRow, blankAuth } from '@/lib/types'
import { StorageGet, StoragePut } from '@/wailsjs/go/main/App'

const BUCKET = 'collections'
const KEY = 'all'

interface CollectionsState {
  collections: Collection[]
  loaded: boolean
  loadError: boolean
  load: () => Promise<void>
  save: () => Promise<void>
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
  loaded: false,
  loadError: false,

  load: async () => {
    try {
      const raw = await StorageGet(BUCKET, KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Collection[]
        const migrated = migrateCollections(parsed)
        set({ collections: migrated, loaded: true, loadError: false })
      } else {
        set({ loaded: true, loadError: false })
      }
    } catch {
      set({ loaded: true, loadError: true })
    }
  },

  save: async () => {
    const s = get()
    if (!s.loaded || s.loadError) return
    try {
      await StoragePut(BUCKET, KEY, JSON.stringify(s.collections))
    } catch (e) {
      console.error('Failed to save collections:', e)
    }
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
