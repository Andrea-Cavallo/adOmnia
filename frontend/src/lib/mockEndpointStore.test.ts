import { describe, expect, it } from 'vitest'
import { generatedMockEndpointsToStored } from './mockEndpointStore'

describe('generated mock endpoint storage boundary', () => {
  it('normalizes valid provider output into Mock Server endpoints', () => {
    const endpoints = generatedMockEndpointsToStored([{
      path: 'todos',
      method: 'post',
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: '{"id":1}',
      delayMs: 50,
    }])

    expect(endpoints).toHaveLength(1)
    expect(endpoints[0]).toMatchObject({ path: '/todos', method: 'POST', enabled: true, mode: 'first_active' })
    expect(endpoints[0].responses[0]).toMatchObject({ status: 201, body: '{"id":1}', delayMs: 50, isActive: true })
  })

  it('drops unsafe shapes and clamps provider-controlled values', () => {
    const endpoints = generatedMockEndpointsToStored([
      { path: '/bad', method: 'EXEC', statusCode: 200 },
      { path: '/slow', method: 'GET', statusCode: 999, delayMs: 999_999 },
    ])

    expect(endpoints).toHaveLength(1)
    expect(endpoints[0].responses[0]).toMatchObject({ status: 200, delayMs: 60_000 })
  })
})
