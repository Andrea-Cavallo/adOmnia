import { describe, expect, it } from 'vitest'
import { validateMockEndpoints } from '@/lib/mockContract'
import { blankRequest, type Collection } from '@/lib/types'

const spec = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Users', version: '1' },
  paths: {
    '/users/{id}': {
      get: {
        responses: {
          200: {
            description: 'ok',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['id'],
                  properties: { id: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
  },
})

function collection(): Collection {
  return {
    id: 'users', name: 'Users', _openapiSpec: spec,
    children: [{ ...blankRequest('GET', 'Get user'), id: 'get-user', _openapiPath: '/users/{id}' }],
  }
}

describe('mock contract validation', () => {
  it('validates an imported mock response against the linked OpenAPI operation', () => {
    const checks = validateMockEndpoints([{
      id: 'mock-user', path: '/users/:id', method: 'GET', sourceRequestId: 'get-user',
      responses: [{ id: 'ok', name: 'User', status: 200, headers: { 'Content-Type': 'application/json' }, body: '{"id":"u_1"}', isActive: true }],
    }], collection())

    expect(checks).toHaveLength(1)
    expect(checks[0].result).toMatchObject({ valid: true, hasSpec: true })
  })

  it('reports a schema mismatch before the mock server is started', () => {
    const checks = validateMockEndpoints([{
      id: 'mock-user', path: '/users/:id', method: 'GET', sourceRequestId: 'get-user',
      responses: [{ id: 'bad', name: 'Broken user', status: 200, headers: { 'Content-Type': 'application/json' }, body: '{}', isActive: true }],
    }], collection())

    expect(checks[0].result.valid).toBe(false)
    expect(checks[0].result.errors.map((error) => error.category)).toEqual(expect.arrayContaining(['body']))
  })

  it('does not validate endpoints imported from a different collection against the selected spec', () => {
    const checks = validateMockEndpoints([{
      id: 'other-api', path: '/users/:id', method: 'GET', sourceCollectionId: 'other-collection', sourceRequestId: 'get-user',
      responses: [{ id: 'ok', name: 'User', status: 200, headers: { 'Content-Type': 'application/json' }, body: '{"id":"u_1"}', isActive: true }],
    }], collection())

    expect(checks).toEqual([])
  })
})
