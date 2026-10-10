import { describe, expect, it } from 'vitest'
import type { DevEntity } from '@/lib/devcontext-api'
import type { LiveSession } from '@/lib/devsession-api'
import { serviceApiCollection, workspaceServices } from './workspaceFlow'

const route = (method: string, path: string, declName = ''): DevEntity => ({ id: `${method} ${path}`, kind: 'route', label: `${method} ${path}`, attrs: { method, path, declName }, sources: [], confidence: 'certain' })

describe('workspace flow', () => {
  it('builds one linked request per route, without duplicates', () => {
    const collection = serviceApiCollection('users', [route('GET', '/users/{id}', 'getUser'), route('ANY', '/health'), route('GET', '/users/{id}'), { ...route('GET', '/x'), kind: 'service' }])
    expect(collection.name).toBe('users API')
    expect(collection.children.map((item) => item.type === 'request' && [item.method, item.url, item.name])).toEqual([
      ['GET', '{{service:users}}/health', 'GET /health'],
      ['GET', '{{service:users}}/users/{{id}}', 'getUser'],
    ])
  })

  it('keeps only the live services of the project', () => {
    const live = (id: string, goSessionId: string, endedAt: string | null = null) => ({ id, goSessionId, service: id, endedAt } as LiveSession)
    expect(workspaceServices({ a: live('b-api', 'g1'), b: live('a-worker', 'g1'), c: live('old', 'g1', '2026-01-01'), d: live('other', 'g2') }, 'g1').map((s) => s.id)).toEqual(['a-worker', 'b-api'])
  })
})
