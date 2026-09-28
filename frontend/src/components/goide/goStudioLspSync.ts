import { updateDocumentBuffer } from '@/lib/goide-lsp-api'
import { useGoIDEStore, type GoIDEEditorDocument } from '@/stores/goide'

const SYNC_DEBOUNCE_MS = 120

interface SyncEntry {
  sessionId: string
  version: number
  sentText: string
  pendingText: string | null
  timer: ReturnType<typeof setTimeout> | null
  inFlight: Promise<void>
}

const entries = new Map<string, SyncEntry>()
let started = false

function isSynced(document: GoIDEEditorDocument): boolean {
  const name = document.document.name.toLowerCase()
  return !document.document.readOnly && (name.endsWith('.go') || name === 'go.mod' || name === 'go.work')
}

function send(documentId: string): Promise<void> {
  const entry = entries.get(documentId)
  if (!entry || entry.pendingText === null) return entry?.inFlight ?? Promise.resolve()
  if (entry.timer) clearTimeout(entry.timer)
  entry.timer = null
  const text = entry.pendingText
  entry.pendingText = null
  entry.version += 1
  entry.sentText = text
  const version = entry.version
  // Le chiamate sono serializzate per documento: gopls riceve le versioni in ordine.
  entry.inFlight = entry.inFlight.then(() => updateDocumentBuffer(entry.sessionId, documentId, version, text)).catch(() => undefined)
  return entry.inFlight
}

function reconcile(documents: GoIDEEditorDocument[]): void {
  const alive = new Set<string>()
  for (const document of documents) {
    if (!isSynced(document)) continue
    const id = document.document.id
    alive.add(id)
    const entry = entries.get(id)
    if (!entry) {
      // Il backend ha aperto il documento con versione 1 e il contenuto letto da disco.
      entries.set(id, { sessionId: document.document.sessionId, version: 1, sentText: document.content, pendingText: null, timer: null, inFlight: Promise.resolve() })
      if (document.buffer !== document.content) schedule(id, document.buffer)
      continue
    }
    const latest = entry.pendingText ?? entry.sentText
    if (document.buffer !== latest) schedule(id, document.buffer)
  }
  for (const id of entries.keys()) {
    if (!alive.has(id)) {
      const entry = entries.get(id)
      if (entry?.timer) clearTimeout(entry.timer)
      entries.delete(id)
    }
  }
}

function schedule(documentId: string, text: string): void {
  const entry = entries.get(documentId)
  if (!entry) return
  entry.pendingText = text
  if (entry.timer) clearTimeout(entry.timer)
  entry.timer = setTimeout(() => void send(documentId), SYNC_DEBOUNCE_MS)
}

/** Avvia la sincronizzazione automatica buffer → gopls; idempotente. */
export function startGoStudioLspSync(): void {
  if (started) return
  started = true
  reconcile(useGoIDEStore.getState().documents)
  useGoIDEStore.subscribe((state, previous) => {
    if (state.documents !== previous.documents) reconcile(state.documents)
  })
}

/** Invia subito eventuali modifiche in attesa e restituisce la versione che gopls conosce. */
export async function flushGoStudioDocument(documentId: string): Promise<number | null> {
  const entry = entries.get(documentId)
  if (!entry) return null
  await send(documentId)
  return entry.version
}

/** Versione corrente del documento lato gopls, per scartare risposte tardive. */
export function currentGoStudioDocumentVersion(documentId: string): number | null {
  const entry = entries.get(documentId)
  if (!entry) return null
  return entry.pendingText === null ? entry.version : entry.version + 1
}
