import { describe, expect, it, vi } from 'vitest'
import { handleKeyboardActivation, handleModalKeyboard } from '@/lib/accessibility'

function keyboardEvent(key: string, sameTarget = true) {
  const currentTarget = {}
  return {
    key,
    target: sameTarget ? currentTarget : {},
    currentTarget,
    preventDefault: vi.fn(),
  }
}

describe('keyboard accessibility helpers', () => {
  it.each(['Enter', ' '])('activates semantic cards with %s', (key) => {
    const action = vi.fn()
    const event = keyboardEvent(key)
    handleKeyboardActivation(event as never, action)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(action).toHaveBeenCalledOnce()
  })

  it('ignores unrelated keys and events bubbling from nested controls', () => {
    const action = vi.fn()
    handleKeyboardActivation(keyboardEvent('Escape') as never, action)
    handleKeyboardActivation(keyboardEvent('Enter', false) as never, action)
    expect(action).not.toHaveBeenCalled()
  })

  it('closes the active modal with Escape', () => {
    const onClose = vi.fn()
    const event = { key: 'Escape', shiftKey: false, preventDefault: vi.fn() }
    handleModalKeyboard(event, null, onClose, null)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it.each([
    { shiftKey: false, active: 'last', expected: 'first' },
    { shiftKey: true, active: 'first', expected: 'last' },
  ])('wraps modal focus from $active to $expected', ({ shiftKey, active, expected }) => {
    const first = { focus: vi.fn(), hasAttribute: vi.fn(() => false), getAttribute: vi.fn(() => null) }
    const last = { focus: vi.fn(), hasAttribute: vi.fn(() => false), getAttribute: vi.fn(() => null) }
    const container = { querySelectorAll: vi.fn(() => [first, last]), focus: vi.fn() }
    const event = { key: 'Tab', shiftKey, preventDefault: vi.fn() }
    handleModalKeyboard(event, container as never, vi.fn(), (active === 'first' ? first : last) as never)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect((expected === 'first' ? first : last).focus).toHaveBeenCalledOnce()
  })
})
