import { create } from 'zustand'
import { collabApi, subscribeCollabEvents, type CollabEvent, type CollabInvite, type CollabRole, type CollabShare, type CollabShareKind, type CollabStatus } from '@/lib/collab-api'
import { containsScripts, parseReceived, type ReceivedContent } from '@/lib/collab/receive'
import { useCollectionsStore } from '@/stores/collections'
import { useEnvironmentsStore } from '@/stores/environments'
import { useTabsStore } from '@/stores/tabs'

export interface CollabInboxItem {
  id: string
  title: string
  from: string
  redacted: string[]
  hasScripts: boolean
  receivedAt: number
  revision?: string
  sourceId?: string
  senderId?: string
  content?: ReceivedContent
  error?: string
}

interface CollabState {
  status: CollabStatus | null
  invites: CollabInvite[]
  inbox: CollabInboxItem[]
  notice: string | null
  syncingCollectionId: string | null
  init: () => void
  refresh: () => Promise<void>
  host: (ip: string, port: number, name: string) => Promise<void>
  join: (code: string, name: string) => Promise<void>
  stop: () => Promise<void>
  createInvite: (role: CollabRole, ttlMinutes: number) => Promise<CollabInvite>
  setRole: (participantId: string, role: CollabRole) => Promise<void>
  revoke: (participantId: string) => Promise<void>
  share: (kind: CollabShareKind, title: string, data: unknown) => Promise<CollabShare>
  accept: (id: string) => void
  dismiss: (id: string) => void
  clearNotice: () => void
}

const MAX_INBOX = 50
let unsubscribe: (() => void) | null = null
// Stato di modulo dell'idratazione dell'inbox: la lettura dal backend è asincrona e può arrivare
// dopo un comando che ha azzerato l'inbox. `inboxReset` lo ricorda; `inboxWrite` accoda i salvataggi.
let inboxReset = false
let inboxWrite: Promise<void> = Promise.resolve()

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

function participantName(status: CollabStatus | null, id?: string): string {
  return status?.participants.find((p) => p.id === id)?.name ?? 'un partecipante'
}

function applyReceived(content: ReceivedContent) {
  if (content.kind === 'collection') useCollectionsStore.getState().importCollection(content.collection)
  if (content.kind === 'request') useTabsStore.getState().openTab(content.request)
  if (content.kind === 'environments') {
    const envs = useEnvironmentsStore.getState()
    for (const env of content.environments) {
      const created = envs.addEnvironment(env.name)
      envs.updateVariables(created.id, env.variables)
    }
  }
}

function persistInbox(inbox: CollabInboxItem[], set: SetState) {
  // I salvataggi sono accodati: due dismiss ravvicinati non devono scrivere per ultima la lista
  // vecchia (ogni scrittura sovrascrive quella precedente).
  inboxWrite = inboxWrite
    .then(() => collabApi.saveInbox(JSON.stringify(inbox)))
    .catch(error => { set({ notice: `Recovery inbox non salvato: ${errorText(error)}` }) })
}

function hydrateInbox(set: SetState, get: () => CollabState) {
  void collabApi.inbox().then(data => {
    const parsed: unknown = JSON.parse(data)
    if (!Array.isArray(parsed)) throw new Error('recovery inbox non valido')
    // La lettura è partita prima: se nel frattempo l'utente ha aperto una sessione nuova (che azzera
    // l'inbox) o l'ha già svuotata, la copia salvata non deve risuscitare i vecchi elementi.
    if (inboxReset) return
    const local = get().inbox
    const persisted = (parsed as CollabInboxItem[])
      .filter((item) => !local.some((entry) => entry.id === item.id))
      .slice(0, MAX_INBOX)
    if (persisted.length === 0) return
    // Un elemento arrivato durante la lettura resta: si aggiunge la copia salvata, non la si impone.
    set({ inbox: [...local, ...persisted].slice(0, MAX_INBOX) })
  }).catch(error => set({ notice: `Recovery inbox non disponibile: ${errorText(error)}` }))
}

export const useCollabStore = create<CollabState>((set, get) => ({
  status: null,
  invites: [],
  inbox: [],
  notice: null,
  syncingCollectionId: null,

  init: () => {
    if (unsubscribe) return
    unsubscribe = subscribeCollabEvents((event) => handleEvent(event, set, get))
    hydrateInbox(set, get)
    void get().refresh()
  },

  refresh: async () => {
    try {
      set({ status: await collabApi.status() })
    } catch (error) {
      set({ notice: errorText(error) })
    }
  },

  host: async (ip, port, name) => {
    set({ status: await collabApi.host(ip, port, name), invites: [], inbox: [], notice: null })
    inboxReset = true
  },

  join: async (code, name) => {
    set({ status: await collabApi.join(code, name), inbox: [], notice: null })
    inboxReset = true
  },

  stop: async () => {
    await collabApi.stop()
    set({ invites: [], inbox: [] })
    inboxReset = true
    await get().refresh()
  },

  createInvite: async (role, ttlMinutes) => {
    const invite = await collabApi.createInvite(role, ttlMinutes)
    set((s) => ({ invites: [invite, ...s.invites] }))
    await get().refresh()
    return invite
  },

  setRole: async (participantId, role) => {
    await collabApi.setRole(participantId, role)
    await get().refresh()
  },

  revoke: async (participantId) => {
    await collabApi.revoke(participantId)
    await get().refresh()
  },

  share: (kind, title, data) => collabApi.share(kind, title, data),

  accept: (id) => {
    const item = get().inbox.find((entry) => entry.id === id)
    if (!item?.content) return
    applyReceived(item.content)
    const inbox = get().inbox.filter(entry => entry.id !== id)
    set({ inbox, notice: `Importato: ${item.title}` })
    persistInbox(inbox, set)
  },

  dismiss: (id) => {
    const inbox = get().inbox.filter(entry => entry.id !== id)
    set({ inbox })
    persistInbox(inbox, set)
  },
  clearNotice: () => set({ notice: null }),
}))

type SetState = (partial: Partial<CollabState> | ((s: CollabState) => Partial<CollabState>)) => void

function handleEvent(event: CollabEvent, set: SetState, get: () => CollabState) {
  if (event.type === 'resumed') {
    set({ status: event.payload as CollabStatus, notice: 'Sessione ripresa. Snapshot e documenti in risincronizzazione.' })
    return
  }
  if (event.type === 'disconnected') {
    set({ notice: 'Connessione persa. Il testo locale resta aperto: usa Riprendi connessione.' })
    void get().refresh()
    return
  }
  if (event.type === 'participants' || event.type === 'project' || (event.type === 'document' && ['open', 'close'].includes((event.payload as {action?:string})?.action ?? ''))) {
    void get().refresh()
    return
  }
  if (event.type === 'closed') {
    inboxReset = true
    set({ invites: [], inbox: [], notice: typeof event.payload === 'string' ? event.payload : 'Sessione chiusa' })
    void get().refresh()
    return
  }
  if (event.type === 'error') {
    set({ notice: typeof event.payload === 'string' ? event.payload : 'Errore di collaborazione' })
    return
  }
  if (event.type === 'share') {
    // Niente import automatico: il contenuto entra in una inbox e l'utente decide.
    const share = event.payload as CollabShare
    const from = participantName(get().status, event.from)
    const item: CollabInboxItem = { id: share.id, title: share.title || share.kind, from, redacted: share.redacted ?? [], hasScripts: containsScripts(share.data), receivedAt: Date.now() }
    item.revision = (share as CollabShare & { revision?: string }).revision
    item.sourceId=share.sourceId
    item.senderId=event.from
    try {
      item.content = parseReceived(share.kind, share.title, share.data, from)
    } catch (error) {
      item.error = errorText(error)
    }
    const inbox = [item, ...get().inbox.filter(entry => entry.id !== item.id && !(item.sourceId && entry.sourceId === item.sourceId && entry.senderId === item.senderId))].slice(0, MAX_INBOX)
    set({ inbox, notice: `${from} ha condiviso ${item.title}` })
    persistInbox(inbox, set)
  }
}
