import { describe, expect, it, vi } from 'vitest'
import { createDoubleShiftDetector, matchScore, rankCandidates, recencyBoost } from './goStudioSearchRanking'

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

  it('scores fuzzy matches by contiguity and word starts', () => {
    // "nt" è contiguo in "linter"; "ut" salta fino alla fine: deve perdere.
    expect(matchScore('nt', 'Run Linter')!).toBeGreaterThan(matchScore('ut', 'Run Linter')!)
    // Inizi di parola battono gli stessi caratteri in mezzo alle parole: "rl" (Run, Linter) su "ul".
    expect(matchScore('rl', 'Run Linter')!).toBeGreaterThan(matchScore('ul', 'Run Linter')!)
  })
})

describe('rankCandidates', () => {
  it('orders by score, keeps input order on ties and honours the limit', () => {
    const items = ['Build All', 'Run', 'Rebuild', 'Build Current Package'].map((text) => ({ item: text, text }))
    expect(rankCandidates('build', items, 3)).toEqual(['Build All', 'Build Current Package', 'Rebuild'])
    expect(rankCandidates('', items, 2)).toEqual(['Build All', 'Run'])
  })

  it('lets the recency boost reorder matches without rescuing non-matches', () => {
    const items = [
      { item: 'Build All', text: 'Build All', boost: 0 },
      { item: 'Build Current Package', text: 'Build Current Package', boost: recencyBoost(['Build Current Package', 'Build All'], 'Build Current Package') },
      { item: 'Format', text: 'Format Code', boost: 50 },
    ]
    expect(rankCandidates('build', items, 2)).toEqual(['Build Current Package', 'Build All'])
    // Il boost non fa apparire comandi che non corrispondono alla ricerca.
    expect(rankCandidates('zzz', items, 5)).toEqual([])
    expect(recencyBoost(['a', 'b', 'c'], 'b')).toBeGreaterThan(recencyBoost(['a', 'b', 'c'], 'c'))
    expect(recencyBoost(['a'], 'z')).toBe(0)
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
