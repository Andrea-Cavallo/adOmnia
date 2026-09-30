import { describe, expect, it } from 'vitest'
import { contractOperations, documented } from './contractDrift'

const spec = `
openapi: 3.0.3
info: { title: users, version: '1' }
paths:
  /users/{userId}:
    get: { responses: { '200': { description: ok } } }
    put: { responses: { '200': { description: ok } } }
    parameters: []
  /health:
    get: { responses: { '200': { description: ok } } }
`

describe('contract drift', () => {
  it('reads documented operations regardless of param names', () => {
    const operations = contractOperations(spec)
    expect(documented(operations, 'PUT', '/users/{id}')).toBe(true)
    expect(documented(operations, 'DELETE', '/users/{id}')).toBe(false)
    expect(documented(operations, 'ANY', '/health')).toBe(true)
    expect(documented(operations, 'GET', '/orders')).toBe(false)
  })

  it('tolerates broken documents', () => {
    expect(contractOperations('paths: [').size).toBe(0)
    expect(contractOperations('{"swagger":"2.0","paths":{"/x":{"post":{}}}}').has('POST /x')).toBe(true)
  })
})
