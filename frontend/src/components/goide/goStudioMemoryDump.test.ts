import { describe, expect, it } from 'vitest'
import { memoryDumpRows } from './goStudioMemoryDump'

describe('memoryDumpRows', () => {
  it('splits bytes into addressed hex and ascii rows', () => {
    const bytes = [...'Go!'].map((char) => char.charCodeAt(0)).concat(Array.from({ length: 15 }, (_, index) => index))
    const rows = memoryDumpRows('0xc000010000', bytes)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ address: '0x00c000010000', ascii: 'Go!.............' })
    expect(rows[0].hex.slice(0, 4)).toEqual(['47', '6f', '21', '00'])
    expect(rows[1]).toEqual({ address: '0x00c000010010', hex: ['0d', '0e'], ascii: '..' })
  })
})
