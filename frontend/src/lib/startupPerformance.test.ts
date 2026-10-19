import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getStartupDurations,
  getStudioSwitchDurations,
  markStartup,
  recordStudioSwitch,
  reportStartupPerformance,
  startupDurationsFromMarks,
} from './startupPerformance'

afterEach(() => {
  performance.clearMarks()
  performance.clearMeasures()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('startup performance metrics', () => {
  it('records Studio tree and tab latency relative to the first session request', () => {
    expect(startupDurationsFromMarks([
      { name: 'startup:renderer-entry', startTime: 0 },
      { name: 'startup:studio-session-requested', startTime: 100 },
      { name: 'startup:studio-first-tree', startTime: 120 },
      { name: 'startup:studio-tabs-restored', startTime: 145 },
    ])).toMatchObject({ studioFirstTreeMs: 20, studioTabsRestoredMs: 45 })
  })

  it('keeps every session switch, not only the first restore', () => {
    recordStudioSwitch(12.34)
    recordStudioSwitch(8)
    const durations = getStartupDurations()
    expect(durations).toMatchObject({ studioSwitchCount: 2, studioSwitchLastMs: 8, studioSwitchMaxMs: 12.3 })
    expect(getStudioSwitchDurations()).toEqual([12.3, 8])
    // The sample list stays bounded across long sessions.
    for (let index = 0; index < 40; index++) recordStudioSwitch(index)
    expect(getStudioSwitchDurations()).toHaveLength(20)
  })

  it('calculates renderer and serial settings-to-tabs durations', () => {
    expect(startupDurationsFromMarks([
      { name: 'startup:renderer-entry', startTime: 10 },
      { name: 'startup:react-mounted', startTime: 24.24 },
      { name: 'startup:backend-ready', startTime: 30 },
      { name: 'startup:settings-loaded', startTime: 42 },
      { name: 'startup:tabs-loaded', startTime: 58.16 },
      { name: 'startup:workspace-hydrated', startTime: 62.55 },
      { name: 'startup:workspace-bundle-requested', startTime: 12 },
      { name: 'startup:workspace-bundle-loaded', startTime: 31.44 },
      { name: 'startup:first-stable-frame', startTime: 80 },
    ])).toEqual({
      rendererToReactMounted: 14.2,
      rendererToBackendReady: 20,
      rendererToSettingsLoaded: 32,
      rendererToWorkspaceHydrated: 52.6,
      rendererToFirstStableFrame: 70,
      settingsToTabsLoaded: 16.2,
      skeletonShown: 0,
      workspaceBundleMs: 19.4,
    })
  })

  it('reports skeleton visibility without leaking anything except timing', () => {
    expect(startupDurationsFromMarks([
      { name: 'startup:renderer-entry', startTime: 0 },
      { name: 'startup:skeleton-shown', startTime: 120.05 },
      { name: 'startup:skeleton-hidden', startTime: 301.29 },
    ])).toMatchObject({
      skeletonShown: 1,
      skeletonVisibleMs: 181.2,
    })
  })

  it('publishes Performance API measures for browser tooling', () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    performance.mark('startup:renderer-entry')
    markStartup('startup:react-mounted')
    markStartup('startup:settings-loaded')
    markStartup('startup:tabs-loaded')
    performance.mark('startup:skeleton-shown')
    performance.mark('startup:skeleton-hidden')

    reportStartupPerformance()

    expect(performance.getEntriesByName('startup:renderer-to-react-mounted', 'measure')).toHaveLength(1)
    expect(performance.getEntriesByName('startup:settings-to-tabs-loaded', 'measure')).toHaveLength(1)
    expect(performance.getEntriesByName('startup:skeleton-visible', 'measure')).toHaveLength(1)
  })

  it('exposes only numeric startup diagnostics to local product checks', () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const setAttribute = vi.fn()
    vi.stubGlobal('document', { documentElement: { setAttribute } })

    const durations = reportStartupPerformance()

    expect(setAttribute).toHaveBeenCalledWith('data-startup-performance', JSON.stringify(durations))
    const published = JSON.parse(setAttribute.mock.calls[0][1])
    expect(Object.values(published).every((value) => typeof value === 'number')).toBe(true)
  })

  it('does not interrupt startup if the diagnostics target is unavailable', () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.stubGlobal('document', { documentElement: { setAttribute: () => { throw new Error('Unavailable DOM') } } })

    expect(() => reportStartupPerformance()).not.toThrow()
  })
})

 it('distinguishes API controls readiness from the shell frame', () => {
   expect(startupDurationsFromMarks([
     { name: 'startup:renderer-entry', startTime: 10 },
     { name: 'startup:first-stable-frame', startTime: 50 },
     { name: 'startup:workspace-interactive', startTime: 90 },
   ])).toMatchObject({ rendererToFirstStableFrame: 40, rendererToWorkspaceInteractive: 80 })
 })
