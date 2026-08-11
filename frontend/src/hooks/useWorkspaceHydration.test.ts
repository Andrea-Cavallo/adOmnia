import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  remainingWorkspaceShellTime,
  scheduleWorkspaceSkeleton,
  WORKSPACE_SHELL_MIN_VISIBLE_MS,
} from './useWorkspaceHydration'
import {
  FAST_WORKSPACE_SHELL_DELAY_MS,
  FAST_WORKSPACE_SHELL_MIN_VISIBLE_MS,
} from '@/lib/startupHints'

afterEach(() => {
  vi.useRealTimers()
})

describe('workspace hydration shell timing', () => {
  it('holds a visible skeleton for the configured minimum', () => {
    expect(remainingWorkspaceShellTime(100, 140)).toBe(WORKSPACE_SHELL_MIN_VISIBLE_MS - 40)
    expect(remainingWorkspaceShellTime(100, 100 + WORKSPACE_SHELL_MIN_VISIBLE_MS)).toBe(0)
    expect(remainingWorkspaceShellTime(100, 1000)).toBe(0)
  })

  it('delays the skeleton for a previously fast profile', () => {
    vi.useFakeTimers()
    const show = vi.fn()
    scheduleWorkspaceSkeleton(FAST_WORKSPACE_SHELL_DELAY_MS, show)

    vi.advanceTimersByTime(FAST_WORKSPACE_SHELL_DELAY_MS - 1)
    expect(show).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(show).toHaveBeenCalledOnce()
  })

  it('cancels the scheduled skeleton when hydration wins the race', () => {
    vi.useFakeTimers()
    const show = vi.fn()
    const cancel = scheduleWorkspaceSkeleton(FAST_WORKSPACE_SHELL_DELAY_MS, show)

    vi.advanceTimersByTime(150)
    cancel()
    vi.advanceTimersByTime(FAST_WORKSPACE_SHELL_DELAY_MS)
    expect(show).not.toHaveBeenCalled()
  })

  it('holds feedback briefly if a previously fast profile regresses', () => {
    expect(remainingWorkspaceShellTime(260, 300, FAST_WORKSPACE_SHELL_MIN_VISIBLE_MS))
      .toBe(FAST_WORKSPACE_SHELL_MIN_VISIBLE_MS - 40)
  })
})
