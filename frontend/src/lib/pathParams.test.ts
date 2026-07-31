import { describe, expect, it } from 'vitest'
import { applyPathParams, detectPathParamKeys, pathParamDefaultValues, renamePathParamKey } from '@/lib/pathParams'

describe('path parameter helpers', () => {
  it('renames matching placeholders without changing their syntax or environment variables', () => {
    const url = 'https://api.test/teams/:teamId/users/{userId}?scope={{scope}}'

    const renamed = renamePathParamKey(url, 'teamId', 'workspaceId')

    expect(renamed).toBe('https://api.test/teams/:workspaceId/users/{userId}?scope={{scope}}')
    expect(detectPathParamKeys(renamed)).toEqual(['workspaceId', 'userId'])
  })

  it('renders entered path values into the URL while leaving empty placeholders editable', () => {
    const template = 'https://api.test/tenants/{tenantId}/users/:userId?scope={{scope}}'

    expect(applyPathParams(template, { tenantId: 'acme', userId: '' }))
      .toBe('https://api.test/tenants/acme/users/:userId?scope={{scope}}')
  })

  it('treats {id:value} as an id path parameter with an inline value', () => {
    const template = 'https://api.test/tenants/{id:no}'

    expect(detectPathParamKeys(template)).toEqual(['id'])
    expect(pathParamDefaultValues(template)).toEqual({ id: 'no' })
    expect(applyPathParams(template, {})).toBe('https://api.test/tenants/no')
    expect(applyPathParams(template, { id: '42' })).toBe('https://api.test/tenants/42')
  })
})
