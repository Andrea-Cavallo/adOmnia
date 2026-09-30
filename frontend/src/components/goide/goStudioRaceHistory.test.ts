import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearRaceHistory, loadRaceHistory, raceHistoryKey, saveRaceHistory } from './goStudioRaceHistory'

const values = new Map<string, string>()
const project = 'C:/work/acme-api'
const race = 'WARNING: DATA RACE\nWrite at 0x01 by goroutine 7:'

beforeEach(() => {
  values.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
})

describe('Go Studio race history', () => {
  it('keeps race sessions local to their project and refreshes a live source', () => {
    saveRaceHistory(project, [{ id: 'run-1', label: 'test run-1', text: race, at: 10 }])
    saveRaceHistory(project, [{ id: 'run-1', label: 'test run-1', text: `${race}\nmore output`, at: 20 }])

    expect(loadRaceHistory(project)).toMatchObject([{ id: 'run-1', at: 20, text: expect.stringContaining('more output') }])
    expect(loadRaceHistory('C:/work/other')).toEqual([])
  })

  it('does not save ordinary console output and caps the retained sessions', () => {
    expect(saveRaceHistory(project, [{ id: 'clean', label: 'run', text: 'ok', at: 1 }])).toEqual([])
    saveRaceHistory(project, Array.from({ length: 24 }, (_, index) => ({ id: `run-${index}`, label: `run ${index}`, text: race, at: index })))

    const saved = loadRaceHistory(project)
    expect(saved).toHaveLength(20)
    expect(saved[0].id).toBe('run-23')
    expect(saved[saved.length - 1]?.id).toBe('run-4')
  })

  it('ignores malformed history and clears only this project key', () => {
    values.set(raceHistoryKey(project), '{invalid')
    expect(loadRaceHistory(project)).toEqual([])
    saveRaceHistory(project, [{ id: 'run-1', label: 'run', text: race, at: 1 }])
    clearRaceHistory(project)
    expect(values.has(raceHistoryKey(project))).toBe(false)
  })
})
