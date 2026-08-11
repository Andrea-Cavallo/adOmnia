import { safeSetItem } from '@/lib/safeLocalStorage'

export const WORKSPACE_STARTUP_HINT_KEY = 'adomnia.startupHints.v1'
export const FAST_WORKSPACE_HYDRATION_MAX_MS = 220
export const FAST_WORKSPACE_SHELL_DELAY_MS = 260
export const FAST_WORKSPACE_SHELL_MIN_VISIBLE_MS = 120
export const DEFAULT_WORKSPACE_SHELL_DELAY_MS = 120
export const DEFAULT_WORKSPACE_SHELL_MIN_VISIBLE_MS = 180
export const WORKSPACE_STARTUP_HINT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

const WORKSPACE_STARTUP_HINT_MAX_DURATION_MS = 5 * 60 * 1000
const WORKSPACE_STARTUP_HINT_FUTURE_TOLERANCE_MS = 5 * 60 * 1000

export type WorkspaceStartupProfile = 'fast' | 'slow'

export interface WorkspaceStartupHintV1 {
  version: 1
  completed: true
  workspaceHydrationMs: number
  profile: WorkspaceStartupProfile
  recordedAt: string
}

export interface WorkspaceShellTiming {
  profile: WorkspaceStartupProfile | 'default'
  delayMs: number
  minVisibleMs: number
}

export function classifyWorkspaceStartup(workspaceHydrationMs: number): WorkspaceStartupProfile {
  return workspaceHydrationMs <= FAST_WORKSPACE_HYDRATION_MAX_MS ? 'fast' : 'slow'
}

export function createWorkspaceStartupHint(
  workspaceHydrationMs: number,
  nowMs = Date.now(),
): WorkspaceStartupHintV1 | null {
  if (!Number.isFinite(workspaceHydrationMs)) return null
  if (workspaceHydrationMs < 0 || workspaceHydrationMs > WORKSPACE_STARTUP_HINT_MAX_DURATION_MS) return null
  if (!Number.isFinite(nowMs)) return null

  return {
    version: 1,
    completed: true,
    workspaceHydrationMs,
    profile: classifyWorkspaceStartup(workspaceHydrationMs),
    recordedAt: new Date(nowMs).toISOString(),
  }
}

export function parseWorkspaceStartupHint(
  raw: string | null,
  nowMs = Date.now(),
): WorkspaceStartupHintV1 | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceStartupHintV1>
    if (parsed.version !== 1 || parsed.completed !== true) return null
    if (typeof parsed.workspaceHydrationMs !== 'number') return null
    if (!Number.isFinite(parsed.workspaceHydrationMs)) return null
    if (parsed.workspaceHydrationMs < 0 || parsed.workspaceHydrationMs > WORKSPACE_STARTUP_HINT_MAX_DURATION_MS) return null
    if (parsed.profile !== classifyWorkspaceStartup(parsed.workspaceHydrationMs)) return null
    if (typeof parsed.recordedAt !== 'string') return null

    const recordedAtMs = Date.parse(parsed.recordedAt)
    if (!Number.isFinite(recordedAtMs)) return null
    if (recordedAtMs > nowMs + WORKSPACE_STARTUP_HINT_FUTURE_TOLERANCE_MS) return null
    if (nowMs - recordedAtMs > WORKSPACE_STARTUP_HINT_MAX_AGE_MS) return null

    return parsed as WorkspaceStartupHintV1
  } catch {
    return null
  }
}

export function loadWorkspaceStartupHint(nowMs = Date.now()): WorkspaceStartupHintV1 | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return parseWorkspaceStartupHint(localStorage.getItem(WORKSPACE_STARTUP_HINT_KEY), nowMs)
  } catch {
    return null
  }
}

export function saveWorkspaceStartupHint(workspaceHydrationMs: number, nowMs = Date.now()): void {
  const hint = createWorkspaceStartupHint(workspaceHydrationMs, nowMs)
  if (!hint) return
  safeSetItem(WORKSPACE_STARTUP_HINT_KEY, JSON.stringify(hint))
}

export function workspaceShellTimingFromHint(
  hint: WorkspaceStartupHintV1 | null,
): WorkspaceShellTiming {
  if (hint?.profile === 'fast') {
    return {
      profile: 'fast',
      delayMs: FAST_WORKSPACE_SHELL_DELAY_MS,
      minVisibleMs: FAST_WORKSPACE_SHELL_MIN_VISIBLE_MS,
    }
  }
  return {
    profile: hint?.profile ?? 'default',
    delayMs: DEFAULT_WORKSPACE_SHELL_DELAY_MS,
    minVisibleMs: DEFAULT_WORKSPACE_SHELL_MIN_VISIBLE_MS,
  }
}
