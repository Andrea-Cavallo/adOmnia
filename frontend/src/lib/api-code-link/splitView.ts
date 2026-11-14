import { create } from 'zustand'

/** Where the code side sits when Code Studio and the API workspace share the window. */
export type SplitSide = 'code-left' | 'code-right'

export interface SplitPreferences {
  side: SplitSide
  /** Width of the code pane, as a fraction of the split. */
  ratio: number
  /** Where code sits in the Diagram Studio pair: the diagram is on the left by default. */
  diagramSide: SplitSide
}

export const SPLIT_PREFERENCES_KEY = 'adomnia.apiCode.split.v1'
export const DEFAULT_SPLIT_PREFERENCES: SplitPreferences = { side: 'code-left', ratio: 0.55, diagramSide: 'code-right' }
export const MIN_SPLIT_RATIO = 0.25
export const MAX_SPLIT_RATIO = 0.75

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export function normalizeSplitSide(value: unknown): SplitSide {
  return value === 'code-right' ? 'code-right' : 'code-left'
}

export function clampSplitRatio(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SPLIT_PREFERENCES.ratio
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, value))
}

function storageOrNull(storage?: StorageLike): StorageLike | null {
  if (storage) return storage
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function loadSplitPreferences(storage?: StorageLike): SplitPreferences {
  const target = storageOrNull(storage)
  if (!target) return DEFAULT_SPLIT_PREFERENCES
  try {
    const raw = target.getItem(SPLIT_PREFERENCES_KEY)
    if (!raw) return DEFAULT_SPLIT_PREFERENCES
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      side: normalizeSplitSide(parsed.side),
      ratio: clampSplitRatio(parsed.ratio),
      // Files written before the diagram pair existed fall back to the diagram-on-the-left default.
      diagramSide: parsed.diagramSide === undefined ? DEFAULT_SPLIT_PREFERENCES.diagramSide : normalizeSplitSide(parsed.diagramSide),
    }
  } catch {
    return DEFAULT_SPLIT_PREFERENCES
  }
}

export function saveSplitPreferences(preferences: SplitPreferences, storage?: StorageLike): SplitPreferences {
  const normalized = {
    side: normalizeSplitSide(preferences.side),
    ratio: clampSplitRatio(preferences.ratio),
    diagramSide: normalizeSplitSide(preferences.diagramSide),
  }
  const target = storageOrNull(storage)
  if (target) {
    try {
      target.setItem(SPLIT_PREFERENCES_KEY, JSON.stringify(normalized))
    } catch {
      // A full storage must never break the workspace layout.
    }
  }
  return normalized
}

interface SplitViewState extends SplitPreferences {
  setSide: (side: SplitSide) => void
  setRatio: (ratio: number) => void
  reverse: () => void
  /** Reverses the pair the split is showing. */
  reverseFor: (pair: 'api' | 'diagram') => void
}

const initial = loadSplitPreferences()
let saveTimer: ReturnType<typeof setTimeout> | undefined

function scheduleSave(preferences: SplitPreferences): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = undefined
    saveSplitPreferences(preferences)
  }, 200)
}

/** Layout of the shared window, remembered across launches. */
export const useSplitViewStore = create<SplitViewState>((set, get) => ({
  ...initial,
  setSide: (side) => {
    const next = saveSplitPreferences({ ...get(), side })
    set(next)
  },
  setRatio: (ratio) => {
    const next = { ...get(), ratio: clampSplitRatio(ratio) }
    scheduleSave(next)
    set({ ratio: next.ratio })
  },
  reverse: () => {
    const next = saveSplitPreferences({ ...get(), side: get().side === 'code-left' ? 'code-right' : 'code-left' })
    set({ side: next.side })
  },
  reverseFor: (pair) => {
    if (pair === 'api') { get().reverse(); return }
    const next = saveSplitPreferences({ ...get(), diagramSide: get().diagramSide === 'code-left' ? 'code-right' : 'code-left' })
    set({ diagramSide: next.diagramSide })
  },
}))
