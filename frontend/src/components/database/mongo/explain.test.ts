import { describe, expect, it } from 'vitest'
import { summarizeExplain } from './explain'

describe('summarizeExplain', () => {
  it('uses executionStages for per-stage stats and flags COLLSCAN', () => {
    const s = summarizeExplain({
      queryPlanner: { winningPlan: { stage: 'COLLSCAN' } },
      executionStats: {
        nReturned: 2, totalDocsExamined: 100,
        executionStages: { stage: 'FETCH', nReturned: 2, docsExamined: 2, inputStage: { stage: 'IXSCAN', indexName: 'a_1', nReturned: 2, keysExamined: 3 } },
      },
    })
    expect(s.plan?.stage).toBe('FETCH')
    expect(s.plan?.children[0]).toMatchObject({ stage: 'IXSCAN', keysExamined: 3 })
    expect(s.indexesUsed).toEqual(['a_1'])
    expect(s.collectionScan).toBe(false)
  })

  it('falls back to the winning plan for SBE execution trees', () => {
    const s = summarizeExplain({ queryPlanner: { winningPlan: { queryPlan: { stage: 'COLLSCAN' } } }, executionStats: { executionStages: { stage: 'filter' } } })
    expect(s.plan?.stage).toBe('COLLSCAN')
    expect(s.collectionScan).toBe(true)
  })
})
