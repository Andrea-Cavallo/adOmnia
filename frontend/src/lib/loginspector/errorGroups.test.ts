import { describe, expect, it } from 'vitest'
import { analyzeLog, errorFingerprint } from './analyze'
import { parseLogText } from './parse'

describe('observed error grouping', () => {
  it('normalizes variable identifiers while retaining original event ids', () => {
    const events = parseLogText([
      JSON.stringify({ timestamp: '2026-09-10T08:00:00Z', level: 'ERROR', service: 'api', message: 'order 123 failed for "alice"' }),
      JSON.stringify({ timestamp: '2026-09-10T08:01:00Z', level: 'ERROR', service: 'worker', message: 'order 456 failed for "bob"' }),
    ].join('\n')).events
    const groups = analyzeLog(events).errorGroups
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ count: 2, eventIds: [0, 1], services: ['api', 'worker'] })
    expect(errorFingerprint('Error 12')).toBe('error <n>')
  })
})
