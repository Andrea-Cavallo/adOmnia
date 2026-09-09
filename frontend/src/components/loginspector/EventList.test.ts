import { describe, expect, it } from 'vitest'
import { parseLogText } from '@/lib/loginspector'
import { availableListColumns } from './EventList'

describe('log list columns', () => {
  it('omits configured columns that contain no values in the loaded logs', () => {
    const events = parseLogText('{"timestamp":"2026-09-09T10:00:00Z","level":"INFO","service":"api","message":"ok"}').events
    expect(availableListColumns(events, ['time', 'level', 'service', 'pod', 'logger', 'thread', 'correlation'])).toEqual([
      'time', 'level', 'service',
    ])
  })

  it('shows source and correlation columns when multiple files provide them', () => {
    const events = parseLogText('{"correlation_id":"shared","message":"ok"}').events.map((event) => ({ ...event, sourceName: 'api.log' }))
    expect(availableListColumns(events, ['source', 'pod', 'correlation'])).toEqual(['source', 'correlation'])
  })
})
