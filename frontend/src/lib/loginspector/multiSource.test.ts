import { describe, expect, it } from 'vitest'
import { correlateEvents } from './correlate'
import { parseLogSourcesInBackground } from './multiSource'
import { fromText } from './sources'

describe('multi-file log import', () => {
  it('merges services while keeping globally unique event ids and source names', async () => {
    const correlationId = 'APPP+shared-correlation'
    const first = fromText([
      JSON.stringify({ timestamp: '2026-09-09T10:00:00Z', level: 'INFO', service: 'gateway', correlation_id: correlationId, message: 'start' }),
      JSON.stringify({ timestamp: '2026-09-09T10:00:01Z', level: 'INFO', service: 'gateway', correlation_id: correlationId, message: 'forward' }),
    ].join('\n'), 'gateway.log', 'file')
    const second = fromText(
      JSON.stringify({ timestamp: '2026-09-09T10:00:02Z', level: 'ERROR', service: 'wallet', correlation_id: correlationId, message: 'failed' }),
      'wallet.log',
      'file',
    )

    const parsed = await parseLogSourcesInBackground([first, second])
    expect(parsed.events.map((event) => event.id)).toEqual([0, 1, 2])
    expect(parsed.events.map((event) => event.sourceName)).toEqual(['gateway.log', 'gateway.log', 'wallet.log'])
    expect(parsed.summary.totalLines).toBe(3)
    expect(correlateEvents(parsed.events, 'correlationId', correlationId).events).toHaveLength(3)
  })

  it('distinguishes homonymous files and respects the event cap without spread overflow', async () => {
    const first = fromText(
      JSON.stringify({ timestamp: '2026-09-09T10:00:00Z', level: 'INFO', message: 'one', correlation_id: 'c1' }),
      'app.log',
      'file',
    )
    const second = fromText(
      JSON.stringify({ timestamp: '2026-09-09T10:00:01Z', level: 'INFO', message: 'two', correlation_id: 'c1' }),
      'app.log',
      'file',
    )

    const parsed = await parseLogSourcesInBackground([first, second], { maxEvents: 1 })
    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0]).toMatchObject({ sourceId: 'source-0', sourceName: 'app.log #1' })
    expect(parsed.summary.truncated).toBe(true)
  })
})
