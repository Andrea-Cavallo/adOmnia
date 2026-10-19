import { describe, expect, it } from 'vitest'
import {
  findRequestNode,
  findTreeNode,
  parseWorkspaceContents,
  parseWorkspacePayload,
  projectTree,
  splitWorkspace,
} from './workspaceSplit'
import type { Collection, CollectionWorkspace, FolderItem, RequestItem } from './types'
import { blankRequest } from './types'

function fixtureRequest(): RequestItem {
  const request = blankRequest('POST', 'Create payment')
  request.url = 'https://api.test/payments'
  request.description = 'Creates one payment'
  request.headers = [{ id: 'h1', key: 'X-Trace', value: '1', enabled: true }]
  request.bodies = [{ id: 'b1', name: 'Body 1', type: 'raw', raw: '{"amount":1}', lang: 'json', form: [] }]
  request.auth = { type: 'bearer', token: 'secret' } as unknown as RequestItem['auth']
  return request
}

function fixtureCollections(): Collection[] {
  return [{
    id: 'col-1',
    name: 'Payments',
    color: '#ff0000',
    _openapiSpec: '{"openapi":"3.0.0"}',
    children: [
      { id: 'folder-1', name: 'Refunds', type: 'folder', children: [fixtureRequest()] },
    ],
  }]
}

function fixtureWorkspace(): CollectionWorkspace {
  return {
    id: 'ws-1',
    name: 'Workspace',
    collections: fixtureCollections(),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  }
}

describe('workspace tree projection', () => {
  it('keeps only tree metadata for requests and drops collection specs', () => {
    const [collection] = projectTree(fixtureCollections())
    expect(collection.color).toBe('#ff0000')
    expect(collection._openapiSpec).toBeUndefined()
    const folder = collection.children[0] as { children: RequestItem[] }
    const request = folder.children[0]
    expect(request).toEqual({
      id: expect.any(String),
      name: 'Create payment',
      type: 'request',
      method: 'POST',
      url: 'https://api.test/payments',
      description: 'Creates one payment',
    })
    expect((request as unknown as { bodies?: unknown }).bodies).toBeUndefined()
    expect((request as unknown as { headers?: unknown }).headers).toBeUndefined()
    expect((request as unknown as { auth?: unknown }).auth).toBeUndefined()
  })

  it('splits a workspace into tree metadata plus complete request contents', () => {
    const workspace = fixtureWorkspace()
    const persisted = splitWorkspace(workspace)
    expect(persisted.tree).toEqual(projectTree(workspace.collections))
    expect(persisted.collections).toBe(workspace.collections)
    const request = findRequestNode(persisted.collections, (persisted.tree?.[0]?.children[0] as FolderItem).children[0].id)
    expect(request?.bodies[0].raw).toBe('{"amount":1}')
    expect(request?.headers[0].key).toBe('X-Trace')
  })
})

describe('structured workspace payload', () => {
  it('parses the shell without parsing request contents', () => {
    const payload = parseWorkspacePayload({
      workspace: { id: 'ws-1', name: 'Workspace', tree: [{ id: 'col', name: 'C', children: [] }] },
      collectionsJson: '[{"id":"col","name":"C","children":[]}]',
    })
    expect(payload.workspace.id).toBe('ws-1')
    expect(payload.workspace.tree?.[0]?.id).toBe('col')
    expect(typeof payload.collectionsJson).toBe('string')
  })

  it('reports a missing tree projection as null', () => {
    const payload = parseWorkspacePayload({
      workspace: { id: 'ws-1', name: 'Workspace' },
      collectionsJson: '[]',
    })
    expect(payload.workspace.tree).toBeNull()
  })

  it('rejects malformed shells', () => {
    expect(() => parseWorkspacePayload(null)).toThrow('Invalid workspace payload')
    expect(() => parseWorkspacePayload({ workspace: { name: 'x' }, collectionsJson: '[]' })).toThrow('shell')
    expect(() => parseWorkspacePayload({ workspace: { id: 'ws' }, collectionsJson: 3 })).toThrow('contents')
  })

  it('rejects request contents that are not an array', () => {
    expect(() => parseWorkspaceContents('{"not":"an array"}')).toThrow('Invalid workspace collections')
    expect(parseWorkspaceContents('[{"id":"col","name":"C","children":[]}]')).toHaveLength(1)
  })

  it('locates nodes inside complete collections', () => {
    const collections = fixtureCollections()
    const requestId = (collections[0].children[0] as { children: RequestItem[] }).children[0].id
    expect(findTreeNode(collections, 'folder-1')?.type).toBe('folder')
    expect(findRequestNode(collections, requestId)?.name).toBe('Create payment')
    expect(findRequestNode(collections, 'missing')).toBeNull()
  })
})
