import type { LogFilterState } from './query'
import type { LogFormat } from './types'
import type { LogSourceKind } from './sources'

const DB_NAME = 'adomnia-log-inspector'
const DB_VERSION = 1
const META_STORE = 'investigations'
const CONTENT_STORE = 'source-content'
export const AUTOSAVE_INVESTIGATION_ID = 'autosave'

export interface PersistedSourceMetadata {
  id: string
  name: string
  displayName: string
  kind: LogSourceKind
  bytes: number
  enabled: boolean
  eventCount: number
  errorCount: number
  warningCount: number
  format: LogFormat
  firstTs: number | null
  lastTs: number | null
}

export interface InvestigationUiState {
  filters: LogFilterState
  selectedId: number | null
  bookmarks: number[]
  notes: string
  showFilters: boolean
  sortDir: 'asc' | 'desc'
  masked: boolean
  deduplicated: boolean
}

export interface InvestigationMetadata {
  version: 1
  id: string
  name: string
  savedAt: number
  sources: PersistedSourceMetadata[]
  ui: InvestigationUiState
}

export interface RestoredInvestigation extends InvestigationMetadata {
  sourceContents: Record<string, string>
  missingSourceIds: string[]
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(CONTENT_STORE)) db.createObjectStore(CONTENT_STORE, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Could not open investigation storage'))
  })
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('Investigation storage failed'))
    transaction.onabort = () => reject(transaction.error || new Error('Investigation storage was aborted'))
  })
}

export async function saveInvestigation(metadata: InvestigationMetadata, sourceContents: Record<string, string>): Promise<void> {
  const db = await openDatabase()
  try {
    const transaction = db.transaction([META_STORE, CONTENT_STORE], 'readwrite')
    transaction.objectStore(META_STORE).put(metadata)
    const contentStore = transaction.objectStore(CONTENT_STORE)
    for (const source of metadata.sources) contentStore.put({ key: `${metadata.id}:${source.id}`, text: sourceContents[source.id] ?? '' })
    await complete(transaction)
  } finally {
    db.close()
  }
}

export async function loadInvestigation(id = AUTOSAVE_INVESTIGATION_ID): Promise<RestoredInvestigation | null> {
  const db = await openDatabase()
  try {
    const transaction = db.transaction([META_STORE, CONTENT_STORE], 'readonly')
    const metadata = await new Promise<InvestigationMetadata | undefined>((resolve, reject) => {
      const request = transaction.objectStore(META_STORE).get(id)
      request.onsuccess = () => resolve(request.result as InvestigationMetadata | undefined)
      request.onerror = () => reject(request.error)
    })
    if (!metadata || metadata.version !== 1) return null
    const sourceContents: Record<string, string> = {}
    const missingSourceIds: string[] = []
    await Promise.all(metadata.sources.map((source) => new Promise<void>((resolve, reject) => {
      const request = transaction.objectStore(CONTENT_STORE).get(`${id}:${source.id}`)
      request.onsuccess = () => {
        const record = request.result as { text?: string } | undefined
        if (typeof record?.text === 'string') sourceContents[source.id] = record.text
        else missingSourceIds.push(source.id)
        resolve()
      }
      request.onerror = () => reject(request.error)
    })))
    return { ...metadata, sourceContents, missingSourceIds }
  } finally {
    db.close()
  }
}

export async function deleteInvestigation(id = AUTOSAVE_INVESTIGATION_ID): Promise<void> {
  const restored = await loadInvestigation(id)
  const db = await openDatabase()
  try {
    const transaction = db.transaction([META_STORE, CONTENT_STORE], 'readwrite')
    transaction.objectStore(META_STORE).delete(id)
    for (const source of restored?.sources ?? []) transaction.objectStore(CONTENT_STORE).delete(`${id}:${source.id}`)
    await complete(transaction)
  } finally {
    db.close()
  }
}

export function exportInvestigationMetadata(metadata: InvestigationMetadata): string {
  return JSON.stringify(metadata, null, 2)
}
