import { describe, expect, it } from 'vitest'
import { traceIdFor, traceparentFor } from './traceparent'

describe('traceparent', () => {
  it('derives a valid W3C header from the correlation id', () => {
    expect(traceIdFor('adm-bd07ddbfce35')).toMatch(/^[0-9a-f]{32}$/)
    expect(traceIdFor('adm-bd07ddbfce35').endsWith('adbd07ddbfce35')).toBe(true)
    expect(traceparentFor('adm-bd07ddbfce35')).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
    expect(traceIdFor('')).toBe(`a${'0'.repeat(31)}`)
  })
})
