import { describe, expect, it } from 'vitest'
import { parseFieldValue } from './DocumentCard'

describe('parseFieldValue', () => {
  it('reads shell values typed inline', () => {
    expect(parseFieldValue("'Ada'")).toBe('Ada')
    expect(parseFieldValue('42')).toBe(42)
    expect(parseFieldValue('{ city: "Rome" }')).toEqual({ city: 'Rome' })
    expect(parseFieldValue('')).toBeNull()
    expect(() => parseFieldValue('{ broken')).toThrow()
  })
})
