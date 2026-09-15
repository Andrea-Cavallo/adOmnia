import { describe, expect, it } from 'vitest'
import { parseLogText } from '@/lib/loginspector'
import { availableListColumns, layoutColumns } from './EventList'

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

  it('moves pinned columns first with cumulative sticky offsets', () => {
    const { columns, minRowWidth } = layoutColumns(['time', 'level', 'field:http.status_code'], ['field:http.status_code', 'time'], { 'field:http.status_code': 100 })
    expect(columns.map((column) => [column.id, column.stickyLeft])).toEqual([
      ['time', 0],
      ['field:http.status_code', 104],
      ['level', undefined],
    ])
    expect(minRowWidth).toBe(96 + 100 + 52 + 3 * 8 + 320)
  })
})
