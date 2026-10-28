import { describe, expect, it } from 'vitest'
import { normalizeRailItem } from './navigation'

describe('normalizeRailItem', () => {
  it('lands persisted Markdown, Mermaid and Git Sync rails on Code Studio', () => {
    for (const legacy of ['markdown', 'mermaid', 'gitsync']) expect(normalizeRailItem(legacy)).toBe('codestudio')
  })

  it('keeps older aliases and rejects unknown ids', () => {
    expect(normalizeRailItem('kafka')).toBe('broker')
    expect(normalizeRailItem('nope')).toBeNull()
    expect(normalizeRailItem('mcp')).toBeNull()
    expect(normalizeRailItem(42)).toBeNull()
  })
})
