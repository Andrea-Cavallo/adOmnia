import { describe, expect, it } from 'vitest'
import { normalizeRailItem } from './navigation'

describe('normalizeRailItem', () => {
  it('lands persisted Markdown, Mermaid and Git Sync rails on Go Studio', () => {
    for (const legacy of ['markdown', 'mermaid', 'gitsync']) expect(normalizeRailItem(legacy)).toBe('goide')
  })

  it('keeps older aliases and rejects unknown ids', () => {
    expect(normalizeRailItem('kafka')).toBe('broker')
    expect(normalizeRailItem('nope')).toBeNull()
    expect(normalizeRailItem(42)).toBeNull()
  })
})
