import type { Difficulty } from './difficulty'
export type BugHuntPreferences = { audio: boolean; reducedMotion: boolean; bestSeconds: number | null; bestBits: number; bestScore: number }
const KEY = 'adomnia.bughunt.preferences.desk-arenas.v6'
const PREVIOUS_KEY = 'adomnia.bughunt.preferences.developer-world.v5'

export function loadPreferences(difficulty: Difficulty = 'production'): BugHuntPreferences {
  const defaults: BugHuntPreferences = { audio: true, reducedMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches, bestSeconds: null, bestBits: 0, bestScore: 0 }
  try {
    const campaign = localStorage.getItem(difficulty === 'production' ? KEY : `${KEY}.${difficulty}`)
    const legacy = campaign ? null : JSON.parse((difficulty !== 'production' ? localStorage.getItem(KEY) : null) ?? localStorage.getItem(difficulty === 'production' ? PREVIOUS_KEY : `${PREVIOUS_KEY}.${difficulty}`) ?? localStorage.getItem(PREVIOUS_KEY) ?? localStorage.getItem('adomnia.bughunt.preferences.three-lives.v4') ?? localStorage.getItem('adomnia.bughunt.preferences.arcade.v3') ?? localStorage.getItem('adomnia.bughunt.preferences.campaign.v2') ?? localStorage.getItem('adomnia.bughunt.preferences.v1') ?? 'null')
    const raw = campaign ? JSON.parse(campaign) : legacy ? { audio: legacy.audio, reducedMotion: legacy.reducedMotion } : null
    if (!raw || typeof raw !== 'object') return defaults
    return {
      audio: typeof raw.audio === 'boolean' ? raw.audio : defaults.audio,
      reducedMotion: typeof raw.reducedMotion === 'boolean' ? raw.reducedMotion : defaults.reducedMotion,
      bestSeconds: typeof raw.bestSeconds === 'number' && Number.isFinite(raw.bestSeconds) && raw.bestSeconds > 0 ? raw.bestSeconds : null,
      bestScore: typeof raw.bestScore === 'number' && Number.isSafeInteger(raw.bestScore) && raw.bestScore >= 0 ? raw.bestScore : 0,
      bestBits: typeof raw.bestBits === 'number' && Number.isInteger(raw.bestBits) && raw.bestBits >= 0 ? raw.bestBits : 0,
    }
  } catch { return defaults }
}

export function savePreferences(preferences: BugHuntPreferences, difficulty: Difficulty = 'production') {
  try { localStorage.setItem(difficulty === 'production' ? KEY : `${KEY}.${difficulty}`,  JSON.stringify(preferences)) } catch { /* a full/disabled store must not interrupt a run */ }
}

export function formatTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds) % 60).padStart(2, '0')}`
}
