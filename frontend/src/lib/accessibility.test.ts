import { describe, expect, it, vi } from 'vitest'
import { findSpatialFocusIndex, handleKeyboardActivation, handleModalKeyboard, nextRovingFocusIndex } from '@/lib/accessibility'

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
  it('moves through a vertical control group with arrows, Home and End', () => {
    expect(nextRovingFocusIndex(1, 4, 'ArrowDown')).toBe(2)
    expect(nextRovingFocusIndex(0, 4, 'ArrowUp')).toBe(3)
    expect(nextRovingFocusIndex(2, 4, 'Home')).toBe(0)
    expect(nextRovingFocusIndex(1, 4, 'End')).toBe(3)
  })

  it('does not move focus for unrelated keys or empty groups', () => {
    expect(nextRovingFocusIndex(1, 4, 'Enter')).toBeNull()
    expect(nextRovingFocusIndex(0, 0, 'ArrowDown')).toBeNull()
  })

  it('selects the closest focusable control in the requested direction', () => {
    const targets = [
      { left: 0, top: 0, right: 20, bottom: 20 },
      { left: 0, top: 32, right: 20, bottom: 52 },
      { left: 42, top: 0, right: 62, bottom: 20 },
    ]
    expect(findSpatialFocusIndex(targets, 0, 'ArrowDown')).toBe(1)
    expect(findSpatialFocusIndex(targets, 0, 'ArrowRight')).toBe(2)
    expect(findSpatialFocusIndex(targets, 1, 'ArrowUp')).toBe(0)
    expect(findSpatialFocusIndex(targets, 0, 'ArrowLeft')).toBeNull()
  })

  it('starts spatial navigation at the first control when focus is on the body', () => {
    expect(findSpatialFocusIndex([{ left: 0, top: 0, right: 20, bottom: 20 }], -1, 'ArrowDown')).toBe(0)
  })

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
