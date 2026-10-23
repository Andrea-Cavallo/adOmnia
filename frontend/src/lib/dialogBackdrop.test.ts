import { describe, expect, it, vi } from 'vitest'
import type { MouseEvent } from 'react'
import { closeOnBackdropClick } from './dialogBackdrop'

function click(target: object, currentTarget: object) {
  const stopPropagation = vi.fn()
  return { event: { target, currentTarget, stopPropagation } as unknown as MouseEvent<HTMLElement>, stopPropagation }
}

describe('closeOnBackdropClick', () => {
  it('closes when the backdrop itself is clicked and lets the click bubble', () => {
    const onClose = vi.fn()
    const backdrop = {}
    const { event, stopPropagation } = click(backdrop, backdrop)
    closeOnBackdropClick(onClose)(event)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(stopPropagation).not.toHaveBeenCalled()
  })

  it('ignores a click from inside the dialog and stops it from reaching the ancestors', () => {
    const onClose = vi.fn()
    const { event, stopPropagation } = click({}, {})
    closeOnBackdropClick(onClose)(event)
    expect(onClose).not.toHaveBeenCalled()
    expect(stopPropagation).toHaveBeenCalledTimes(1)
  })
})
