import { describe, expect, it } from 'vitest'
import { activeDirectoryOf, isActiveDirectoryTrail } from './activeDirectory'

describe('active directory of the editor file', () => {
  it('returns the containing directory, root as an empty string', () => {
    expect(activeDirectoryOf('packages/checkout/src/cart.ts')).toBe('packages/checkout/src')
    expect(activeDirectoryOf('package.json')).toBe('')
    expect(activeDirectoryOf('src\\windows\\main.go')).toBe('src/windows')
  })

  it('has no directory without an active file', () => {
    expect(activeDirectoryOf(null)).toBeNull()
    expect(activeDirectoryOf('')).toBeNull()
    expect(activeDirectoryOf('/')).toBe('')
  })

  it('recognises the active directory and its ancestors, never the root', () => {
    expect(isActiveDirectoryTrail('apps/web', 'apps/web/src')).toBe(true)
    expect(isActiveDirectoryTrail('apps', 'apps/web/src')).toBe(true)
    expect(isActiveDirectoryTrail('apps/api', 'apps/web/src')).toBe(false)
    expect(isActiveDirectoryTrail('', 'apps/web/src')).toBe(false)
    expect(isActiveDirectoryTrail('apps/web', '')).toBe(false)
  })
})
