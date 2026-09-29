import { describe, expect, it, vi } from 'vitest'
import { createDoubleShiftDetector, matchScore, rankCandidates } from './goStudioSearchRanking'

describe('matchScore', () => {
  it('prefers prefix, then word start, then substring, then subsequence', () => {
    const prefix = matchScore('run', 'Run Linter')!
    const word = matchScore('lint', 'Run Linter')!
    const inner = matchScore('inte', 'Run Linter')!
    const subsequence = matchScore('rlt', 'Run Linter')!
    expect(prefix).toBeGreaterThan(word)
    expect(word).toBeGreaterThan(inner)
    expect(inner).toBeGreaterThan(subsequence)
    expect(matchScore('xyz', 'Run Linter')).toBeNull()
  })
})

describe('rankCandidates', () => {
  it('orders by score, keeps input order on ties and honours the limit', () => {
    const items = ['Build All', 'Run', 'Rebuild', 'Build Current Package'].map((text) => ({ item: text, text }))
    expect(rankCandidates('build', items, 3)).toEqual(['Build All', 'Build Current Package', 'Rebuild'])
    expect(rankCandidates('', items, 2)).toEqual(['Build All', 'Run'])
  })
})

describe('createDoubleShiftDetector', () => {
  const key = (value: string, extra: Partial<KeyboardEvent> = {}) => ({ key: value, repeat: false, ctrlKey: false, metaKey: false, altKey: false, ...extra })

  it('fires on two quick Shift presses only', () => {
    let time = 0
    const onTrigger = vi.fn()
    const detect = createDoubleShiftDetector(onTrigger, () => time)
    detect(key('Shift')); time = 200; detect(key('Shift'))
    expect(onTrigger).toHaveBeenCalledOnce()
    time = 1000; detect(key('Shift')); time = 1500; detect(key('Shift'))
    expect(onTrigger).toHaveBeenCalledOnce()
  })

  it('ignores Shift used as a modifier while typing', () => {
    let time = 0
    const onTrigger = vi.fn()
    const detect = createDoubleShiftDetector(onTrigger, () => time)
    detect(key('Shift')); time = 50; detect(key('A')); time = 100; detect(key('Shift'))
    detect(key('Shift', { repeat: true }))
    expect(onTrigger).not.toHaveBeenCalled()
  })
})
