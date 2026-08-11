import { afterEach, describe, expect, it, vi } from 'vitest'
import { markStartup, reportStartupPerformance, startupDurationsFromMarks } from './startupPerformance'

afterEach(() => {
  performance.clearMarks()
  performance.clearMeasures()
  vi.restoreAllMocks()
})

describe('startup performance metrics', () => {
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
})
