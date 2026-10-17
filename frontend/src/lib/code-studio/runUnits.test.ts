import { describe, expect, it } from 'vitest'
import { groupConfigurationsByUnit, unitOfConfiguration } from './runUnits'

const project = {
  rootPath: 'C:\\work\\shop',
  units: [
    { language: 'go', root: 'C:\\work\\shop\\orders' },
    { language: 'typescript', root: 'C:\\work\\shop\\web' },
    { language: 'typescript', root: 'C:\\work\\shop\\web\\packages\\ui' },
  ],
}

describe('runUnits', () => {
  it('picks the deepest unit containing the working directory', () => {
    expect(unitOfConfiguration({ workingDirectory: 'web/packages/ui' }, project)?.root).toBe('C:\\work\\shop\\web\\packages\\ui')
    expect(unitOfConfiguration({ workingDirectory: './web' }, project)?.root).toBe('C:\\work\\shop\\web')
    expect(unitOfConfiguration({ workingDirectory: 'docs' }, project)).toBeNull()
  })

  it('does not match a sibling that only shares a name prefix', () => {
    expect(unitOfConfiguration({ workingDirectory: 'orders-legacy' }, project)).toBeNull()
  })

  it('groups a mixed workspace with language labels', () => {
    const groups = groupConfigurationsByUnit([{ workingDirectory: 'orders' }, { workingDirectory: 'web' }, { workingDirectory: 'orders' }], project, { go: 'Go', typescript: 'TypeScript' })
    expect(groups.map((group) => [group.label, group.items.length])).toEqual([['orders · Go', 2], ['web · TypeScript', 1]])
  })

  it('drops labels when there is a single group', () => {
    expect(groupConfigurationsByUnit([{ workingDirectory: 'orders' }], project)[0].label).toBe('')
    expect(groupConfigurationsByUnit([], project)).toEqual([])
  })
})
