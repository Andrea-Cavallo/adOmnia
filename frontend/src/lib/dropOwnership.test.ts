import { describe, expect, it } from 'vitest'
import { shouldHandleGlobalDrop } from './dropOwnership'

describe('global file-drop ownership', () => {
  it('leaves a drop to the child panel that already consumed it', () => {
    expect(shouldHandleGlobalDrop(true)).toBe(false)
  })

  it('handles a drop that no child panel consumed', () => {
    expect(shouldHandleGlobalDrop(false)).toBe(true)
  })
})
