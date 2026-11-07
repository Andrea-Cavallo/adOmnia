import { describe, expect, it } from 'vitest'
import type { DevEntity, DevSnapshot } from '@/lib/devcontext-api'
import { endpointCatalog, endpointGroup, filterCatalog, groupCatalog } from './catalog'

const route = (method: string, path: string, attrs: Record<string, string> = {}): DevEntity => ({
  id: `route:${method} ${path}`, kind: 'route', label: `${method} ${path}`, confidence: 'inferred',
  attrs: { method, path, ...attrs }, sources: [{ detector: 'goroutes', file: 'internal/api/routes.go', line: 9 }],
})

const snapshot = (sessionId: string, root: string, entities: DevEntity[]): DevSnapshot => ({
  sessionId, root, version: 1, entities, warnings: [], scannedAt: '',
})

describe('endpoint catalog', () => {
  const sources = [
    { sessionId: 'go-a', projectName: 'users-api', root: '/work/users-api', snapshot: snapshot('go-a', '/work/users-api', [
      route('GET', '/users/{id}', { declName: 'UserHandler.GetUser', declFile: 'internal/api/user_handler.go', declLine: '12' }),
      route('POST', '/users', { declName: 'UserHandler.Create', declFile: 'internal/api/user_handler.go', declLine: '20' }),
    ]) },
    { sessionId: 'go-b', projectName: 'admin-api', root: '/work/admin-api', snapshot: snapshot('go-b', '/work/admin-api', [
      route('GET', '/users/{id}', { declName: 'AdminController.user', declFile: 'src/AdminController.java', declLine: '40' }),
    ]) },
  ]

  it('lists every endpoint with its project and controller/package group', () => {
    const items = endpointCatalog(sources)
    expect(items.map((item) => `${item.projectName}:${item.group}:${item.method}:${item.path}`)).toEqual([
      'admin-api:AdminController:GET:/users/{id}',
      'users-api:UserHandler:POST:/users',
      'users-api:UserHandler:GET:/users/{id}',
    ])
  })

  it('groups by project and then by controller/package', () => {
    const groups = groupCatalog(endpointCatalog(sources))
    expect(groups.map((project) => project.projectName)).toEqual(['admin-api', 'users-api'])
    expect(groups[1].groups.map((group) => group.name)).toEqual(['UserHandler'])
  })

  it('filters by method, path, handler, group or project', () => {
    const items = endpointCatalog(sources)
    expect(filterCatalog(items, 'post users').map((item) => item.path)).toEqual(['/users'])
    expect(filterCatalog(items, 'create').map((item) => item.path)).toEqual(['/users'])
    expect(filterCatalog(items, 'admincontroller').map((item) => item.projectName)).toEqual(['admin-api'])
    expect(filterCatalog(items, '/users/{id}')).toHaveLength(2)
  })

  it('derives the group from the containing folder when no class is declared', () => {
    expect(endpointGroup(route('GET', '/x', { declFile: 'internal/billing/handlers.go' }))).toBe('billing')
    expect(endpointGroup(route('GET', '/x'))).toBe('api')
  })
})
