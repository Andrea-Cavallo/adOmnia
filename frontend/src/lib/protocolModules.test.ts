import { describe, expect, it } from 'vitest'
import { blankRequest, type Collection } from '@/lib/types'
import { blankWebSocketRequest } from '@/lib/websocket/wsRequest'
import { blankGrpcRequest } from '@/lib/grpc/grpcRequest'
import { collectionsOfModule, isWorkspaceRail, methodLabel, moduleOfRequest, railOfRequest } from './protocolModules'

describe('protocol modules', () => {
  const rest = blankRequest('GET', 'rest')
  const ws = blankWebSocketRequest('ws', 'ws://x')
  const grpc = blankGrpcRequest('call', 'h:1')
  const collections: Collection[] = [
    { id: 'api', name: 'API', children: [rest] },
    { id: 'g', name: 'gRPC', scope: 'grpc', children: [grpc, rest, { id: 'f', name: 'folder', type: 'folder', children: [rest] }] },
    { id: 'w', name: 'WS', scope: 'websocket', children: [ws] },
  ]

  it('knows which module owns a request and where it opens', () => {
    expect([moduleOfRequest(rest), moduleOfRequest(ws), moduleOfRequest(grpc)]).toEqual([null, 'websocket', 'grpc'])
    expect([railOfRequest(rest), railOfRequest(grpc)]).toEqual(['collections', 'grpc'])
    expect([isWorkspaceRail('grpc'), isWorkspaceRail('collections'), isWorkspaceRail('mock')]).toEqual([true, true, false])
    expect(methodLabel('GRPC')).toBe('gRPC')
  })

  it('shows each module only its own collections and items', () => {
    expect(collectionsOfModule(collections, null).map((collection) => collection.id)).toEqual(['api'])
    const grpcView = collectionsOfModule(collections, 'grpc')
    expect(grpcView.map((collection) => collection.id)).toEqual(['g'])
    expect(grpcView[0].children.map((node) => node.id)).toEqual([grpc.id])
    expect(collectionsOfModule(collections, 'websocket')[0].children).toHaveLength(1)
  })
})
