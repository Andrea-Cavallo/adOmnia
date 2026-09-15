import { describe, expect, it } from 'vitest'
import { assessChainIntegrity } from './integrity'
import { parseLogSourcesInBackground } from './multiSource'
import { fromText } from './sources'

describe('chain integrity and clock skew', () => {
  it('preserves original time, applies only explicit offsets and reports incomplete evidence', async () => {
    const source = {
      ...fromText([
        JSON.stringify({ timestamp: '2026-09-15T10:00:02Z', correlation_id: 'c1', service: 'gateway', message: 'middle' }),
        JSON.stringify({ timestamp: '2026-09-15T10:00:01Z', correlation_id: 'c1', service: 'gateway', message: 'payload truncated' }),
      ].join('\n'), 'gateway.jsonl', 'file'),
      sourceId: 'gateway', clockOffsetMs: 500,
    }
    const events = (await parseLogSourcesInBackground([source])).events
    const issues = assessChainIntegrity(events, 'correlationId')
    expect(events[0].ts).toBe(events[0].tsOriginal! + 500)
    expect(issues.map((issue) => issue.kind)).toEqual(expect.arrayContaining(['missing-start', 'missing-end', 'clock-skew', 'corrected-time', 'truncated-log']))
  })

  it('marks cross-service chains without span coverage as uncertain', () => {
    const event = (service: string, id: number) => ({
      id, line: id + 1, lineCount: 1, level: 'info' as const, levelRaw: 'INFO', ts: id, tsRaw: String(id),
      message: id ? 'request completed' : 'request started', service, namespace: '', pod: '', container: '', traceId: '',
      correlationId: 'shared', requestId: '', thread: '', logger: '', stack: '', json: null, prefix: '', extra: {}, decoded: {}, raw: '', parseError: '',
    })
    expect(assessChainIntegrity([event('gateway', 0), event('orders', 1)], 'correlationId').some((issue) => issue.kind === 'uncertain-correlation')).toBe(true)
  })
})
