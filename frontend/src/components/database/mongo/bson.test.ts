import { describe, expect, it } from 'vitest'
import { bsonDisplay, bsonKind, parseEditorDocuments, parseShellDoc, toEditable } from './bson'

describe('MongoDB BSON helpers', () => {
  it('detects canonical Extended JSON types', () => {
    expect(bsonKind({ $oid: '65a1b2c3d4e5f60718293a4b' })).toBe('ObjectId')
    expect(bsonKind({ $numberLong: '7' })).toBe('Int64')
    expect(bsonKind({ $date: { $numberLong: '0' } })).toBe('Date')
    expect(bsonKind({ a: 1 })).toBe('Object')
    expect(bsonDisplay({ $date: { $numberLong: '1704164645000' } })).toBe('2024-01-02T03:04:05.000Z')
  })

  it('makes documents editable without losing numeric types', () => {
    const editable = toEditable({
      n: { $numberInt: '1' },
      l: { $numberLong: '2' },
      whole: { $numberDouble: '3.0' },
      frac: { $numberDouble: '3.5' },
      at: { $date: { $numberLong: '0' } },
      nested: [{ x: { $numberInt: '4' } }],
    })
    expect(editable).toEqual({
      n: 1,
      l: { $numberLong: '2' },
      whole: { $numberDouble: '3.0' },
      frac: 3.5,
      at: { $date: '1970-01-01T00:00:00.000Z' },
      nested: [{ x: 4 }],
    })
  })

  it('accepts mongosh-style filters', () => {
    expect(parseShellDoc("{ name: 'Ada', _id: ObjectId('65a1b2c3d4e5f60718293a4b'), at: { $gte: ISODate('2024-01-01') }, }", 'Filter')).toEqual({
      name: 'Ada',
      _id: { $oid: '65a1b2c3d4e5f60718293a4b' },
      at: { $gte: { $date: '2024-01-01T00:00:00.000Z' } },
    })
    expect(parseShellDoc('', 'Filter')).toEqual({})
    expect(parseShellDoc("{ note: 'it:s ObjectId(x)' }", 'Filter')).toEqual({ note: 'it:s ObjectId(x)' })
    expect(() => parseShellDoc('[1]', 'Sort')).toThrow(/Sort must be an object/)
    expect(() => parseShellDoc('{ a: ', 'Filter')).toThrow(/^Filter:/)
  })

  it('parses single or bulk documents from the editor', () => {
    expect(parseEditorDocuments('{ a: 1 }')).toEqual([{ a: 1 }])
    expect(parseEditorDocuments('[{"a":1},{"b":2}]')).toHaveLength(2)
    expect(() => parseEditorDocuments('42')).toThrow()
  })
})
