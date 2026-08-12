import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WORKSPACE_SHELL_DELAY_MS,
  DEFAULT_WORKSPACE_SHELL_MIN_VISIBLE_MS,
  FAST_WORKSPACE_HYDRATION_MAX_MS,
  FAST_WORKSPACE_SHELL_DELAY_MS,
  FAST_WORKSPACE_SHELL_MIN_VISIBLE_MS,
  WORKSPACE_STARTUP_HINT_MAX_AGE_MS,
  classifyWorkspaceStartup,
  createWorkspaceStartupHint,
  parseWorkspaceStartupHint,
  workspaceShellTimingFromHint,
} from './startupHints'

const now = Date.parse('2026-08-11T12:00:00.000Z')

describe('workspace startup hints', () => {
  it('classifies completed hydration around the fast threshold', () => {
    expect(classifyWorkspaceStartup(FAST_WORKSPACE_HYDRATION_MAX_MS)).toBe('fast')
    expect(classifyWorkspaceStartup(FAST_WORKSPACE_HYDRATION_MAX_MS + 0.1)).toBe('slow')
  })

  it('creates a timing-only versioned hint', () => {
    expect(createWorkspaceStartupHint(166, now)).toEqual({
      version: 1,
      completed: true,
      workspaceHydrationMs: 166,
      profile: 'fast',
      recordedAt: '2026-08-11T12:00:00.000Z',
    })
  })

  it('uses adaptive timing only for a validated fast hint', () => {
    const fast = createWorkspaceStartupHint(166, now)
    expect(workspaceShellTimingFromHint(fast)).toEqual({
      profile: 'fast',
      delayMs: FAST_WORKSPACE_SHELL_DELAY_MS,
      minVisibleMs: FAST_WORKSPACE_SHELL_MIN_VISIBLE_MS,
    })
    expect(workspaceShellTimingFromHint(createWorkspaceStartupHint(438, now))).toEqual({
      profile: 'slow',
      delayMs: DEFAULT_WORKSPACE_SHELL_DELAY_MS,
      minVisibleMs: DEFAULT_WORKSPACE_SHELL_MIN_VISIBLE_MS,
    })
    expect(workspaceShellTimingFromHint(null).profile).toBe('default')
  })

  it('rejects corrupt, incomplete, inconsistent and stale payloads', () => {
    const valid = createWorkspaceStartupHint(166, now)
    expect(parseWorkspaceStartupHint(JSON.stringify(valid), now)).toEqual(valid)
    expect(parseWorkspaceStartupHint('{', now)).toBeNull()
    expect(parseWorkspaceStartupHint(JSON.stringify({ ...valid, completed: false }), now)).toBeNull()
    expect(parseWorkspaceStartupHint(JSON.stringify({ ...valid, profile: 'slow' }), now)).toBeNull()
    expect(parseWorkspaceStartupHint(JSON.stringify({ ...valid, workspaceHydrationMs: -1 }), now)).toBeNull()
    expect(parseWorkspaceStartupHint(JSON.stringify({ ...valid, recordedAt: 'invalid' }), now)).toBeNull()
    expect(parseWorkspaceStartupHint(
      JSON.stringify({ ...valid, recordedAt: new Date(now - WORKSPACE_STARTUP_HINT_MAX_AGE_MS - 1).toISOString() }),
      now,
    )).toBeNull()
  })

  it('does not create unfinished or implausible hints', () => {
    expect(createWorkspaceStartupHint(Number.NaN, now)).toBeNull()
    expect(createWorkspaceStartupHint(-1, now)).toBeNull()
    expect(createWorkspaceStartupHint(10 * 60 * 1000, now)).toBeNull()
  })
})
