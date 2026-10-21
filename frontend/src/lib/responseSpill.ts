import { StorageGet, StoragePut } from '@/wailsjs/go/main/App'
import type { RequestHistoryEntry, ResponseData, Tab } from './types'

// Large response bodies are persisted outside the session JSON: the session
// keeps a preview and a reference, and the full text is read when the response
// is opened again. This is the "body on disk + preview" rule of the memory review.
export const RESPONSE_SPILL_BYTES = 1024 * 1024
export const RESPONSE_PREVIEW_CHARS = 32 * 1024

const BUCKET = 'tabs'
const KEY_PREFIX = 'response-body:'

export interface BodyStore {
  get(key: string): Promise<string>
  put(key: string, value: string): Promise<void>
}

const wailsStore: BodyStore = {
  get: (key) => StorageGet(BUCKET, key),
  put: (key, value) => StoragePut(BUCKET, key, value),
}

export function shouldSpillBody(response: ResponseData): boolean {
  return !response.bodyRef && response.body.length > RESPONSE_SPILL_BYTES
}

export function previewBody(body: string): string {
  return body.slice(0, RESPONSE_PREVIEW_CHARS)
}

/** Store the full body and return the preview plus its reference. */
export async function spillResponse(id: string, response: ResponseData, store: BodyStore = wailsStore): Promise<ResponseData> {
  if (!shouldSpillBody(response)) return response
  const key = `${KEY_PREFIX}${id}`
  await store.put(key, response.body)
  return { ...response, body: previewBody(response.body), bodyRef: key }
}

/** Full body of a spilled response, or null when there is nothing to load. */
export async function readSpilledBody(response: ResponseData, store: BodyStore = wailsStore): Promise<string | null> {
  if (!response.bodyRef) return null
  return (await store.get(response.bodyRef)) || null
}

export async function spillResponseMap(responses: Record<string, ResponseData>, store: BodyStore = wailsStore): Promise<Record<string, ResponseData>> {
  const out: Record<string, ResponseData> = {}
  for (const [id, response] of Object.entries(responses)) out[id] = await spillResponse(id, response, store)
  return out
}

export async function spillHistory(entries: RequestHistoryEntry[], store: BodyStore = wailsStore): Promise<RequestHistoryEntry[]> {
  const out: RequestHistoryEntry[] = []
  for (const entry of entries) out.push({ ...entry, response: await spillResponse(entry.id, entry.response, store) })
  return out
}

export async function spillTabs(tabs: Tab[], store: BodyStore = wailsStore): Promise<Tab[]> {
  const out: Tab[] = []
  for (const tab of tabs) out.push(tab.response ? { ...tab, response: await spillResponse(tab.id, tab.response, store) } : tab)
  return out
}
