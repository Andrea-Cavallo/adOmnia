import { afterEach, describe, expect, it, vi } from 'vitest'

import { autoSaveDelayValue, cancelAutoSave, pendingAutoSave, scheduleAutoSave, setAutoSaveDelay, setAutoSaveHandler } from './codeStudioAutoSave'

afterEach(() => { vi.useRealTimers(); setAutoSaveHandler(null); setAutoSaveDelay(0) })

describe('codeStudioAutoSave', () => {
  it('saves only after a pause in typing, restarting the timer on every edit', () => {
    vi.useFakeTimers()
    const save = vi.fn()
    setAutoSaveHandler(save)
    setAutoSaveDelay(1000)
    scheduleAutoSave()
    vi.advanceTimersByTime(999)
    expect(save).not.toHaveBeenCalled()
    scheduleAutoSave()
    vi.advanceTimersByTime(999)
    expect(save).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('ignores edits while disabled or without a handler', () => {
    vi.useFakeTimers()
    const save = vi.fn()
    setAutoSaveHandler(save)
    setAutoSaveDelay(0)
    scheduleAutoSave()
    setAutoSaveDelay(1000)
    setAutoSaveHandler(null)
    scheduleAutoSave()
    vi.advanceTimersByTime(5000)
    expect(save).not.toHaveBeenCalled()
  })

  it('cancel drops the pending save', () => {
    vi.useFakeTimers()
    const save = vi.fn()
    setAutoSaveHandler(save)
    setAutoSaveDelay(500)
    scheduleAutoSave()
    expect(pendingAutoSave()).toBe(true)
    cancelAutoSave()
    expect(pendingAutoSave()).toBe(false)
    vi.advanceTimersByTime(5000)
    expect(save).not.toHaveBeenCalled()
  })

  it('disabling the delay cancels a pending save', () => {
    vi.useFakeTimers()
    const save = vi.fn()
    setAutoSaveHandler(save)
    setAutoSaveDelay(500)
    scheduleAutoSave()
    setAutoSaveDelay(0)
    vi.advanceTimersByTime(5000)
    expect(save).not.toHaveBeenCalled()
  })

  it('clamps invalid delays to a safe value', () => {
    expect(autoSaveDelayValue(undefined)).toBe(0)
    expect(autoSaveDelayValue('5000')).toBe(0)
    expect(autoSaveDelayValue(Number.NaN)).toBe(0)
    expect(autoSaveDelayValue(-10)).toBe(0)
    expect(autoSaveDelayValue(1234.5)).toBe(1235)
    expect(autoSaveDelayValue(120000)).toBe(60000)
  })
})
