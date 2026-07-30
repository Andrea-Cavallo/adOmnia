import { describe, expect, it } from 'vitest'
import { detectPathParamKeys, renamePathParamKey } from '@/lib/pathParams'

describe('path parameter helpers', () => {
  it('renames matching placeholders without changing their syntax or environment variables', () => {
    const url = 'https://api.test/teams/:teamId/users/{userId}?scope={{scope}}'

    const renamed = renamePathParamKey(url, 'teamId', 'workspaceId')

    expect(renamed).toBe('https://api.test/teams/:workspaceId/users/{userId}?scope={{scope}}')
    expect(detectPathParamKeys(renamed)).toEqual(['workspaceId', 'userId'])
  })
})
