import { describe, expect, it } from 'vitest'
import { parseLogText } from './parse'
import { buildCallWaterfall } from './waterfall'

describe('log call waterfall', () => {
  it('groups events by span and keeps parent relationships explicit', () => {
    const events = parseLogText([
      JSON.stringify({ timestamp: '2026-09-10T08:00:00.000Z', service: 'gateway', traceId: 't1', spanId: 'root', message: 'start', duration_ms: 40 }),
      JSON.stringify({ timestamp: '2026-09-10T08:00:00.010Z', service: 'wallet', traceId: 't1', spanId: 'child', parentSpanId: 'root', message: 'call', duration_ms: 20 }),
      JSON.stringify({ timestamp: '2026-09-10T08:00:00.030Z', service: 'wallet', traceId: 't1', spanId: 'child', message: 'done' }),
    ].join('\n')).events
    const spans = buildCallWaterfall(events)
    expect(spans).toHaveLength(2)
    expect(spans.find((span) => span.id === 'child')).toMatchObject({ parentId: 'root', durationMs: 20, eventIds: [1, 2], inferred: false })
  })

  it('marks a spanless event as inferred instead of inventing causality', () => {
    const event = parseLogText(JSON.stringify({ timestamp: '2026-09-10T08:00:00Z', service: 'api', message: 'request' })).events[0]
    expect(buildCallWaterfall([event])[0]).toMatchObject({ inferred: true, parentId: '' })
  })
})
