import { describe, expect, it } from 'vitest'
import { trimTextToBudget, utf8ByteLength } from './limits'

describe('utf8ByteLength', () => {
  it('counts ASCII, accents and emoji', () => {
    expect(utf8ByteLength('abc')).toBe(3)
    expect(utf8ByteLength('città')).toBe(6)
    expect(utf8ByteLength('😀')).toBe(4)
  })
})

describe('trimTextToBudget', () => {
  it('keeps the newest lines within the line cap', () => {
    expect(trimTextToBudget('a\nb\nc', 2, 1024)).toBe('b\nc')
  })

  it('keeps the newest lines within the byte cap', () => {
    const text = ['aaaa', 'bbbb', 'cccc'].join('\n')
    expect(trimTextToBudget(text, 10, 9)).toBe('bbbb\ncccc')
  })

  it('keeps the last line even when it alone exceeds the cap', () => {
    expect(trimTextToBudget('a\n' + 'x'.repeat(100), 10, 10)).toBe('x'.repeat(100))
  })
})
