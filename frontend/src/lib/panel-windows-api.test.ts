import { describe, expect, it, vi } from 'vitest'

vi.mock('../../bindings/adomnia/app', () => ({}))
vi.mock('@wailsio/runtime', () => ({ Events: { On: vi.fn() } }))

const { canDetachPanel, detachedPanelOfThisWindow } = await import('./panel-windows-api')

describe('panel windows', () => {
  it('reads the detached module from the window URL', () => {
    expect(detachedPanelOfThisWindow('?window=panel&panel=database')).toBe('database')
    expect(detachedPanelOfThisWindow('?window=panel&panel=collections')).toBe('collections')
  })

  it('ignores the main window, unknown modules and modules that cannot be detached', () => {
    expect(detachedPanelOfThisWindow('')).toBeNull()
    expect(detachedPanelOfThisWindow('?window=go-studio&panel=database')).toBeNull()
    expect(detachedPanelOfThisWindow('?window=panel&panel=not-a-module')).toBeNull()
    expect(detachedPanelOfThisWindow('?window=panel&panel=settings')).toBeNull()
  })

  it('keeps the Hub, settings and Go Studio in the main window', () => {
    expect(canDetachPanel('broker')).toBe(true)
    expect(canDetachPanel('welcome')).toBe(false)
    expect(canDetachPanel('goide')).toBe(false)
  })
})
