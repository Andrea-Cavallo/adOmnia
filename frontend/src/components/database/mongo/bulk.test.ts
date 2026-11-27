import { describe, expect, it } from 'vitest'
import { extractAffected, validateUpdate } from './bulk'

describe('mongo bulk helpers', () => {
  it('accepts operator updates and rejects replacements or empty operators', () => {
    expect(validateUpdate({ $set: { a: 1 } })).toEqual({ $set: { a: 1 } })
    expect(() => validateUpdate({ a: 1 })).toThrow(/plain field "a"/)
    expect(() => validateUpdate({ $set: {} })).toThrow(/\$set is empty/)
    expect(() => validateUpdate(null)).toThrow(/empty/)
  })

  it('reads update rows and delete rowsAffected', () => {
    expect(extractAffected({ rows: [{ matched: 4, modified: 3 }] } as never)).toEqual({ matched: 4, modified: 3 })
    expect(extractAffected({ rows: [], rowsAffected: 7 } as never)).toEqual({ matched: 7, modified: 7 })
  })
})
