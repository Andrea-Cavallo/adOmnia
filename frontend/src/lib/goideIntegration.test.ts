import { describe, expect, it } from 'vitest'
import { ADOMNIA_CAPABILITIES } from './aiCapabilities'
import { COMMAND_PALETTE_PANELS } from './commandPalette'
import { FEATURE_BY_ID, RAIL_CATEGORIES } from './featureRegistry'
import { normalizeRailItem } from './navigation'

describe('Go Studio navigation integration', () => {
  it('registers one real panel across rail, palette and assistant navigation', () => {
    expect(normalizeRailItem('goide')).toBe('goide')
    expect(FEATURE_BY_ID.goide.title).toBe('Go Studio')
    expect(RAIL_CATEGORIES.find((category) => category.directItem === 'goide')?.key).toBe('development')
    expect(COMMAND_PALETTE_PANELS.some((panel) => panel.id === 'goide')).toBe(true)
    expect(ADOMNIA_CAPABILITIES.some((capability) => capability.panel === 'goide')).toBe(true)
  })

  it('does not move existing Git Sync ownership out of Workspace', () => {
    const workspace = RAIL_CATEGORIES.find((category) => category.key === 'workspace')
    expect(workspace?.groups.flatMap((group) => group.items.map((item) => item.id))).toEqual(['gitsync'])
  })
})
