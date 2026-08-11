import { describe, expect, it, vi } from 'vitest'
import { decodePersistedJSON } from './persistedJson'

describe('decodePersistedJSON', () => {
  it('reuses values already decoded by the Wails envelope', () => {
    const value = { version: 2, items: [{ id: 'a' }] }
    const parse = vi.spyOn(JSON, 'parse')

    expect(decodePersistedJSON(value)).toBe(value)
    expect(parse).not.toHaveBeenCalled()
    parse.mockRestore()
  })

  it('decodes a legacy string exactly once', () => {
    const parse = vi.spyOn(JSON, 'parse')

    expect(decodePersistedJSON<{ version: number }>(`{"version":1}`)).toEqual({ version: 1 })
    expect(parse).toHaveBeenCalledOnce()
    parse.mockRestore()
  })

  it('rejects empty, primitive and unavailable values', () => {
    expect(() => decodePersistedJSON(null)).toThrow('unavailable')
    expect(() => decodePersistedJSON(2)).toThrow('unavailable')
    expect(() => decodePersistedJSON('')).toThrow()
  })
})
