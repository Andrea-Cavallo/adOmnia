import { describe, expect, it } from 'vitest'
import { nonGoTestTarget, testTargets } from './testTargets'

const root = 'C:\\work\\shop'

describe('testTargets', () => {
  it('lists Go modules and Node apps with the request each runner needs', () => {
    const targets = testTargets({ rootPath: root, units: [
      { language: 'go', kind: 'module', root: `${root}\\orders` },
      { language: 'typescript', kind: 'node', root: `${root}\\web` },
      { language: 'go', kind: 'loose', root: `${root}\\scratch` },
    ] })
    expect(targets.map((target) => [target.label, target.language, target.workingDirectory, target.packages])).toEqual([
      ['orders · Go', 'go', 'orders', ['./...']],
      ['web · JavaScript / TypeScript', 'typescript', 'web', []],
    ])
  })

  it('names a root unit after the project folder', () => {
    const [target] = testTargets({ rootPath: root, units: [{ language: 'typescript', kind: 'node', root }] })
    expect(target.label).toBe('shop · JavaScript / TypeScript')
    expect(target.workingDirectory).toBe('')
  })

  it('falls back to a non-Go unit only when the project has no Go module', () => {
    const node = { language: 'typescript', kind: 'node', root }
    expect(nonGoTestTarget({ rootPath: root, units: [node] })?.language).toBe('typescript')
    expect(nonGoTestTarget({ rootPath: root, units: [node, { language: 'go', kind: 'module', root }] })).toBeNull()
    expect(nonGoTestTarget({ rootPath: root, units: [] })).toBeNull()
  })
})
