import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PANE_SIZES,
  MIN_EDITOR_HEIGHT,
  MIN_EDITOR_WIDTH,
  MIN_PANE_HEIGHT,
  MIN_PANE_WIDTH,
  clampPaneSize,
} from './goStudioLayout'

const bounds = { width: 1200, height: 800 }

describe('Go Studio pane sizes', () => {
  it('clamps side panes to the minimum width', () => {
    expect(clampPaneSize('projectWidth', 0, bounds)).toBe(MIN_PANE_WIDTH)
    expect(clampPaneSize('structureWidth', 40, bounds)).toBe(MIN_PANE_WIDTH)
    expect(clampPaneSize('bottomHeight', 0, bounds)).toBe(MIN_PANE_HEIGHT)
  })

  it('never lets a pane swallow the editor area', () => {
    expect(clampPaneSize('projectWidth', 5000, bounds)).toBe(bounds.width - MIN_EDITOR_WIDTH)
    expect(clampPaneSize('bottomHeight', 5000, bounds)).toBe(bounds.height - MIN_EDITOR_HEIGHT)
  })

  it('reserves the other side pane when both are open', () => {
    const withSide = { width: 1200, height: 800, otherWidth: 244 }
    expect(clampPaneSize('projectWidth', 5000, withSide)).toBe(1200 - 244 - MIN_EDITOR_WIDTH)
    expect(clampPaneSize('projectWidth', 300, withSide)).toBe(300)
  })

  it('keeps the minimum when the window cannot host pane and editor at all', () => {
    // 400px di larghezza: il pannello si ferma a 240 e l'editor conserva i suoi 160.
    expect(clampPaneSize('projectWidth', 5000, { width: 400, height: 300 })).toBe(240)
    // 300px: non entrano minimo + editor, quindi vince il minimo.
    expect(clampPaneSize('projectWidth', 5000, { width: 300, height: 300 })).toBe(MIN_PANE_WIDTH)
    // 300px di altezza: 300 - 180 = 120 è ancora sopra il minimo della tool window.
    expect(clampPaneSize('bottomHeight', 5000, { width: 400, height: 300 })).toBe(120)
    expect(clampPaneSize('bottomHeight', 5000, { width: 400, height: 250 })).toBe(MIN_PANE_HEIGHT)
  })

  it('keeps the documented default sizes', () => {
    expect(DEFAULT_PANE_SIZES).toEqual({ projectWidth: 244, structureWidth: 220, bottomHeight: 190 })
  })
})
