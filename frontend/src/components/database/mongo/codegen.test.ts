import { describe, expect, it } from 'vitest'
import { generateCode, literal } from './codegen'
import { buildPipeline } from './AggregationsTab'
import { summarizeExplain } from './explain'

const filter = { _id: { $oid: '65a1b2c3d4e5f60718293a4b' }, at: { $gte: { $date: '2024-01-01T00:00:00.000Z' } }, active: true }

describe('codegen', () => {
  it('renders BSON types per language', () => {
    expect(literal(filter, 'shell')).toContain("ObjectId(\"65a1b2c3d4e5f60718293a4b\")")
    expect(literal(filter, 'python')).toContain('datetime.fromisoformat("2024-01-01T00:00:00.000+00:00")')
    expect(literal(filter, 'python')).toContain('True')
    expect(literal({ n: { $numberLong: '5' } }, 'java')).toBe('new Document("n", 5L)')
    expect(literal({ a: 1 }, 'go')).toBe('bson.D{\n  {Key: "a", Value: 1},\n}')
  })

  it('builds find and aggregate snippets', () => {
    const find = generateCode({ kind: 'find', db: 'shop', collection: 'users', filter, sort: { age: -1 }, limit: 20 }, 'node')
    expect(find).toContain('.collection("users")')
    expect(find).toContain('sort: {')
    expect(find).toContain('limit: 20')
    const agg = generateCode({ kind: 'aggregate', db: 'shop', collection: 'users', pipeline: [{ $match: {} }] }, 'go')
    expect(agg).toContain('mongo.Pipeline{')
  })
})

describe('aggregation stages', () => {
  it('parses scalar and document stage bodies', () => {
    const stages = [
      { id: '1', operator: '$match', body: "{ name: 'Ada' }", enabled: true },
      { id: '2', operator: '$unwind', body: '"$tags"', enabled: true },
      { id: '3', operator: '$limit', body: '5', enabled: true },
      { id: '4', operator: '$skip', body: '1', enabled: false },
    ]
    expect(buildPipeline(stages)).toEqual([{ $match: { name: 'Ada' } }, { $unwind: '$tags' }, { $limit: 5 }])
  })
})

describe('explain summary', () => {
  it('detects collection scans and index usage', () => {
    const summary = summarizeExplain({
      queryPlanner: { winningPlan: { queryPlan: { stage: 'SORT', inputStage: { stage: 'FETCH', inputStage: { stage: 'IXSCAN', indexName: 'age_1' } } } } },
      executionStats: { nReturned: { $numberInt: '3' }, totalDocsExamined: { $numberInt: '3' }, executionTimeMillis: { $numberInt: '1' } },
    })
    expect(summary.indexesUsed).toEqual(['age_1'])
    expect(summary.collectionScan).toBe(false)
    expect(summary.inMemorySort).toBe(true)
    expect(summary.nReturned).toBe(3)
  })
})
