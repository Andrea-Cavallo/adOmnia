import { describe, expect, it } from 'vitest'
import { csvCell, restoreLoadScenario, type LoadScenario } from './loadTestScenario'

const current: LoadScenario = { mode: 'rate', concurrency: 10, totalReqs: 100, durationS: 30, useDuration: false, warmupReqs: 5, rampUpS: 0, thinkTimeMs: 0, burst: 5, gapRequests: 2, gapMs: 200, rps: 50, maxVUs: 100, timeoutMs: 5000 }

describe('scenario restoration', () => {
  it('restores the actual executor and every setting', () => {
    const saved = { ...current, mode: 'gap' as const, gapRequests: 8, gapMs: 450 }
    expect(restoreLoadScenario(saved, current)).toEqual(saved)
    expect(restoreLoadScenario({ ...current, rps: 123, maxVUs: 350 }, current)).toMatchObject({ mode: 'rate', rps: 123, maxVUs: 350 })
  })
  it('loads older scenarios with duration semantics and preserves missing fields', () => {
    expect(restoreLoadScenario({ totalReqs: 0, durationS: 45 }, current)).toMatchObject({ mode: 'load', useDuration: true, durationS: 45, timeoutMs: 5000 })
  })
  it('rejects invalid numeric settings', () => {
    expect(restoreLoadScenario({ concurrency: -1, timeoutMs: 'oops', rps: Infinity }, current)).toMatchObject({ concurrency: 10, timeoutMs: 5000, rps: 50 })
  })
})

it('escapes CSV URLs, quotation marks and multiline errors', () => {
  expect(csvCell('https://test/?ids=1,2')).toBe('"https://test/?ids=1,2"')
  expect(csvCell('bad "response"\nretry')).toBe('"bad ""response""\nretry"')
  expect(csvCell(123)).toBe('123')
})
