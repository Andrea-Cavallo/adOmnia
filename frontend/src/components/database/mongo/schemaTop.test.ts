import { describe, expect, it } from 'vitest'
import { addFilterValue, analyzeSchema } from './schema'

describe('schema top values', () => {
  it('ranks values by frequency', () => {
    const fields = analyzeSchema([{ s: 'a' }, { s: 'b' }, { s: 'b' }, { tags: ['x', 'x'] }])
    expect(fields.find((f) => f.path === 's')?.top.map((t) => [t.text, t.count])).toEqual([['b', 2], ['a', 1]])
    expect(fields.find((f) => f.path === 'tags')?.top[0]).toMatchObject({ text: 'x', count: 2 })
  })

  it('adds a value to the current filter, replacing an unparsable one', () => {
    expect(addFilterValue('{ age: { $gt: 3 } }', 'tags[]', 'x')).toBe('{"age":{"$gt":3},"tags":"x"}')
    expect(addFilterValue('{ broken', 's', 'b')).toBe('{"s":"b"}')
  })
})
