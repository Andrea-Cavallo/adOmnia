import { describe, expect, it } from 'vitest'
import { parseLogSourcesInBackground } from './multiSource'
import { eventContext } from './context'
import { fromText } from './sources'

describe('event context', () => {
  it('returns source lines and cross-service time neighbors from the unfiltered session', async () => {
    const parsed = await parseLogSourcesInBackground([
      { ...fromText([
        JSON.stringify({ timestamp: '2026-09-10T08:00:00Z', service: 'api', message: 'before' }),
        JSON.stringify({ timestamp: '2026-09-10T08:00:01Z', service: 'api', message: 'target' }),
        JSON.stringify({ timestamp: '2026-09-10T08:00:02Z', service: 'api', message: 'after' }),
      ].join('\n'), 'api.log', 'file'), sourceId: 'api' },
      { ...fromText(JSON.stringify({ timestamp: '2026-09-10T08:00:01.500Z', service: 'db', message: 'nearby' }), 'db.log', 'file'), sourceId: 'db' },
    ])
    const context = eventContext(parsed.events, parsed.events[1], 1, 1000)
    expect(context.source.map((event) => event.message)).toEqual(['before', 'after'])
    expect(context.temporal.map((event) => event.message)).toEqual(['nearby'])
  })
})
