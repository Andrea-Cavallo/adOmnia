import { describe, expect, it } from 'vitest'
import { branchNameError } from './branchName'

describe('branchNameError', () => {
  it('accepts normal and namespaced names', () => {
    for (const name of ['main', 'feature/git-tool', 'fix_1.2', 'release-2026']) expect(branchNameError(name)).toBeNull()
  })

  it('rejects names git would refuse', () => {
    for (const name of ['', ' ', 'a b', '-x', 'a..b', 'a//b', '/a', 'a/', 'a.', 'x.lock', 'a/.b', 'a@{1}', 'a~1', 'a:b', '@']) {
      expect(branchNameError(name), name).not.toBeNull()
    }
  })
})
