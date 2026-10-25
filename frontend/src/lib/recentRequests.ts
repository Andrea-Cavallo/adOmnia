import type { RequestHistoryEntry } from './types'

/** One request the Hub can offer again: the newest send per method + URL. */
export interface RecentRequest {
  /** History entry id, used to reopen the captured response in a tab. */
  id: string
  method: string
  name: string
  url: string
  status: number
  /** Network error or HTTP >= 400: status colours stay semantic on the Hub. */
  failed: boolean
  recordedAt: number
}

/**
 * Newest-first requests for the Hub. Entries without captured request metadata
 * cannot be reopened, and repeating the same method + URL would fill the list
 * with the same call, so only the latest send of each call survives.
 */
export function recentRequests(entries: readonly RequestHistoryEntry[], limit = 5): RecentRequest[] {
  const seen = new Set<string>()
  const result: RecentRequest[] = []
  for (const entry of entries) {
    if (!entry.request) continue
    const method = entry.request.method || 'GET'
    const url = entry.request.url || ''
    const key = `${method} ${url}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({
      id: entry.id,
      method,
      name: entry.request.name || url || 'Untitled request',
      url,
      status: entry.response.error ? 0 : entry.response.status,
      failed: Boolean(entry.response.error) || entry.response.status >= 400,
      recordedAt: entry.recordedAt ? Date.parse(entry.recordedAt) || 0 : 0,
    })
    if (result.length >= limit) break
  }
  return result
}
