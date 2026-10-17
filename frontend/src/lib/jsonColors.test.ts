import { describe, expect, it } from 'vitest'
import { jsonColorTokens, normalizeJsonColors } from './jsonColors'

describe('JSON color preferences', () => {
  it('accepts only known categories and hex colors per mode', () => {
    expect(normalizeJsonColors({ dark: { key: '#aabbcc', string: 'red', array: '#123456', unknown: '#ffffff' }, light: { number: '#102030' }, other: {} }))
      .toEqual({ dark: { key: '#aabbcc', array: '#123456' }, light: { number: '#102030' } })
  })
  it('keeps old settings and absent overrides on the theme palette', () => {
    expect(normalizeJsonColors(undefined)).toEqual({})
    expect(jsonColorTokens()).toEqual({})
    expect(jsonColorTokens({ key: '#abcdef', array: '#123456' })).toEqual({ 'json-key': '#abcdef', 'json-array': '#123456' })
  })
})
