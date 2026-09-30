import { describe, expect, it } from 'vitest'
import type { DevEntity, DevSnapshot } from '@/lib/devcontext-api'
import { findRoute, pathParams, requestPath, routeMatches, routesForHandler } from './routeMatch'

const route = (method: string, path: string, attrs: Record<string, string> = {}): DevEntity => ({
  id: `route:${method} ${path}`, kind: 'route', label: `${method} ${path}`, confidence: 'inferred',
  attrs: { method, path, ...attrs }, sources: [{ detector: 'goroutes', file: 'internal/api/routes.go', line: 9 }],
})

const snapshot = (entities: DevEntity[]): DevSnapshot => ({ sessionId: 'go-1', root: '/p', version: 1, entities, warnings: [], scannedAt: '' })

describe('routeMatch', () => {
  it('matches params and wildcards', () => {
    expect(routeMatches('/users/{id}', '/users/123')).toBe(true)
    expect(routeMatches('/users/{id}', '/users/123/orders')).toBe(false)
    expect(routeMatches('/files/{path...}', '/files/a/b/c')).toBe(true)
    expect(routeMatches('/users/me', '/users/123')).toBe(false)
    expect(routeMatches('/', '/')).toBe(true)
  })

  it('prefers the exact method and the most literal pattern, and points at the handler declaration', () => {
    const snapshots = {
      'go-1': snapshot([
        route('ANY', '/users/{id}'),
        route('PUT', '/users/{id}', { declFile: 'internal/api/user_handler.go', declLine: '71', declName: 'UserHandler.UpdateUser' }),
        route('PUT', '/users/{rest...}'),
      ]),
    }
    const match = findRoute(snapshots, 'put', 'http://localhost:8080/users/123?active=true')
    expect(match?.route.attrs.path).toBe('/users/{id}')
    expect(match?.file).toBe('internal/api/user_handler.go')
    expect(match?.line).toBe(71)
    expect(match?.name).toBe('UserHandler.UpdateUser')
    expect(findRoute(snapshots, 'DELETE', 'http://localhost:8080/orders')).toBeNull()
  })

  it('finds routes from a handler line', () => {
    const snap = snapshot([route('PUT', '/users/{id}', { declFile: 'h.go', declLine: '71' }), route('GET', '/x', { declFile: 'h.go', declLine: '90' })])
    expect(routesForHandler(snap, 'h.go', 71).map((r) => r.attrs.path)).toEqual(['/users/{id}'])
  })

  it('reads the path of partially resolved URLs', () => {
    expect(requestPath('{{baseUrl}}/users/1')).toBeNull()
    expect(requestPath('/users/1')).toBe('/users/1')
    expect(requestPath('http://localhost:8080/users/1?x=1')).toBe('/users/1')
  })
})

describe('pathParams', () => {
  it('extracts named and wildcard params', () => {
    expect(pathParams('/users/{id}', '/users/123')).toEqual({ id: '123' })
    expect(pathParams('/files/{path...}', '/files/a/b%20c')).toEqual({ path: 'a/b c' })
  })
})
