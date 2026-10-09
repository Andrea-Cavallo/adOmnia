import { describe, expect, it } from 'vitest'
import { raceReports } from './raceRequest'

describe('race reports', () => {
  it('counts DATA RACE warnings printed after the request', () => {
    const lines = [
      { at: '2026-10-09T10:00:00Z', text: 'WARNING: DATA RACE' },
      { at: '2026-10-09T10:00:05Z', text: '==================' },
      { at: '2026-10-09T10:00:05Z', text: 'WARNING: DATA RACE' },
      { at: '2026-10-09T10:00:06Z', text: 'Write at 0x00c000 by goroutine 7:' },
    ]
    expect(raceReports(lines, '2026-10-09T10:00:01Z')).toBe(1)
  })
})
