import type { LoadInputs, LoadMode } from './loadTestPlan'

export interface LoadScenario extends LoadInputs { mode: LoadMode; timeoutMs: number }

export function restoreLoadScenario(data: Record<string, unknown>, current: LoadScenario): LoadScenario {
  const next = { ...current }
  for (const key of ['concurrency', 'totalReqs', 'durationS', 'warmupReqs', 'rampUpS', 'thinkTimeMs', 'burst', 'gapRequests', 'gapMs', 'rps', 'maxVUs', 'timeoutMs'] as const) {
    const value = data[key]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) next[key] = value
  }
  next.mode = ['burst', 'gap', 'load', 'rate'].includes(String(data.mode)) ? data.mode as LoadMode : 'load'
  next.useDuration = typeof data.useDuration === 'boolean' ? data.useDuration : Number(data.durationS ?? 0) > 0 && Number(data.totalReqs ?? 0) === 0
  return next
}

export function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
