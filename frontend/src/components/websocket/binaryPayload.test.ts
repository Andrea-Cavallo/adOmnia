import { describe, expect, it } from 'vitest'
import { binaryPayloadPreview } from './binaryPayload'

describe('binaryPayloadPreview', () => {
  it('renders bytes as hex and printable ASCII with the decoded size', () => {
    expect(binaryPayloadPreview('AEEgQUJD/w==')).toEqual({
      size: 7,
      rows: ['00000000  00 41 20 41 42 43 ff                             |.A ABC.|'],
      truncated: false,
    })
  })

  it('limits the display without losing the actual payload size', () => {
    const result = binaryPayloadPreview(btoa('x'.repeat(5000)))
    expect(result?.size).toBe(5000)
    expect(result?.truncated).toBe(true)
    expect(result?.rows).toHaveLength(256)
  })

  it('rejects malformed Base64', () => {
    expect(binaryPayloadPreview('abc!')).toBeNull()
    expect(binaryPayloadPreview('a')).toBeNull()
  })
})
