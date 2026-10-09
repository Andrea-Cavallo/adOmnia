import { normalizeRailItem, type RailItem } from '@/lib/navigation'
import { safeSetItem } from '@/lib/safeLocalStorage'

export interface HubLayout {
  tiles: RailItem[]
  todaySide: 'left' | 'right'
}

const KEY = 'adomnia.hubLayout'
export const DEFAULT_HUB_LAYOUT: HubLayout = {
  tiles: ['goide', 'collections', 'database', 'jsonviewer', 'gitsync', 'powertools'],
  todaySide: 'right',
}
/** Rails that make no sense as a Hub tile. */
export const HUB_EXCLUDED = new Set<RailItem>(['welcome', 'settings'])

export function parseHubLayout(raw: string | null): HubLayout {
  try {
    const data = raw ? JSON.parse(raw) : null
    if (!data || !Array.isArray(data.tiles)) return DEFAULT_HUB_LAYOUT
    const tiles = [...new Set(data.tiles.map(normalizeRailItem).filter((t: RailItem | null): t is RailItem => !!t && !HUB_EXCLUDED.has(t)))] as RailItem[]
    return { tiles, todaySide: data.todaySide === 'left' ? 'left' : 'right' }
  } catch {
    return DEFAULT_HUB_LAYOUT
  }
}

export function loadHubLayout(): HubLayout {
  try { return parseHubLayout(localStorage.getItem(KEY)) } catch { return DEFAULT_HUB_LAYOUT }
}

export function saveHubLayout(layout: HubLayout) {
  safeSetItem(KEY, JSON.stringify(layout))
}

/** Returns a new list with the item at `from` moved to `to` (clamped). */
export function moveTile<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list]
  const target = Math.max(0, Math.min(next.length - 1, to))
  if (from < 0 || from >= next.length || from === target) return next
  const [item] = next.splice(from, 1)
  next.splice(target, 0, item)
  return next
}
