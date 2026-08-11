export type StartupMarkName =
  | 'startup:renderer-entry'
  | 'startup:react-mounted'
  | 'startup:memento-restored'
  | 'startup:backend-ready'
  | 'startup:settings-loaded'
  | 'startup:collections-loaded'
  | 'startup:environments-loaded'
  | 'startup:hosts-loaded'
  | 'startup:tabs-loaded'
  | 'startup:workspace-hydrated'
  | 'startup:bootstrap-v2-received'
  | 'startup:bootstrap-v2-applied'
  | 'startup:workspace-bundle-requested'
  | 'startup:workspace-bundle-loaded'
  | 'startup:skeleton-shown'
  | 'startup:skeleton-hidden'
  | 'startup:first-stable-frame'

export interface StartupMarkEntry {
  name: string
  startTime: number
}

export interface StartupDurations {
  rendererToReactMounted?: number
  rendererToBackendReady?: number
  rendererToSettingsLoaded?: number
  rendererToWorkspaceHydrated?: number
  rendererToFirstStableFrame?: number
  settingsToTabsLoaded?: number
  skeletonShown: number
  skeletonVisibleMs?: number
  bootstrapApplyMs?: number
  bootstrapVersion?: number
  bootstrapPayloadBytes?: number
  bootstrapSettingsBytes?: number
  bootstrapCollectionsBytes?: number
  bootstrapEnvironmentsBytes?: number
  bootstrapHostsBytes?: number
  bootstrapTabsBytes?: number
  bootstrapSettingsDecodeMs?: number
  bootstrapCollectionsDecodeMs?: number
  bootstrapEnvironmentsDecodeMs?: number
  bootstrapHostsDecodeMs?: number
  bootstrapTabsDecodeMs?: number
  workspaceBundleMs?: number
}

export interface StartupBootstrapPayload {
  version: number
  total: number
  settings: number
  collections: number
  environments: number
  hosts: number
  tabs: number
  settingsDecodeMs?: number
  collectionsDecodeMs?: number
  environmentsDecodeMs?: number
  hostsDecodeMs?: number
  tabsDecodeMs?: number
}

const recordedMarks = new Set<StartupMarkName>()
const recordedMeasures = new Set<string>()
let bootstrapPayload: StartupBootstrapPayload | null = null

export function recordStartupBootstrap(payload: StartupBootstrapPayload): void {
  bootstrapPayload = payload
}

function roundedDuration(value: number): number {
  return Math.round(value * 10) / 10
}

export function markStartup(name: StartupMarkName): void {
  if (recordedMarks.has(name)) return
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return
  try {
    performance.mark(name)
    recordedMarks.add(name)
  } catch {
    // Startup diagnostics must never affect application startup.
  }
}

export function startupDurationsFromMarks(entries: StartupMarkEntry[]): StartupDurations {
  const marks = new Map(entries.map((entry) => [entry.name, entry.startTime]))
  const renderer = marks.get('startup:renderer-entry')
  if (renderer === undefined) return { skeletonShown: 0 }

  const fromRenderer = (name: StartupMarkName): number | undefined => {
    const value = marks.get(name)
    return value === undefined ? undefined : roundedDuration(value - renderer)
  }
  const settings = marks.get('startup:settings-loaded')
  const tabs = marks.get('startup:tabs-loaded')
  const skeletonShown = marks.get('startup:skeleton-shown')
  const skeletonHidden = marks.get('startup:skeleton-hidden')
  const bootstrapReceived = marks.get('startup:bootstrap-v2-received')
  const bootstrapApplied = marks.get('startup:bootstrap-v2-applied')
  const workspaceBundleRequested = marks.get('startup:workspace-bundle-requested')
  const workspaceBundleLoaded = marks.get('startup:workspace-bundle-loaded')

  return {
    rendererToReactMounted: fromRenderer('startup:react-mounted'),
    rendererToBackendReady: fromRenderer('startup:backend-ready'),
    rendererToSettingsLoaded: fromRenderer('startup:settings-loaded'),
    rendererToWorkspaceHydrated: fromRenderer('startup:workspace-hydrated'),
    rendererToFirstStableFrame: fromRenderer('startup:first-stable-frame'),
    settingsToTabsLoaded: settings === undefined || tabs === undefined
      ? undefined
      : roundedDuration(tabs - settings),
    skeletonShown: skeletonShown === undefined ? 0 : 1,
    skeletonVisibleMs: skeletonShown === undefined || skeletonHidden === undefined
      ? undefined
      : roundedDuration(skeletonHidden - skeletonShown),
    bootstrapApplyMs: bootstrapReceived === undefined || bootstrapApplied === undefined
      ? undefined
      : roundedDuration(bootstrapApplied - bootstrapReceived),
    workspaceBundleMs: workspaceBundleRequested === undefined || workspaceBundleLoaded === undefined
      ? undefined
      : roundedDuration(workspaceBundleLoaded - workspaceBundleRequested),
  }
}

export function getStartupDurations(): StartupDurations {
  if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') {
    return { skeletonShown: 0 }
  }
  const durations = startupDurationsFromMarks(
    performance.getEntriesByType('mark').map((entry) => ({ name: entry.name, startTime: entry.startTime })),
  )
  if (!bootstrapPayload) return durations
  return {
    ...durations,
    bootstrapVersion: bootstrapPayload.version,
    bootstrapPayloadBytes: bootstrapPayload.total,
    bootstrapSettingsBytes: bootstrapPayload.settings,
    bootstrapCollectionsBytes: bootstrapPayload.collections,
    bootstrapEnvironmentsBytes: bootstrapPayload.environments,
    bootstrapHostsBytes: bootstrapPayload.hosts,
    bootstrapTabsBytes: bootstrapPayload.tabs,
    bootstrapSettingsDecodeMs: bootstrapPayload.settingsDecodeMs,
    bootstrapCollectionsDecodeMs: bootstrapPayload.collectionsDecodeMs,
    bootstrapEnvironmentsDecodeMs: bootstrapPayload.environmentsDecodeMs,
    bootstrapHostsDecodeMs: bootstrapPayload.hostsDecodeMs,
    bootstrapTabsDecodeMs: bootstrapPayload.tabsDecodeMs,
  }
}

function measureStartup(name: string, start: StartupMarkName, end: StartupMarkName): void {
  if (recordedMeasures.has(name)) return
  if (typeof performance === 'undefined' || typeof performance.measure !== 'function') return
  try {
    performance.measure(name, start, end)
    recordedMeasures.add(name)
  } catch {
    // A missing mark or unsupported Performance API must never affect startup.
  }
}

function createStartupMeasures(): void {
  const rendererMeasures: Array<[string, StartupMarkName]> = [
    ['startup:renderer-to-react-mounted', 'startup:react-mounted'],
    ['startup:renderer-to-backend-ready', 'startup:backend-ready'],
    ['startup:renderer-to-settings-loaded', 'startup:settings-loaded'],
    ['startup:renderer-to-collections-loaded', 'startup:collections-loaded'],
    ['startup:renderer-to-environments-loaded', 'startup:environments-loaded'],
    ['startup:renderer-to-hosts-loaded', 'startup:hosts-loaded'],
    ['startup:renderer-to-tabs-loaded', 'startup:tabs-loaded'],
    ['startup:renderer-to-workspace-hydrated', 'startup:workspace-hydrated'],
    ['startup:renderer-to-first-stable-frame', 'startup:first-stable-frame'],
  ]
  for (const [name, end] of rendererMeasures) {
    measureStartup(name, 'startup:renderer-entry', end)
  }
  measureStartup('startup:settings-to-tabs-loaded', 'startup:settings-loaded', 'startup:tabs-loaded')
  measureStartup('startup:skeleton-visible', 'startup:skeleton-shown', 'startup:skeleton-hidden')
  measureStartup('startup:bootstrap-v2-apply', 'startup:bootstrap-v2-received', 'startup:bootstrap-v2-applied')
  measureStartup('startup:workspace-bundle-load', 'startup:workspace-bundle-requested', 'startup:workspace-bundle-loaded')
}

export function reportStartupPerformance(): StartupDurations {
  markStartup('startup:first-stable-frame')
  createStartupMeasures()
  const durations = getStartupDurations()
  if (import.meta.env.DEV) console.info('[startup performance]', durations)
  return durations
}
