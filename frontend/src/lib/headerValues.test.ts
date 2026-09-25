import { describe, expect, it } from 'vitest'
import { generateHeaderValue, headerValueKind, uuid7 } from './headerValues'

describe('header value generation', () => {
  it.each(['Request-Id', ' X-Request-ID ', 'Correlation-ID', 'x_correlation_id', 'Idempotency-Key', 'Idempotence-Key'])('recognizes %s', name => {
    expect(headerValueKind(name)).toBe('uuid7')
  })
  it('does not invent identity, auth or tracing values', () => {
    for (const name of ['Authorization', 'Consent-ID', 'Client-ID', 'traceparent', 'X-B3-TraceId', '']) expect(headerValueKind(name)).toBeNull()
  })
  it('encodes the timestamp, UUID version and RFC variant with random uniqueness', () => {
    const now = 1780000000123
    const values = Array.from({ length: 100 }, () => uuid7(now))
    expect(new Set(values).size).toBe(100)
    for (const value of values) {
      expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      expect(parseInt(value.replace(/-/g, '').slice(0, 12), 16)).toBe(now)
    }
  })
  it('uses explicit timestamp units and a proper HTTP Date', () => {
    const now = Date.UTC(2026, 8, 25, 12, 0, 0, 123)
    expect(headerValueKind('X-Timestamp')).toBe('timestamp')
    expect(headerValueKind('X-Webhook-Timestamp')).toBe('timestamp')
    expect(generateHeaderValue('timestamp', 'seconds', now)).toBe(String(Math.floor(now / 1000)))
    expect(generateHeaderValue('timestamp', 'milliseconds', now)).toBe(String(now))
    expect(generateHeaderValue('timestamp', 'iso', now)).toBe('2026-09-25T12:00:00.123Z')
    expect(generateHeaderValue('http-date', 'seconds', now)).toBe('Fri, 25 Sep 2026 12:00:00 GMT')
  })
})
