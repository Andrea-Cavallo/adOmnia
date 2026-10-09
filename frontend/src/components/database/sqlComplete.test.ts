import { describe, expect, it } from 'vitest'
import { sqlCompletions } from './sqlComplete'

const schema = { users: ['id', 'email', 'created_at'], orders: ['id', 'user_id', 'total'] }
const labels = (q: string, caret = q.length, explicit = false) => sqlCompletions(q, caret, schema, explicit)?.items.map((i) => i.label) ?? []

describe('sqlCompletions', () => {
  it('suggests only tables after FROM/JOIN', () => {
    expect(labels('SELECT * FROM u')).toEqual(['users'])
    expect(labels('SELECT * FROM users JOIN ', undefined, true)).toEqual(['users', 'orders'])
  })

  it('resolves aliases for qualified columns', () => {
    const q = 'SELECT o. FROM orders o'
    expect(labels(q, 'SELECT o.'.length)).toEqual(['id', 'user_id', 'total'])
    expect(labels('SELECT u.em FROM users AS u', 'SELECT u.em'.length)).toEqual(['email'])
  })

  it('ranks in-scope columns before tables and keywords', () => {
    const q = 'SELECT us FROM orders'
    expect(labels(q, 'SELECT us'.length)).toEqual(['user_id', 'users'])
    expect(labels('SEL')).toContain('SELECT')
  })

  it('stays quiet in strings, comments and without a word', () => {
    expect(sqlCompletions("SELECT 'us", 10, schema)).toBeNull()
    expect(sqlCompletions('-- us', 5, schema)).toBeNull()
    expect(sqlCompletions('SELECT ', 7, schema)).toBeNull()
  })

  it('reports the replace start', () => {
    expect(sqlCompletions('SELECT * FROM us', 16, schema)?.start).toBe(14)
  })
})
