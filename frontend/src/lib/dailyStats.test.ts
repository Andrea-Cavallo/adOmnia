import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readDailyStats, recordDailyRequest } from './dailyStats'

describe('dailyStats', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })
    vi.stubGlobal('window', { dispatchEvent: () => true })
  })

  it('counts requests and errors for the day and resets the next day', () => {
    const day1 = new Date(2026, 9, 8, 10)
    recordDailyRequest(false, day1)
    recordDailyRequest(true, day1)
    expect(readDailyStats(day1)).toMatchObject({ requests: 2, errors: 1 })
    expect(readDailyStats(new Date(2026, 9, 9, 0, 1))).toMatchObject({ requests: 0, errors: 0 })
  })
})
