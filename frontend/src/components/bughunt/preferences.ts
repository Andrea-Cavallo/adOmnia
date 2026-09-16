export type BugHuntPreferences = { audio: boolean; reducedMotion: boolean; bestSeconds: number | null; bestBits: number }
const KEY = 'adomnia.bughunt.preferences.v1'

export function loadPreferences(): BugHuntPreferences {
  const defaults: BugHuntPreferences = { audio: true, reducedMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches, bestSeconds: null, bestBits: 0 }
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (!raw || typeof raw !== 'object') return defaults
    return {
      audio: typeof raw.audio === 'boolean' ? raw.audio : defaults.audio,
      reducedMotion: typeof raw.reducedMotion === 'boolean' ? raw.reducedMotion : defaults.reducedMotion,
      bestSeconds: typeof raw.bestSeconds === 'number' && Number.isFinite(raw.bestSeconds) && raw.bestSeconds > 0 ? raw.bestSeconds : null,
      bestBits: typeof raw.bestBits === 'number' && Number.isInteger(raw.bestBits) && raw.bestBits >= 0 ? raw.bestBits : 0,
    }
  } catch { return defaults }
}

export function savePreferences(preferences: BugHuntPreferences) {
  try { localStorage.setItem(KEY, JSON.stringify(preferences)) } catch { /* a full/disabled store must not interrupt a run */ }
}

export function formatTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds) % 60).padStart(2, '0')}`
}
