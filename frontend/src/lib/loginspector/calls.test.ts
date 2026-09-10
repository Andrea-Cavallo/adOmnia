import { describe, expect, it } from 'vitest'
import { parseLogText } from './parse'
import { pairCallPayloads } from './calls'

describe('request/response call pairing', () => {
  it('pairs payloads by span even when they live on separate rows', () => {
    const events = parseLogText([
      JSON.stringify({ timestamp: '2026-09-10T08:00:00Z', spanId: 'wallet-1', request: { body: { amount: 12 } }, http: { method: 'POST', route: '/wallet' } }),
      JSON.stringify({ timestamp: '2026-09-10T08:00:01Z', spanId: 'wallet-1', response: { body: { accepted: true } }, http: { status_code: 201 } }),
    ].join('\n')).events
    expect(pairCallPayloads(events)[0]).toMatchObject({
      key: 'span:wallet-1', requestBody: { amount: 12 }, responseBody: { accepted: true }, status: 201, inferred: false,
    })
  })

  it('does not exchange payloads between parallel spans', () => {
    const events = parseLogText([
      JSON.stringify({ timestamp: '2026-09-10T08:00:00Z', spanId: 'a', request_body: { call: 'a' } }),
      JSON.stringify({ timestamp: '2026-09-10T08:00:00Z', spanId: 'b', request_body: { call: 'b' } }),
      JSON.stringify({ timestamp: '2026-09-10T08:00:01Z', spanId: 'b', response_body: { result: 'b' } }),
      JSON.stringify({ timestamp: '2026-09-10T08:00:02Z', spanId: 'a', response_body: { result: 'a' } }),
    ].join('\n')).events
    const pairs = pairCallPayloads(events)
    expect(pairs.find((pair) => pair.key === 'span:a')?.responseBody).toEqual({ result: 'a' })
    expect(pairs.find((pair) => pair.key === 'span:b')?.responseBody).toEqual({ result: 'b' })
  })
})
