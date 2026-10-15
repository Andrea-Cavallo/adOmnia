import { describe, expect, it } from 'vitest'
import { MAX_JSON_PARSE_BYTES, flattenRow, isContainerValue, normalizeCell, previewValue } from './dbValue'

describe('normalizeCell', () => {
  it('parses JSON text into a navigable structure', () => {
    expect(normalizeCell('{"street":"Via Roma","city":"Milano"}')).toEqual({ street: 'Via Roma', city: 'Milano' })
    expect(normalizeCell('[1,2,3]')).toEqual([1, 2, 3])
    expect(normalizeCell('  {"a":1}')).toEqual({ a: 1 })
  })

  it('leaves plain text and broken JSON alone', () => {
    expect(normalizeCell('hello')).toBe('hello')
    expect(normalizeCell('{not json')).toBe('{not json')
    expect(normalizeCell('')).toBe('')
    expect(normalizeCell(null)).toBeNull()
  })

  it('refuses to parse text over the size guard', () => {
    const big = `{"pad":"${'x'.repeat(MAX_JSON_PARSE_BYTES)}"}`
    expect(normalizeCell(big)).toBe(big)
  })

  it('maps Mongo wrappers to readable scalars, but only for Mongo', () => {
    expect(normalizeCell({ $oid: '507f1f77bcf86cd799439011' }, 'mongodb')).toBe("ObjectId('507f1f77bcf86cd799439011')")
    expect(normalizeCell({ $date: '2024-01-01T00:00:00.000Z' }, 'mongodb')).toBe('2024-01-01T00:00:00.000Z')
    expect(normalizeCell({ $numberInt: '2' }, 'mongodb')).toBe(2)
    // Su SQL un jsonb {"$oid": …} è un oggetto come un altro.
    expect(normalizeCell({ $oid: '507f1f77bcf86cd799439011' }, 'postgres')).toEqual({ $oid: '507f1f77bcf86cd799439011' })
  })

  it('normalizes wrappers nested inside documents and JSON text', () => {
    expect(normalizeCell('{"_id":{"$oid":"507f1f77bcf86cd799439011"},"n":{"$numberLong":"7"}}', 'mongodb')).toEqual({
      _id: "ObjectId('507f1f77bcf86cd799439011')",
      n: 7,
    })
    expect(normalizeCell({ rows: [{ $date: '2024-01-01T00:00:00.000Z' }] }, 'mongodb')).toEqual({ rows: ['2024-01-01T00:00:00.000Z'] })
  })
})

describe('previewValue', () => {
  it('reads out loud instead of Object (2 fields)', () => {
    expect(previewValue({ street: 'Via Roma', city: 'Milano' })).toBe('{ street: "Via Roma", city: "Milano" }')
    expect(previewValue(['a', 'b', 'c'])).toBe('[ "a", "b", +1 ]')
    expect(previewValue(['a', 'b'])).toBe('[ "a", "b" ]')
  })

  it('closes with … past the preview depth and counts the hidden entries', () => {
    expect(previewValue({ a: { b: { c: 1 } } })).toBe('{ a: { b: {…} } }')
    expect(previewValue({ a: 1, b: 2, c: 3 })).toBe('{ a: 1, b: 2, … }')
    expect(previewValue([])).toBe('[]')
    expect(previewValue({})).toBe('{}')
    expect(previewValue(null)).toBe('null')
    expect(previewValue(42)).toBe('42')
  })

  it('never shows Object (n fields) or Array (n) as the only text', () => {
    for (const value of [{ a: 1, b: 2 }, [1, 2, 3], { deep: { deeper: { deepest: true } } }]) {
      const text = previewValue(value)
      expect(text).not.toMatch(/Object \(/)
      expect(text).not.toMatch(/Array \(/)
      expect(text.length).toBeGreaterThan(0)
    }
  })

  it('truncates long previews to maxLen with an ellipsis', () => {
    const text = previewValue({ name: 'x'.repeat(80) }, 20)
    expect(text).toHaveLength(20)
    expect(text.endsWith('…')).toBe(true)
  })
})

describe('flattenRow', () => {
  it('expands nested objects into dotted columns', () => {
    expect(flattenRow({ id: 1, address: { city: 'Milano', zip: 20100 } })).toEqual({
      id: 1,
      'address.city': 'Milano',
      'address.zip': 20100,
    })
  })

  it('expands arrays up to the item budget and reports the rest', () => {
    expect(flattenRow({ tags: ['a', 'b', 'c', 'd'] })).toEqual({
      'tags[0]': 'a',
      'tags[1]': 'b',
      'tags[2]': 'c',
      'tags[…]': '+1 more',
    })
    expect(flattenRow({ tags: ['a'] })).toEqual({ 'tags[0]': 'a' })
    expect(flattenRow({ tags: [] })).toEqual({ tags: '[]' })
  })

  it('keeps containers as a preview past the depth budget', () => {
    expect(flattenRow({ a: { b: { c: 1 } } }, 2)).toEqual({ 'a.b': '{ c: 1 }' })
    expect(flattenRow({ a: { b: { c: 1 } } }, 3)).toEqual({ 'a.b.c': 1 })
    expect(flattenRow({ a: { b: { c: 1 } } }, 1)).toEqual({ a: '{ b: { c: 1 } }' })
  })
})

describe('isContainerValue', () => {
  it('only objects and arrays open the inspector', () => {
    expect(isContainerValue({ a: 1 })).toBe(true)
    expect(isContainerValue([1])).toBe(true)
    expect(isContainerValue('text')).toBe(false)
    expect(isContainerValue(7)).toBe(false)
    expect(isContainerValue(null)).toBe(false)
  })
})
