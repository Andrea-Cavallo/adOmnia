import { create } from 'zustand'
import type { Snapshot } from '../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/resources/models'
import { currentActivityPhase } from './activity'
import { visibleInterval } from '@/lib/visiblePolling'
import { useAppStore } from './app'
import { resourceUiContext, type ResourceUiContext } from '@/lib/resourceObservation'

export type ResourceSnapshot = Snapshot & { uiContext?: ResourceUiContext }

interface ResourceState {
  sample: ResourceSnapshot | null
  failed: boolean
  samples: ResourceSnapshot[]
  recordUntil: number
  hasRecording: boolean
  starting: boolean
  scenario: string
}

export const useResourceRecording = create<ResourceState>(() => ({ sample: null, failed: false, samples: [], recordUntil: 0, hasRecording: false, starting: false, scenario: 'Observation' }))
let consumers = 0
let stopTimer: (() => void) | undefined
let pending: Promise<void> | undefined
let generation = 0

function poll(): Promise<void> {
  if (pending) return pending
  const epoch = generation
  pending = (async () => {
    try {
      const { ResourceUsage } = await import('../../bindings/github.com/Andrea-Cavallo/adOmnia/goide')
      const uiContext = resourceUiContext(useAppStore.getState().activeRail)
      const sample: ResourceSnapshot = { ...await ResourceUsage(), uiContext }
      if (epoch !== generation) return
      useResourceRecording.setState(state => ({ sample, failed: false, samples: (!state.hasRecording || state.recordUntil) && state.samples[state.samples.length - 1]?.at !== sample.at ? [...state.samples, sample].slice(-300) : state.samples }))
    } catch { if (epoch === generation) useResourceRecording.setState({ failed: true }) }
  })().finally(() => { pending = undefined })
  return pending
}

function schedule() {
  stopTimer?.(); stopTimer = undefined
  const { recordUntil, starting } = useResourceRecording.getState()
  if (starting) return
  if (recordUntil) {
    const epoch = generation
    const timer = globalThis.setInterval(() => {
      if (pending) return
      const finishing = Date.now() >= useResourceRecording.getState().recordUntil
      // Explicit recordings continue without any resource panel mounted, including inactivity.
      void poll().then(() => {
        const state = useResourceRecording.getState()
        if (finishing && epoch === generation && state.recordUntil) {
          useResourceRecording.setState({ recordUntil: 0 }); schedule()
        }
      })
    }, 1000)
    stopTimer = () => globalThis.clearInterval(timer)
  } else if (consumers) {
    stopTimer = visibleInterval(() => { if (currentActivityPhase() === 'Active') void poll() }, 5000, { kind: 'decorative' })
  }
}

/** Subscribe UI surfaces to one sampler; releasing the last surface never cancels a recording. */
export function acquireResourceSampling() {
  consumers++
  if (consumers === 1) {
    schedule()
    if (!useResourceRecording.getState().recordUntil && currentActivityPhase() === 'Active') void poll()
  }
  let released = false
  return () => { if (!released) { released = true; consumers--; if (!consumers && !useResourceRecording.getState().recordUntil) schedule() } }
}

export async function startResourceRecording(seconds: number) {
  if (useResourceRecording.getState().starting || useResourceRecording.getState().recordUntil) return
  if (![30, 60, 120].includes(seconds)) throw new Error('Choose a recording duration of 30, 60 or 120 seconds')
  useResourceRecording.setState({ starting: true }); schedule()
  await pending
  generation++
  try {
    const { ResetResourceBaseline } = await import('../../bindings/github.com/Andrea-Cavallo/adOmnia/goide')
    await ResetResourceBaseline()
  } catch { /* Samples still expose their measured CPU intervals when baseline reset is unavailable. */ }
  useResourceRecording.setState({ starting: false, samples: [], hasRecording: true, failed: false, recordUntil: Date.now() + seconds * 1000 })
  schedule(); await poll()
}

export function stopResourceRecording() {
  generation++
  useResourceRecording.setState({ recordUntil: 0 }); schedule()
}

export function resumeResourceHistory() {
  generation++
  useResourceRecording.setState({ samples: [], hasRecording: false, recordUntil: 0 }); schedule()
}

export const setResourceScenario = (scenario: string) => useResourceRecording.setState({ scenario })
