import type { FlowStressConfig, StressRun } from '@/lib/flowStress'
import type { StressStats } from '@/lib/flowStressStats'
import { safeSetItem } from '@/lib/safeLocalStorage'

export interface StressHistoryEntry {
  flowName: string
  startedAt: string
  status: StressRun['status']
  config: FlowStressConfig
  stats: StressStats
}

const keyFor = (flowName: string) => `adomnia.flow-stress.history.${encodeURIComponent(flowName.trim().toLowerCase())}`

export function loadStressHistory(flowName: string): StressHistoryEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(keyFor(flowName)) || '[]')
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.startedAt === 'string' && item.stats?.overall) : []
  } catch { return [] }
}

export function saveStressHistory(flowName: string, run: StressRun): StressHistoryEntry[] {
  const next = [{ flowName, startedAt: run.startedAt, status: run.status, config: run.config, stats: run.stats }, ...loadStressHistory(flowName)]
    .filter((item, index, all) => all.findIndex((candidate) => candidate.startedAt === item.startedAt) === index)
    .slice(0, 12)
  safeSetItem(keyFor(flowName), JSON.stringify(next))
  return next
}
