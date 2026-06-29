import { describe, expect, it } from 'vitest'
import { findTextMatches } from './textSearch'

describe('findTextMatches', () => {
  it('is case-insensitive by default', () => {
    expect(findTextMatches('Token token TOKEN', 'token')).toEqual([0, 6, 12])
  })

  it('can match case', () => {
    expect(findTextMatches('Token token TOKEN', 'Token', { matchCase: true })).toEqual([0])
  })

  it('can limit results to whole words, including unicode words', () => {
    expect(findTextMatches('id user_id id2 id caffè-id', 'id', { wholeWord: true })).toEqual([0, 15, 24])
  })
})
