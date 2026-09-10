import { describe, expect, it } from 'vitest'
import { contractSourcesFromCollections, validateLogPayload, type ContractSource } from './payloadContract'

const SPEC = JSON.stringify({
  openapi: '3.0.0',
  paths: {
    '/orders/{orderId}': {
      post: {
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['customerId', 'amount'],
                properties: { customerId: { type: 'string' }, amount: { type: 'number' } },
              },
            },
          },
        },
        responses: {
          '201': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } } },
        },
      },
    },
  },
  components: { schemas: { Order: { type: 'object', required: ['orderId'], properties: { orderId: { type: 'string' } } } } },
})

const sources: ContractSource[] = [{ id: 'c1', name: 'Orders API', spec: SPEC }]

describe('validateLogPayload', () => {
  it('reports a missing required field with its JSONPath and the contract rule', () => {
    const result = validateLogPayload(sources, {
      method: 'POST', route: '/orders/8f21', status: 201, direction: 'request',
      payload: { amount: 10 },
    })
    expect(result.matched).toBe(true)
    expect(result.openApiPath).toBe('/orders/{orderId}')
    expect(result.required).toEqual(['customerId', 'amount'])
    expect(result.violations[0]).toMatchObject({ path: '$.customerId', keyword: 'required' })
    expect(result.violations[0].expected).toContain('required')
  })

  it('reports a type mismatch on the nested JSONPath', () => {
    const result = validateLogPayload(sources, {
      method: 'POST', route: '/orders/8f21', status: 201, direction: 'request',
      payload: { customerId: 'c1', amount: 'ten' },
    })
    expect(result.violations.map((violation) => violation.path)).toEqual(['$.amount'])
    expect(result.violations[0].expected).toContain('number')
  })

  it('validates the response against the $ref schema of its status', () => {
    const ok = validateLogPayload(sources, {
      method: 'POST', route: '/orders/8f21', status: 201, direction: 'response', payload: { orderId: 'o1' },
    })
    expect(ok.violations).toEqual([])
    const bad = validateLogPayload(sources, {
      method: 'POST', route: '/orders/8f21', status: 201, direction: 'response', payload: {},
    })
    expect(bad.violations[0].path).toBe('$.orderId')
  })

  it('explains why no contract applies instead of failing silently', () => {
    expect(validateLogPayload([], { method: 'GET', route: '/x', status: 200, direction: 'request', payload: {} }).reason)
      .toContain('No collection')
    expect(validateLogPayload(sources, { method: 'GET', route: '/unknown', status: 200, direction: 'request', payload: {} }).reason)
      .toContain('No OpenAPI operation matches')
  })
})

describe('contractSourcesFromCollections', () => {
  it('keeps only collections carrying a spec', () => {
    const sourcesFound = contractSourcesFromCollections([
      { id: 'a', name: 'With spec', _openapiSpec: SPEC },
      { id: 'b', name: 'Without' },
    ])
    expect(sourcesFound.map((source) => source.id)).toEqual(['a'])
  })
})
