/**
 * The two collection scopes of the app. A collection created or imported in the
 * WebSocket module is `scope: 'websocket'` and never appears in the API
 * workspace; every other collection is an API collection. Inside a WebSocket
 * collection only WebSocket requests are shown, so a mixed import cannot leak
 * HTTP requests into the module.
 */
import type { Collection, TreeNode } from '@/lib/types'
import { isWebSocketRequest } from './wsRequest'

function wsNodes(nodes: TreeNode[]): TreeNode[] {
  const kept: TreeNode[] = []
  for (const node of nodes) {
    if (node.type === 'folder') {
      const children = wsNodes(node.children)
      if (children.length) kept.push({ ...node, children })
    } else if (isWebSocketRequest(node)) {
      kept.push(node)
    }
  }
  return kept
}

/** One collection with only its WebSocket requests, keeping the folders that lead to them. */
export function withoutHttpNodes(collection: Collection): Collection {
  return { ...collection, children: wsNodes(collection.children) }
}

/** Collections of the WebSocket module. Empty ones stay: they are where the next connection goes. */
export function websocketCollections(collections: Collection[]): Collection[] {
  return collections.filter((collection) => collection.scope === 'websocket').map(withoutHttpNodes)
}

/** Collections of the API workspace: everything not dedicated to WebSocket. */
export function apiCollections(collections: Collection[]): Collection[] {
  return collections.filter((collection) => collection.scope !== 'websocket')
}
