import type { MongoQueryState } from './MongoQueryBar'

/** One query run from the Explorer query bar, remembered per collection (Compass "Recent" / "Favorites"). */
export interface MongoQueryEntry {
  id: string
  db: string
  collection: string
  query: MongoQueryState
  at: number
  favorite: boolean
  name?: string
}

export const MONGO_HISTORY_KEY = 'adomnia.database.mongoQueryHistory'
const RECENT_PER_COLLECTION = 30

const sameQuery = (a: MongoQueryState, b: MongoQueryState) =>
  a.filter.trim() === b.filter.trim() && a.project.trim() === b.project.trim() && a.sort.trim() === b.sort.trim()
  && a.skip.trim() === b.skip.trim() && a.limit.trim() === b.limit.trim()
  && (a.collation ?? '').trim() === (b.collation ?? '').trim() && (a.hint ?? '').trim() === (b.hint ?? '').trim()
  && (a.maxTimeMS ?? '').trim() === (b.maxTimeMS ?? '').trim()

/** True when the query bar holds nothing worth remembering (the default find). */
export function isDefaultQuery(q: MongoQueryState): boolean {
  return !q.filter.trim() && !q.project.trim() && !q.sort.trim() && !q.skip.trim() && !q.collation?.trim() && !q.hint?.trim()
}

/** Records a run: an identical query moves to the top, recents beyond the cap are dropped, favorites are kept. */
export function recordQuery(entries: MongoQueryEntry[], db: string, collection: string, query: MongoQueryState, now = Date.now()): MongoQueryEntry[] {
  if (isDefaultQuery(query)) return entries
  const existing = entries.find((e) => e.db === db && e.collection === collection && sameQuery(e.query, query))
  const entry: MongoQueryEntry = existing
    ? { ...existing, at: now }
    : { id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, db, collection, query, at: now, favorite: false }
  const rest = entries.filter((e) => e !== existing)
  const next = [entry, ...rest]
  let recent = 0
  return next.filter((e) => {
    if (e.db !== db || e.collection !== collection || e.favorite) return true
    recent += 1
    return recent <= RECENT_PER_COLLECTION
  })
}

export function toggleFavorite(entries: MongoQueryEntry[], id: string, name?: string): MongoQueryEntry[] {
  return entries.map((e) => (e.id === id ? { ...e, favorite: !e.favorite, name: e.favorite ? undefined : name || e.name } : e))
}

export function removeEntry(entries: MongoQueryEntry[], id: string): MongoQueryEntry[] {
  return entries.filter((e) => e.id !== id)
}

export function entriesFor(entries: MongoQueryEntry[], db: string, collection: string) {
  const own = entries.filter((e) => e.db === db && e.collection === collection).sort((a, b) => b.at - a.at)
  return { favorites: own.filter((e) => e.favorite), recent: own.filter((e) => !e.favorite) }
}

/** Short one-line summary shown in the history list. */
export function describeQuery(q: MongoQueryState): string {
  const parts = [q.filter.trim() || '{}']
  if (q.project.trim()) parts.push(`project ${q.project.trim()}`)
  if (q.sort.trim()) parts.push(`sort ${q.sort.trim()}`)
  if (q.skip.trim()) parts.push(`skip ${q.skip.trim()}`)
  if (q.limit.trim() && q.limit.trim() !== '20') parts.push(`limit ${q.limit.trim()}`)
  if (q.collation?.trim()) parts.push(`collation ${q.collation.trim()}`)
  if (q.hint?.trim()) parts.push(`hint ${q.hint.trim()}`)
  return parts.join(' · ')
}

export function loadHistory(): MongoQueryEntry[] {
  try {
    const raw = localStorage.getItem(MONGO_HISTORY_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((e): e is MongoQueryEntry => !!e && typeof e === 'object' && 'query' in e && 'db' in e) : []
  } catch {
    return []
  }
}

export function saveHistory(entries: MongoQueryEntry[]): void {
  try { localStorage.setItem(MONGO_HISTORY_KEY, JSON.stringify(entries)) } catch { /* quota or private mode: history is a convenience */ }
}
