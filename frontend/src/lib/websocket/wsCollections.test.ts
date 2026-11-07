import { describe, expect, it } from 'vitest'
import type { Collection, FolderItem, RequestItem } from '@/lib/types'
import { blankRequest, uid } from '@/lib/types'
import { blankWebSocketRequest } from './wsRequest'
import { apiCollections, websocketCollections, withoutHttpNodes } from './wsCollections'

const http = (name: string): RequestItem => blankRequest('GET', name)
const ws = (name: string): RequestItem => blankWebSocketRequest(name, 'ws://localhost/feed')

describe('websocketCollections', () => {
  it('keeps only WebSocket-scoped collections and their WebSocket requests', () => {
    const folder: FolderItem = { id: uid(), name: 'Realtime', type: 'folder', children: [ws('feed'), http('health')] }
    const collections: Collection[] = [
      { id: 'api', name: 'API', children: [http('users')] },
      { id: 'ws', name: 'Realtime', scope: 'websocket', children: [http('users'), folder, ws('notifications')] },
    ]
    const [filtered] = websocketCollections(collections)
    expect(filtered.id).toBe('ws')
    expect(filtered.children.map((node) => node.name)).toEqual(['Realtime', 'notifications'])
    expect((filtered.children[0] as FolderItem).children.map((node) => node.name)).toEqual(['feed'])
  })

  it('keeps an empty WebSocket collection: it is where the next connection goes', () => {
    const collections: Collection[] = [{ id: 'ws', name: 'Socket', scope: 'websocket', children: [] }]
    expect(websocketCollections(collections).map((collection) => collection.id)).toEqual(['ws'])
  })

  it('does not mutate the source collections', () => {
    const folder: FolderItem = { id: uid(), name: 'Realtime', type: 'folder', children: [ws('feed'), http('health')] }
    const collections: Collection[] = [{ id: 'ws', name: 'Realtime', scope: 'websocket', children: [folder] }]
    websocketCollections(collections)
    expect((collections[0].children[0] as FolderItem).children).toHaveLength(2)
  })
})

describe('apiCollections', () => {
  it('never shows the WebSocket collections in the API workspace', () => {
    const collections: Collection[] = [
      { id: 'api', name: 'API', children: [http('users')] },
      { id: 'ws', name: 'Realtime', scope: 'websocket', children: [ws('feed')] },
    ]
    expect(apiCollections(collections).map((collection) => collection.id)).toEqual(['api'])
  })
})

describe('withoutHttpNodes', () => {
  it('keeps the collection identity and scope while dropping HTTP requests', () => {
    const collection: Collection = { id: 'import', name: 'Imported', color: '#fff', scope: 'websocket', children: [http('users'), ws('feed')] }
    const filtered = withoutHttpNodes(collection)
    expect(filtered).toMatchObject({ id: 'import', name: 'Imported', color: '#fff', scope: 'websocket' })
    expect(filtered.children.map((node) => node.name)).toEqual(['feed'])
  })
})
