import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SPLIT_PREFERENCES,
  MAX_SPLIT_RATIO,
  MIN_SPLIT_RATIO,
  SPLIT_PREFERENCES_KEY,
  clampSplitRatio,
  loadSplitPreferences,
  normalizeSplitSide,
  saveSplitPreferences,
} from './splitView'

function fakeStorage(initial: Record<string, string> = {}) {
  const values = { ...initial }
  return {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => { values[key] = value },
    values,
  }
}

describe('split view preferences', () => {
  it('defaults to code on the left at a comfortable ratio', () => {
    expect(loadSplitPreferences(fakeStorage())).toEqual(DEFAULT_SPLIT_PREFERENCES)
  })

  it('round-trips the side and the ratio', () => {
    const storage = fakeStorage()
    saveSplitPreferences({ side: 'code-right', ratio: 0.4 }, storage)
    expect(loadSplitPreferences(storage)).toEqual({ side: 'code-right', ratio: 0.4 })
    expect(storage.values[SPLIT_PREFERENCES_KEY]).toBeTruthy()
  })

  it('clamps the ratio and ignores an unknown side', () => {
    expect(clampSplitRatio(0.1)).toBe(MIN_SPLIT_RATIO)
    expect(clampSplitRatio(0.99)).toBe(MAX_SPLIT_RATIO)
    expect(clampSplitRatio(Number.NaN)).toBe(DEFAULT_SPLIT_PREFERENCES.ratio)
    expect(normalizeSplitSide('diagonal')).toBe('code-left')
    const storage = fakeStorage({ [SPLIT_PREFERENCES_KEY]: JSON.stringify({ side: 'diagonal', ratio: 9 }) })
    expect(loadSplitPreferences(storage)).toEqual({ side: 'code-left', ratio: MAX_SPLIT_RATIO })
  })

  it('survives a corrupt entry without throwing', () => {
    expect(loadSplitPreferences(fakeStorage({ [SPLIT_PREFERENCES_KEY]: '{not json' }))).toEqual(DEFAULT_SPLIT_PREFERENCES)
  })
})
