/**
 * The WebSocket view of the protocol modules (`lib/protocolModules.ts`): a collection created or imported in
 * the WebSocket module is `scope: 'websocket'` and holds only WebSocket requests.
 */
import type { Collection } from '@/lib/types'
import { collectionsOfModule, onlyModuleNodes } from '@/lib/protocolModules'

/** One collection with only its WebSocket requests, keeping the folders that lead to them. */
export const withoutHttpNodes = (collection: Collection): Collection => onlyModuleNodes(collection, 'websocket')

/** Collections of the WebSocket module. Empty ones stay: they are where the next connection goes. */
export const websocketCollections = (collections: Collection[]): Collection[] => collectionsOfModule(collections, 'websocket')

/** Collections of the API workspace: every collection not dedicated to a protocol module. */
export const apiCollections = (collections: Collection[]): Collection[] => collectionsOfModule(collections, null)
