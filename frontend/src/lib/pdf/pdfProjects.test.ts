import { describe, it, expect } from 'vitest'
import { bytesToBase64, base64ToBytes } from './pdfProjects'

describe('pdfProjects base64 round-trip', () => {
  it('round-trips a small byte sequence', () => {
    const bytes = new Uint8Array([0, 1, 2, 254, 255, 37, 80, 68, 70]) // includes %PDF prefix bytes
    const b64 = bytesToBase64(bytes)
    expect(base64ToBytes(b64)).toEqual(bytes)
  })

  it('round-trips a large buffer that crosses the chunking boundary', () => {
    // 0x8000 is the chunk size in bytesToBase64; go well past it.
    const bytes = new Uint8Array(100_000)
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 256
    const restored = base64ToBytes(bytesToBase64(bytes))
    expect(restored.length).toBe(bytes.length)
    expect(restored[0]).toBe(0)
    expect(restored[65_536]).toBe(65_536 % 256)
    expect(restored[bytes.length - 1]).toBe((bytes.length - 1) % 256)
  })

  it('produces ASCII-safe base64 (no high-byte corruption)', () => {
    const bytes = new Uint8Array([200, 201, 202, 203])
    const b64 = bytesToBase64(bytes)
    expect(/^[A-Za-z0-9+/=]+$/.test(b64)).toBe(true)
  })
})
