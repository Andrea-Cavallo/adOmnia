import { afterEach, describe, expect, it, vi } from 'vitest'
import { heavyFeatureEnabled, isLowResource, watchBattery } from './goStudioResourceMode'

const prefs = { semanticHighlighting: true, inlayHints: true, typeHints: false, stickyScroll: true, minimap: false, lintOnSave: true }

describe('goStudioResourceMode', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('turns heavy features off in low mode and on battery in auto mode', () => {
    expect(isLowResource('normal', true)).toBe(false)
    expect(isLowResource('low', false)).toBe(true)
    expect(isLowResource('auto', false)).toBe(false)
    expect(isLowResource('auto', true)).toBe(true)
    expect(heavyFeatureEnabled({ preferences: { ...prefs, resourceMode: 'normal' }, onBattery: true }, 'inlayHints')).toBe(true)
    expect(heavyFeatureEnabled({ preferences: { ...prefs, resourceMode: 'auto' }, onBattery: true }, 'inlayHints')).toBe(false)
    expect(heavyFeatureEnabled({ preferences: { ...prefs, resourceMode: 'normal' }, onBattery: false }, 'typeHints')).toBe(false)
  })

  it('follows charging changes and is a no-op without the Battery API', async () => {
    const battery = Object.assign(new EventTarget(), { charging: true })
    vi.stubGlobal('navigator', { getBattery: () => Promise.resolve(battery) })
    const states: boolean[] = []
    const stop = watchBattery((onBattery) => states.push(onBattery))
    await Promise.resolve(); await Promise.resolve()
    battery.charging = false
    battery.dispatchEvent(new Event('chargingchange'))
    stop()
    battery.dispatchEvent(new Event('chargingchange'))
    expect(states).toEqual([false, true])

    vi.stubGlobal('navigator', {})
    expect(() => watchBattery(() => undefined)()).not.toThrow()
  })
})
