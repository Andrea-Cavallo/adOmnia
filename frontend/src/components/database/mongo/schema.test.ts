import { describe, expect, it } from 'vitest'
import { analyzeSchema } from './schema'

describe('analyzeSchema', () => {
  it('reports presence, mixed types and nested paths', () => {
    const fields = analyzeSchema([
      { _id: { $oid: '65a1b2c3d4e5f60718293a4b' }, name: 'Ada', age: { $numberInt: '36' }, address: { city: 'Rome' }, tags: ['a', 'b'] },
      { _id: { $oid: '65a1b2c3d4e5f60718293a4c' }, name: 'Linus', age: '54', items: [{ sku: 'x' }] },
    ])
    const byPath = Object.fromEntries(fields.map((f) => [f.path, f]))
    expect(fields[0].path).toBe('_id')
    expect(byPath.name.probability).toBe(1)
    expect(byPath.address.probability).toBe(0.5)
    expect(byPath['address.city'].depth).toBe(1)
    expect(byPath.age.types.map((t) => t.kind).sort()).toEqual(['Int32', 'String'])
    expect(byPath.tags.samples).toEqual(['a', 'b'])
    expect(byPath['items[].sku'].count).toBe(1)
    expect(fields.map((f) => f.path).indexOf('address.city')).toBe(fields.map((f) => f.path).indexOf('address') + 1)
  })
})
