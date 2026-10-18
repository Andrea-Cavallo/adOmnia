import { describe, expect, it } from 'vitest'
import { mouseNavigationCommand } from './codeStudioMouseNavigation'

describe('mouseNavigationCommand', () => {
  it('maps the side buttons to Back and Forward and ignores the others', () => {
    expect(mouseNavigationCommand(3)).toBe('nav.back')
    expect(mouseNavigationCommand(4)).toBe('nav.forward')
    for (const button of [0, 1, 2, 5]) expect(mouseNavigationCommand(button)).toBeNull()
  })
})
