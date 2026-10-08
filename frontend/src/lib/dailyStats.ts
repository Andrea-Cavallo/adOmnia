// Per-day request counter for the Hub. Kept apart from response history so it
// still counts when history is size-limited or saving responses is disabled.
const KEY = 'adomnia.hub.today'
export const DAILY_STATS_EVENT = 'adomnia:daily-stats'

export interface DailyStats { day: string; requests: number; errors: number }

export const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function readDailyStats(now = new Date()): DailyStats {
  const day = localDay(now)
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as DailyStats | null
    if (s && s.day === day) return { day, requests: Number(s.requests) || 0, errors: Number(s.errors) || 0 }
  } catch { /* corrupt or blocked storage: start the day from zero */ }
  return { day, requests: 0, errors: 0 }
}

export function recordDailyRequest(isError: boolean, now = new Date()): DailyStats {
  const prev = readDailyStats(now)
  const next = { ...prev, requests: prev.requests + 1, errors: prev.errors + (isError ? 1 : 0) }
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* storage unavailable */ }
  window.dispatchEvent(new CustomEvent(DAILY_STATS_EVENT))
  return next
}
