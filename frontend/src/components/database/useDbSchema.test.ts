import { describe, expect, it } from 'vitest'
import { mongoIndexFields } from './useDbSchema'
import { interpret } from './queryInterpreter'

describe('mongoIndexFields', () => {
  it('collects the indexed field names out of a listIndexes result', () => {
    expect(mongoIndexFields({
      documents: [{ key: { _id: 1 } }, { key: { email: 1, tenant: -1 } }],
    } as never)).toEqual(['_id', 'email', 'tenant'])
  })

  it('accepts the rows shape and ignores specs without a key', () => {
    expect(mongoIndexFields({
      rows: [{ key: { name: 1 } }, { name: 'weird' }, { key: 'nope' }],
    } as never)).toEqual(['name'])
    expect(mongoIndexFields({ documents: [] } as never)).toEqual([])
    expect(mongoIndexFields({} as never)).toEqual([])
  })
})

describe('unindexed filter warning', () => {
  const schema = { collections: [{ name: 'users', columns: ['email', 'createdAt'], indexes: ['_id', 'email'] }] }

  it('fires only when the caller passes indexes and the filter is not covered', () => {
    const filtered = interpret('mongodb', JSON.stringify({ operation: 'find', collection: 'users', filter: { createdAt: 1 } }), schema)
    expect(filtered.issues).toContain('unindexed field on a large collection')
    const indexed = interpret('mongodb', JSON.stringify({ operation: 'find', collection: 'users', filter: { email: 'a@b.c' } }), schema)
    expect(indexed.issues).not.toContain('unindexed field on a large collection')
    const withoutIndexes = interpret('mongodb', JSON.stringify({ operation: 'find', collection: 'users', filter: { createdAt: 1 } }), { collections: [{ name: 'users', columns: ['email', 'createdAt'] }] })
    expect(withoutIndexes.issues).not.toContain('unindexed field on a large collection')
  })

  it('never complains about the _id filter', () => {
    const byId = interpret('mongodb', JSON.stringify({ operation: 'find', collection: 'users', filter: { _id: 1 } }), schema)
    expect(byId.issues).not.toContain('unindexed field on a large collection')
  })
})
