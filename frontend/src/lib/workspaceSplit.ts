import { scheduleStartupIdle } from './startupIdle'
import type { Collection, CollectionWorkspace, FolderItem, RequestItem, TreeNode } from './types'

/**
 * Tree metadata projection for one request node: everything the collection
 * tree renders or searches (name, method, url, notes) and nothing else.
 * Request bodies, headers, auth and scripts stay in the complete `collections`
 * payload until the renderer hydrates them.
 */
export interface RequestTreeMeta {
  id: string
  name: string
  type: 'request'
  method: string
  url: string
  description?: string
}

/** Persisted workspace JSON: complete collections plus the tree projection. */
export interface PersistedWorkspace {
  id: string
  name: string
  tree?: Collection[]
  collections: Collection[]
  createdAt: string
  updatedAt: string
}

/**
 * Structured workspace IPC response. `workspace` carries the metadata and tree
 * projection; `collectionsJson` is the complete collections array as JSON text
 * so its parse can be deferred past the first tree render.
 */
export interface StructuredWorkspacePayload {
  workspace: {
    id: string
    name: string
    createdAt?: string
    updatedAt?: string
    tree?: Collection[] | null
  }
  collectionsJson: string
}

function projectNode(node: TreeNode): TreeNode {
  if (node.type === 'folder') {
    const folder: FolderItem = {
      id: node.id,
      name: node.name,
      type: 'folder',
      children: node.children.map(projectNode),
    }
    return folder
  }
  const meta: RequestTreeMeta = {
    id: node.id,
    name: node.name,
    type: 'request',
    method: node.method,
    url: node.url,
  }
  if (node.description) meta.description = node.description
  return meta as unknown as RequestItem
}

/** Build the tree metadata projection of complete collections. */
export function projectTree(collections: Collection[]): Collection[] {
  return collections.map((collection) => {
    const projected: Collection = {
      id: collection.id,
      name: collection.name,
      children: collection.children.map(projectNode),
    }
    if (collection.color !== undefined) projected.color = collection.color
    return projected
  })
}

/**
 * Serialize one workspace for persistence: the tree projection and the
 * complete request contents travel side by side in the same shard. Older
 * shards without `tree` keep loading; their next save adds the projection.
 */
export function splitWorkspace(workspace: CollectionWorkspace): PersistedWorkspace {
  return {
    id: workspace.id,
    name: workspace.name,
    tree: projectTree(workspace.collections),
    collections: workspace.collections,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  }
}

/** Parse the structured IPC response, rejecting malformed shells. */
export function parseWorkspacePayload(raw: unknown): StructuredWorkspacePayload {
  const payload = raw as Partial<StructuredWorkspacePayload> | null
  if (!payload || typeof payload !== 'object') throw new Error('Invalid workspace payload')
  const shell = payload.workspace
  if (!shell || typeof shell !== 'object' || typeof shell.id !== 'string' || !shell.id) {
    throw new Error('Invalid workspace payload shell')
  }
  if (typeof payload.collectionsJson !== 'string') throw new Error('Invalid workspace payload contents')
  return {
    workspace: {
      id: shell.id,
      name: typeof shell.name === 'string' && shell.name ? shell.name : 'Untitled Workspace',
      createdAt: shell.createdAt,
      updatedAt: shell.updatedAt,
      tree: Array.isArray(shell.tree) ? (shell.tree as Collection[]) : null,
    },
    collectionsJson: payload.collectionsJson,
  }
}

/** Parse the complete collections JSON text of one workspace. */
export function parseWorkspaceContents(collectionsJson: string): Collection[] {
  const parsed: unknown = JSON.parse(collectionsJson)
  if (!Array.isArray(parsed)) throw new Error('Invalid workspace collections')
  return parsed as Collection[]
}

/** Locates one node inside complete collections. */
export function findTreeNode(collections: Collection[], nodeId: string): TreeNode | null {
  const walk = (nodes: TreeNode[]): TreeNode | null => {
    for (const node of nodes) {
      if (node.id === nodeId) return node
      if (node.type === 'folder') {
        const found = walk(node.children)
        if (found) return found
      }
    }
    return null
  }
  for (const collection of collections) {
    const found = walk(collection.children)
    if (found) return found
  }
  return null
}

/** Locates one request node inside complete collections. */
export function findRequestNode(collections: Collection[], requestId: string): RequestItem | null {
  const node = findTreeNode(collections, requestId)
  return node && node.type === 'request' ? node : null
}

/**
 * Schedule deferred request-content hydration. The scheduler falls back to a
 * plain timeout where requestIdleCallback is unavailable (tests, old runtimes).
 */
export function scheduleWorkspaceIdle(task: () => void): void {
  scheduleStartupIdle(task, 1500, globalThis as unknown as Parameters<typeof scheduleStartupIdle>[2])
}
