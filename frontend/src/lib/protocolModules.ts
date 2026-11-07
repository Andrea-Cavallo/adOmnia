/**
 * The protocol modules: WebSocket and gRPC have the API workspace's layout but their own rail item, tab strip
 * and collections (`scope`), so a gRPC call never shows up among the REST requests and the other way round.
 * Everything that needs to know "which module owns this" asks here.
 */
import type { RailItem } from '@/stores/app'
import type { Collection, HttpMethod, RequestItem, TreeNode } from '@/lib/types'
import { blankWebSocketRequest } from '@/lib/websocket/wsRequest'
import { blankGrpcRequest } from '@/lib/grpc/grpcRequest'

export type ProtocolModule = 'websocket' | 'grpc'

export interface ProtocolModuleSpec {
  id: ProtocolModule
  /** The request method of the module's items. */
  method: HttpMethod
  /** Shown in menus: "New WebSocket", "New gRPC call". */
  newLabel: string
  title: string
  blank: () => RequestItem
}

export const PROTOCOL_MODULES: Record<ProtocolModule, ProtocolModuleSpec> = {
  websocket: { id: 'websocket', method: 'WS', newLabel: 'New WebSocket', title: 'WebSocket', blank: () => blankWebSocketRequest() },
  grpc: { id: 'grpc', method: 'GRPC', newLabel: 'New gRPC call', title: 'gRPC', blank: () => blankGrpcRequest() },
}

const MODULE_OF_METHOD = new Map<HttpMethod, ProtocolModule>(Object.values(PROTOCOL_MODULES).map((spec) => [spec.method, spec.id]))

export const isProtocolModule = (rail: RailItem | string): rail is ProtocolModule => rail === 'websocket' || rail === 'grpc'

/** The rails that show the request workspace: the API workspace and the protocol modules. */
export const isWorkspaceRail = (rail: RailItem | string) => rail === 'collections' || isProtocolModule(rail)

/** The module of the active rail, or null in the API workspace and elsewhere. */
export const moduleOfRail = (rail: RailItem | string): ProtocolModule | null => (isProtocolModule(rail) ? rail : null)

/** The module that owns a request, or null for an API request. */
export const moduleOfRequest = (request: Pick<RequestItem, 'method'>): ProtocolModule | null => MODULE_OF_METHOD.get(request.method) ?? null

/** The rail where a request is opened. */
export const railOfRequest = (request: Pick<RequestItem, 'method'>): RailItem => moduleOfRequest(request) ?? 'collections'

function moduleNodes(nodes: TreeNode[], module: ProtocolModule): TreeNode[] {
  const kept: TreeNode[] = []
  for (const node of nodes) {
    if (node.type === 'folder') {
      const children = moduleNodes(node.children, module)
      if (children.length) kept.push({ ...node, children })
    } else if (moduleOfRequest(node) === module) {
      kept.push(node)
    }
  }
  return kept
}

/** One collection with only the items of a module, keeping the folders that lead to them. */
export function onlyModuleNodes(collection: Collection, module: ProtocolModule): Collection {
  return { ...collection, children: moduleNodes(collection.children, module) }
}

/** The collections a rail shows: a module's own (only its items), or the API ones. Empty ones stay. */
export function collectionsOfModule(collections: Collection[], module: ProtocolModule | null): Collection[] {
  if (!module) return collections.filter((collection) => !collection.scope)
  return collections.filter((collection) => collection.scope === module).map((collection) => onlyModuleNodes(collection, module))
}

/** The method as people write it in a badge: gRPC, not GRPC. */
export const methodLabel = (method: HttpMethod): string => (method === 'GRPC' ? 'gRPC' : method)
