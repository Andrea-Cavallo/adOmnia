import { describe, expect, it } from 'vitest'
import type { DevEntity, DevSnapshot } from '@/lib/devcontext-api'
import {
  endpointCandidatesForHandler,
  endpointCandidatesForRequest,
  linkFromCandidate,
  linkFromRoute,
  requestMatchesRoute,
  requestPathname,
} from './resolve'

const route = (method: string, path: string, attrs: Record<string, string> = {}): DevEntity => ({
  id: `route:${method} ${path}`,
  kind: 'route',
  label: `${method} ${path}`,
  confidence: 'inferred',
  attrs: { method, path, ...attrs },
  sources: [{ detector: 'goroutes', file: 'internal/api/routes.go', line: 9 }],
})

const snapshot = (sessionId: string, root: string, entities: DevEntity[]): DevSnapshot => ({
  sessionId, root, version: 1, entities, warnings: [], scannedAt: '',
})

const usersRoute = () => route('GET', '/users/{id}', {
  handler: 'h.GetUser',
  handlerFile: 'internal/api/routes.go',
  handlerLine: '12',
  declName: 'UserHandler.GetUser',
  declFile: 'internal/api/user_handler.go',
  declLine: '31',
})

describe('request ↔ endpoint resolution', () => {
  it('reads the path of a templated or absolute URL', () => {
    expect(requestPathname('{{baseUrl}}/users/{{id}}')).toBe('/users/{{id}}')
    expect(requestPathname('{{baseUrl}}/users/7?active=1')).toBe('/users/7')
    expect(requestPathname('{{service:users}}/users/7')).toBe('/users/7')
    expect(requestPathname('http://localhost:8080/users/7')).toBe('/users/7')
  })

  it('matches a request to a parameterised route, with variables resolved', () => {
    const request = { method: 'GET' as const, url: '{{baseUrl}}/users/{{id}}' }
    expect(requestMatchesRoute(request, usersRoute(), { baseUrl: 'http://localhost:8080', id: '42' })).toBe(true)
    expect(requestMatchesRoute({ ...request, method: 'DELETE' as const }, usersRoute())).toBe(false)
    expect(requestMatchesRoute({ ...request, url: '{{baseUrl}}/orders/1' }, usersRoute())).toBe(false)
  })

  it('returns every matching project so none is linked silently, preferred first', () => {
    const snapshots = {
      'go-a': snapshot('go-a', '/work/users-api', [usersRoute()]),
      'go-b': snapshot('go-b', '/work/admin-api', [usersRoute()]),
    }
    const candidates = endpointCandidatesForRequest(snapshots, 'GET', '{{baseUrl}}/users/7', { baseUrl: 'http://localhost:8080' })
    expect(candidates.map((candidate) => candidate.projectName)).toEqual(['admin-api', 'users-api'])
    const preferred = endpointCandidatesForRequest(snapshots, 'GET', '{{baseUrl}}/users/7', { baseUrl: 'http://localhost:8080' }, { preferSessionId: 'go-a' })
    expect(preferred[0].sessionId).toBe('go-a')
  })

  it('never searches outside the explicitly scoped project', () => {
    const snapshots = {
      'go-a': snapshot('go-a', '/work/users-api', [usersRoute()]),
      'go-b': snapshot('go-b', '/work/admin-api', [usersRoute()]),
    }
    const candidates = endpointCandidatesForRequest(snapshots, 'GET', '/users/7', {}, { sessionId: 'go-b' })
    expect(candidates).toHaveLength(1)
    expect(candidates[0].sessionId).toBe('go-b')
  })

  it('finds the endpoint at a handler declaration and at the registration line', () => {
    const snapshots = { 'go-a': snapshot('go-a', '/work/users-api', [usersRoute()]) }
    const byDeclaration = endpointCandidatesForHandler(snapshots, 'go-a', 'internal/api/user_handler.go', 31)
    expect(byDeclaration.map((candidate) => candidate.path)).toEqual(['/users/{id}'])
    expect(byDeclaration[0].file).toBe('internal/api/user_handler.go')
    expect(byDeclaration[0].line).toBe(31)

    const byRegistration = endpointCandidatesForHandler(snapshots, 'go-a', 'internal/api/routes.go', 12)
    expect(byRegistration.map((candidate) => candidate.path)).toEqual(['/users/{id}'])
  })

  it('returns every endpoint of an ambiguous handler', () => {
    const shared = route('ANY', '/users', { declFile: 'internal/api/user_handler.go', declLine: '40', declName: 'UserHandler.List' })
    const snapshots = { 'go-a': snapshot('go-a', '/work/users-api', [shared, route('POST', '/users', { declFile: 'internal/api/user_handler.go', declLine: '40', declName: 'UserHandler.List' })]) }
    expect(endpointCandidatesForHandler(snapshots, 'go-a', 'internal/api/user_handler.go', 40)).toHaveLength(2)
  })

  it('resolves nothing outside the session when the handler belongs to another project', () => {
    const snapshots = { 'go-b': snapshot('go-b', '/work/admin-api', [usersRoute()]) }
    expect(endpointCandidatesForHandler(snapshots, 'go-a', 'internal/api/user_handler.go', 31)).toEqual([])
  })

  it('builds the shared link from a candidate or a route', () => {
    const snapshots = { 'go-a': snapshot('go-a', '/work/users-api', [usersRoute()]) }
    const candidate = endpointCandidatesForRequest(snapshots, 'GET', '/users/7')[0]
    const fromCandidate = linkFromCandidate(candidate, 'request', 'tab-1')
    expect(fromCandidate).toMatchObject({ sessionId: 'go-a', routeId: 'route:GET /users/{id}', file: 'internal/api/user_handler.go', line: 31, requestTabId: 'tab-1', origin: 'request' })
    const fromRoute = linkFromRoute('go-a', usersRoute(), 'tab-2')
    expect(fromRoute).toMatchObject({ handler: 'UserHandler.GetUser', requestTabId: 'tab-2', origin: 'code' })
  })
})
