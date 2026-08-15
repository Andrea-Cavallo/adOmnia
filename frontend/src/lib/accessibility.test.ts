import { describe, expect, it, vi } from 'vitest'
import { findSpatialFocusIndex, handleKeyboardActivation, handleModalKeyboard, nextRovingFocusIndex, ownsArrowKey } from '@/lib/accessibility'

/** Minimal stand-in for a focused control living inside one composite widget. */
function elementInside(role: string, orientation?: string) {
  const owner = {
    getAttribute: (name: string) => (name === 'aria-orientation' ? orientation ?? null : null),
  }
  return {
    tagName: 'DIV',
    closest: (selector: string) => (selector.includes(`[role="${role}"]`) ? owner : null),
  } as unknown as Element
}

/** Minimal stand-in for a focused form control outside any composite widget. */
function formControl(tagName: string, type?: string) {
  return { tagName, type, closest: () => null } as unknown as Element
}

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

  it('lets a horizontal tab strip keep the arrows it uses and release the others', () => {
    const tab = elementInside('tablist')
    expect(ownsArrowKey(tab, 'ArrowRight')).toBe(true)
    expect(ownsArrowKey(tab, 'ArrowDown')).toBe(false)
    expect(ownsArrowKey(elementInside('tablist', 'vertical'), 'ArrowDown')).toBe(true)
    expect(ownsArrowKey(elementInside('tree'), 'ArrowRight')).toBe(true)
    expect(ownsArrowKey(null, 'ArrowDown')).toBe(false)
  })

  it('keeps the caret keys inside a single-line field but releases the vertical ones', () => {
    const url = formControl('INPUT', 'text')
    expect(ownsArrowKey(url, 'ArrowLeft')).toBe(true)
    expect(ownsArrowKey(url, 'ArrowDown')).toBe(false)
    expect(ownsArrowKey(formControl('INPUT', 'checkbox'), 'ArrowLeft')).toBe(false)
  })

  it('leaves multi-line editors and sliders untouched, and never lets a select self-edit', () => {
    expect(ownsArrowKey(formControl('TEXTAREA'), 'ArrowDown')).toBe(true)
    expect(ownsArrowKey(formControl('INPUT', 'range'), 'ArrowLeft')).toBe(true)
    expect(ownsArrowKey(formControl('SELECT'), 'ArrowDown')).toBe(false)
    expect(ownsArrowKey(formControl('SELECT'), 'ArrowLeft')).toBe(false)
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
