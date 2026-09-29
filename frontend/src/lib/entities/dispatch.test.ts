import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/stores/app'
import { handoffToPanel } from './dispatch'
import { clearEntityNotice, useEntityNotice } from './notice'
import type { EntityRef } from './types'

const ref: EntityRef = { kind: 'datasource', id: 'datasource:postgres@localhost:5432', label: 'postgres@localhost:5432', attrs: {} }

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); clearEntityNotice() })

describe('handoffToPanel', () => {
  it('tells the user when the panel never accepts the handoff (time-based, not frame-based)', () => {
    const frames: Array<() => void> = []
    let now = 0
    vi.stubGlobal('window', { dispatchEvent: vi.fn(), requestAnimationFrame: (cb: () => void) => { frames.push(cb); return frames.length } })
    vi.stubGlobal('document', { dispatchEvent: vi.fn() })
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    handoffToPanel('database', ref, 'connect')
    expect(useAppStore.getState().activeRail).toBe('database')
    // 200 frames within 2 s must keep retrying (a 144 Hz display would give up early with a frame cap)
    for (let i = 0; i < 200 && frames.length; i++) { now += 10; frames.shift()!() }
    expect(frames.length).toBe(1)
    expect(useEntityNotice.getState().notice).toBeNull()
    now += 10_000
    frames.shift()!()
    expect(frames.length).toBe(0)
    expect(useEntityNotice.getState().notice?.message).toMatch(/postgres@localhost:5432/)
  })
})
