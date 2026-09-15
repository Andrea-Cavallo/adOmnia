import { describe, expect, it } from 'vitest'
import { buildAiLogContext } from './aiAssistant'
import { parseLogText } from './parse'

describe('optional AI log context', () => {
  it('redacts nested and raw secrets while preserving evidence references', () => {
    const secret = 'secret-value-12345'
    const event = parseLogText(JSON.stringify({ timestamp: '2026-09-15T10:00:00Z', message: `Bearer ${secret}`, token: secret, correlation_id: 'c1' })).events[0]
    event.sourceName = 'gateway.log'
    event.line = 42
    const context = buildAiLogContext([event], null)
    expect(context.user).not.toContain(secret)
    expect(context.user).toContain('[redacted]')
    expect(context.user).toContain('gateway.log:42')
  })
})
