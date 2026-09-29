import { describe, expect, it } from 'vitest'
import { replaceInText } from './goStudioReplaceInFiles'

const plain = { caseSensitive: false, wholeWord: false, regex: false }

describe('replaceInText', () => {
  it('replaces literal text, escaping regex characters', () => {
    expect(replaceInText('a.b a.b axb', 'a.b', 'X', plain)).toEqual({ text: 'X X axb', count: 2 })
  })

  it('honours case and whole-word options', () => {
    expect(replaceInText('Log log logger', 'log', 'L', plain).count).toBe(3)
    expect(replaceInText('Log log logger', 'log', 'L', { ...plain, caseSensitive: true }).text).toBe('Log L Lger')
    expect(replaceInText('log logger log', 'log', 'L', { ...plain, wholeWord: true }).text).toBe('L logger L')
  })

  it('expands capture groups in regex mode only', () => {
    expect(replaceInText('GetUser GetOrder', 'Get(\\w+)', 'Fetch$1', { ...plain, regex: true, caseSensitive: true }).text).toBe('FetchUser FetchOrder')
    expect(replaceInText('price', 'price', 'cost $1', plain).text).toBe('cost $1')
  })
})
