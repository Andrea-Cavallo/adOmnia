import { describe, expect, it } from 'vitest'
import source from './MockPanel.tsx?raw'

describe('MockPanel', () => {
  it('does not expose the inactive REST presets action', () => {
    expect(source).not.toMatch(/REST presets/i)
    expect(source).not.toContain('loadRestPresets')
  })
})
