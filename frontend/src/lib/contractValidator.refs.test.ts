import { describe, expect, it } from 'vitest'
import { validateContract } from '@/lib/contractValidator'
import type { ResponseData } from '@/lib/types'

const spec = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Users', version: '1' },
  components: {
    schemas: {
      User: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
  },
  paths: {
    '/users/{id}': {
      get: {
        responses: {
          200: {
            description: 'ok',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
          },
        },
      },
    },
  },
})

function response(body: string): ResponseData {
  return {
    status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' },
    contentType: 'application/json', body, ms: 1, size: body.length,
  }
}

describe('OpenAPI contract references', () => {
  it('resolves a local component schema before validating a response', () => {
    expect(validateContract(spec, '/users/{id}', 'GET', response('{"id":"u_1"}'))).toMatchObject({ valid: true, hasSpec: true })
  })

  it('still reports schema violations from a referenced component', () => {
    const result = validateContract(spec, '/users/{id}', 'GET', response('{}'))
    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ category: 'body' })]))
  })
})
