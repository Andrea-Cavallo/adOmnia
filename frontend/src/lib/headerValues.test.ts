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

describe('recorded dynamic headers', () => {
  it('turns generated header values into tokens a flow regenerates', async () => {
    const { recordedHeaderToken } = await import('./headerValues')
    expect(recordedHeaderToken('Request-Id', uuid7())).toBe('{{$uuid7}}')
    expect(recordedHeaderToken('X-Correlation-ID', '1b4e28ba-2fa1-11d2-883f-0016d3cca427')).toBe('{{$uuid7}}')
    expect(recordedHeaderToken('X-Timestamp', '1761580800')).toBe('{{$timestamp}}')
    expect(recordedHeaderToken('X-Timestamp', '1761580800000')).toBe('{{$timestampMs}}')
    expect(recordedHeaderToken('Timestamp', '2026-10-27T10:00:00.000Z')).toBe('{{$isoTimestamp}}')
    expect(recordedHeaderToken('Date', new Date().toUTCString())).toBe('{{$httpDate}}')
    expect(recordedHeaderToken('Request-Id', '{{request_id}}')).toBeNull()
    expect(recordedHeaderToken('Accept', '1b4e28ba-2fa1-11d2-883f-0016d3cca427')).toBeNull()
  })

  it('substitutes a fresh value on every send, environment variables first', async () => {
    const { substVars } = await import('./substVars')
    const a = substVars('{{$uuid7}}', {})
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/)
    expect(substVars('{{$uuid7}}', {})).not.toBe(a)
    expect(substVars('{{$uuid7}}', { $uuid7: 'pinned' })).toBe('pinned')
    expect(substVars('{{$unknown}}', {})).toBe('{{$unknown}}')
  })

  it('records the Request-Id header as a dynamic token', async () => {
    const { sanitizeRecordedRequest } = await import('@/stores/flowRecorder')
    const recorded = sanitizeRecordedRequest({
      id: 'r', name: 'r', method: 'GET', url: 'https://x', params: [], bodies: [], auth: { type: 'none' },
      headers: [{ id: 'h', key: 'Request-Id', value: uuid7(), enabled: true }],
    } as never)
    expect(recorded.headers[0].value).toBe('{{$uuid7}}')
  })
})
