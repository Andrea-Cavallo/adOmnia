import { describe, expect, it } from 'vitest'
import { RAIL_CATEGORIES, isFeatureVisible, visibleRailCategories } from './featureRegistry'

const ids = (categories: typeof RAIL_CATEGORIES) => categories.flatMap((cat) => cat.groups.flatMap((group) => group.items.map((item) => item.id)))

describe('visibleRailCategories', () => {
  it('keeps every visible rail tool, so the Hub menu reaches all of them', () => {
    const flags = { showAdvancedFeatures: true, showLabFeatures: true, pluginsEnabled: true, dailyScenariosEnabled: true }
    expect(ids(visibleRailCategories(flags))).toEqual(ids(RAIL_CATEGORIES).filter((id) => isFeatureVisible(id, flags)))
  })

  it('drops hidden tools and the categories they leave empty', () => {
    const visible = visibleRailCategories({ showAdvancedFeatures: false, showLabFeatures: false })
    expect(ids(visible)).not.toContain('scenarios')
    expect(ids(visible)).not.toContain('collab')
    expect(visible.find((cat) => cat.key === 'workspace')).toBeUndefined()
  })
})
