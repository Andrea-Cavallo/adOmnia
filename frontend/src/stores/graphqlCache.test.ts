import { describe, expect, it } from 'vitest'
import { graphqlEntryBytes, pruneGraphqlCache, type GraphQLEndpointCache } from './graphqlCache'

function entry(updatedAt: string, schema: unknown): GraphQLEndpointCache {
  return { schema, updatedAt }
}

describe('pruneGraphqlCache', () => {
  it('keeps everything under both budgets', () => {
    const cache = {
      a: entry('2026-10-01T00:00:00.000Z', { type: 'object' }),
      b: entry('2026-10-02T00:00:00.000Z', { type: 'object' }),
    }
    expect(Object.keys(pruneGraphqlCache(cache, 40, 1024)).sort()).toEqual(['a', 'b'])
  })

  it('drops the oldest entries by count', () => {
    const cache = {
      old: entry('2026-10-01T00:00:00.000Z', {}),
      mid: entry('2026-10-02T00:00:00.000Z', {}),
      new: entry('2026-10-03T00:00:00.000Z', {}),
    }
    expect(Object.keys(pruneGraphqlCache(cache, 2, 1024))).toEqual(['new', 'mid'])
  })

  it('drops entries when the byte budget is exceeded', () => {
    const big = 'x'.repeat(400)
    const cache = {
      old: entry('2026-10-01T00:00:00.000Z', big),
      mid: entry('2026-10-02T00:00:00.000Z', big),
      new: entry('2026-10-03T00:00:00.000Z', big),
    }
    const one = graphqlEntryBytes(cache.new)
    const kept = pruneGraphqlCache(cache, 40, one * 2)
    expect(Object.keys(kept)).toEqual(['new', 'mid'])
  })

  it('always keeps the newest entry, even above the budget alone', () => {
    const cache = { new: entry('2026-10-03T00:00:00.000Z', 'x'.repeat(4000)) }
    expect(Object.keys(pruneGraphqlCache(cache, 40, 10))).toEqual(['new'])
  })
})
