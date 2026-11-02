import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Snapshot } from '../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/resources/models'

vi.mock('../../bindings/github.com/Andrea-Cavallo/adOmnia/goide', () => ({
  ResetResourceBaseline: vi.fn(async () => {}),
  ResourceUsage: vi.fn(async () => ({ at: new Date().toISOString(), processes: [], ram: 1024, cpu: 1 } as unknown as Snapshot)),
}))
vi.mock('./app', () => ({ useAppStore: { getState: () => ({ activeRail: 'codestudio' }) } }))
vi.mock('./activity', () => ({ currentActivityPhase: vi.fn(() => 'Active') }))
vi.mock('@/lib/visiblePolling', () => ({ visibleInterval: (callback: () => void, ms: number) => { const id = setInterval(callback, ms); return () => clearInterval(id) } }))

import { ResourceUsage } from '../../bindings/github.com/Andrea-Cavallo/adOmnia/goide'
import { acquireResourceSampling, resumeResourceHistory, startResourceRecording, stopResourceRecording, useResourceRecording } from './resourceRecording'
import { registerResourceStudioContext } from '@/lib/resourceObservation'
import { currentActivityPhase } from './activity'

afterEach(() => { resumeResourceHistory(); vi.useRealTimers(); vi.clearAllMocks(); vi.mocked(currentActivityPhase).mockReturnValue('Active') })

describe('application-wide resource recording', () => {
  it('retains a full 60 s recording across Hub unmount, an interval with no UI and Code Studio remount', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-01T10:00:00Z'))
    const hub = acquireResourceSampling()
    await startResourceRecording(60)
    await vi.advanceTimersByTimeAsync(5000)
    hub()
    const count = useResourceRecording.getState().samples.length
    await vi.advanceTimersByTimeAsync(10000)
    expect(useResourceRecording.getState().samples.length).toBe(count + 10)
    const studio = acquireResourceSampling()
    await vi.advanceTimersByTimeAsync(45000)
    studio()
    const recorded = useResourceRecording.getState()
    expect(recorded.recordUntil).toBe(0)
    expect(recorded.hasRecording).toBe(true)
    expect(recorded.samples).toHaveLength(61)
    expect(Date.parse(recorded.samples[60].at) - Date.parse(recorded.samples[0].at)).toBe(60000)
    await vi.advanceTimersByTimeAsync(10000)
    expect(useResourceRecording.getState().samples).toBe(recorded.samples)
  })

  it('shares one sampler between panels and preserves the stopped recording for export', async () => {
    vi.useFakeTimers()
    const first = acquireResourceSampling(), second = acquireResourceSampling()
    await startResourceRecording(30)
    vi.mocked(ResourceUsage).mockClear()
    await vi.advanceTimersByTimeAsync(3000)
    expect(ResourceUsage).toHaveBeenCalledTimes(3)
    stopResourceRecording()
    const samples = useResourceRecording.getState().samples
    await vi.advanceTimersByTimeAsync(10000)
    expect(useResourceRecording.getState().samples).toBe(samples)
    first(); second()
  })

  it('captures available editor context without source code', async () => {
    vi.useFakeTimers()
    const unregister = registerResourceStudioContext(() => ({ openDocuments: 24, modifiedDocuments: 2, activeFile: 'service.go' }))
    await startResourceRecording(30)
    expect(useResourceRecording.getState().samples[0].uiContext).toEqual({ view: 'codestudio', openDocuments: 24, modifiedDocuments: 2, activeFile: 'service.go' })
    unregister(); stopResourceRecording()
  })

  it('continues explicit recordings during inactivity and recovers after a failed sample', async () => {
    vi.useFakeTimers()
    vi.mocked(currentActivityPhase).mockReturnValue('Background')
    await startResourceRecording(30)
    vi.mocked(ResourceUsage).mockRejectedValueOnce(new Error('temporary process read failure'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(useResourceRecording.getState().failed).toBe(true)
    await vi.advanceTimersByTimeAsync(29000)
    expect(useResourceRecording.getState().failed).toBe(false)
    expect(useResourceRecording.getState().recordUntil).toBe(0)
    expect(useResourceRecording.getState().samples).toHaveLength(30)
  })
})
