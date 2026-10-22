import { describe, expect, it } from 'vitest'
import { nonGoTestTarget, testTargets } from './testTargets'

const root = 'C:\\work\\shop'

describe('testTargets', () => {
  it('lists Go modules, Node apps, Maven/Gradle builds and pytest projects with the request each runner needs', () => {
    const targets = testTargets({ rootPath: root, units: [
      { language: 'go', kind: 'module', root: `${root}\\orders` },
      { language: 'typescript', kind: 'node', root: `${root}\\web` },
      { language: 'go', kind: 'loose', root: `${root}\\scratch` },
      { language: 'java', kind: 'maven', root: `${root}\\billing` },
      { language: 'java', kind: 'gradle', root: `${root}\\ledger` },
      { language: 'python', kind: 'python-project', root: `${root}\\ml` },
      { language: 'python', kind: 'python-scripts', root: `${root}\\scripts` },
      { language: 'rust', kind: 'cargo-package', root: `${root}\\engine` },
    ] })
    expect(targets.map((target) => [target.label, target.language, target.workingDirectory, target.packages])).toEqual([
      ['orders · Go', 'go', 'orders', ['./...']],
      ['web · JavaScript / TypeScript', 'typescript', 'web', []],
      ['billing · Maven', 'java', 'billing', []],
      ['ledger · Gradle', 'java', 'ledger', []],
      ['ml · pytest', 'python', 'ml', []],
      ['engine · cargo test', 'rust', 'engine', []],
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

  it('runs Cargo workspace members once, not the virtual root plus every member', () => {
    const targets = testTargets({ rootPath: root, units: [
      { language: 'rust', kind: 'cargo-workspace', root: `${root}\\crates` },
      { language: 'rust', kind: 'cargo-package', root: `${root}\\crates\\api` },
      { language: 'rust', kind: 'cargo-package', root: `${root}\\crates\\core` },
    ] })
    expect(targets.map((target) => target.workingDirectory)).toEqual(['crates/api', 'crates/core'])
  })

  it('keeps a Cargo workspace root that has no detected member', () => {
    const targets = testTargets({ rootPath: root, units: [{ language: 'rust', kind: 'cargo-workspace', root: `${root}\\crates` }] })
    expect(targets.map((target) => target.workingDirectory)).toEqual(['crates'])
  })
})
