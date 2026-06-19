import { describe, expect, it } from 'vitest'
import { resolveContextMenuPosition } from './ContextMenu'

describe('resolveContextMenuPosition', () => {
  it('keeps a submenu attached to the parent anchor when there is room', () => {
    expect(resolveContextMenuPosition({
      x: 499,
      y: 120,
      width: 232,
      height: 180,
      depth: 1,
      viewportWidth: 1200,
      viewportHeight: 800,
    })).toEqual({ left: 499, top: 120 })
  })

  it('flips a submenu to the left while preserving the shared border', () => {
    expect(resolveContextMenuPosition({
      x: 1099,
      y: 120,
      width: 232,
      height: 180,
      depth: 1,
      viewportWidth: 1200,
      viewportHeight: 800,
    })).toEqual({ left: 636, top: 120 })
  })

  it('clamps root menus and tall submenus inside the viewport gutter', () => {
    expect(resolveContextMenuPosition({
      x: 1150,
      y: 760,
      width: 232,
      height: 220,
      depth: 0,
      viewportWidth: 1200,
      viewportHeight: 800,
    })).toEqual({ left: 960, top: 572 })
  })
})
