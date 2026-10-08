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
  content?: ReceivedContent
  error?: string
}

interface CollabState {
  status: CollabStatus | null
  invites: CollabInvite[]
  inbox: CollabInboxItem[]
  notice: string | null
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

export const useCollabStore = create<CollabState>((set, get) => ({
  status: null,
  invites: [],
  inbox: [],
  notice: null,

  init: () => {
    if (unsubscribe) return
    unsubscribe = subscribeCollabEvents((event) => handleEvent(event, set, get))
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
    set({ status: await collabApi.host(ip, port, name), invites: [], notice: null })
  },

  join: async (code, name) => {
    set({ status: await collabApi.join(code, name), notice: null })
  },

  stop: async () => {
    await collabApi.stop()
    set({ invites: [] })
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
    set((s) => ({ inbox: s.inbox.filter((entry) => entry.id !== id), notice: `Importato: ${item.title}` }))
  },

  dismiss: (id) => set((s) => ({ inbox: s.inbox.filter((entry) => entry.id !== id) })),
  clearNotice: () => set({ notice: null }),
}))

type SetState = (partial: Partial<CollabState> | ((s: CollabState) => Partial<CollabState>)) => void

function handleEvent(event: CollabEvent, set: SetState, get: () => CollabState) {
  if (event.type === 'participants') {
    void get().refresh()
    return
  }
  if (event.type === 'closed') {
    set({ invites: [], notice: typeof event.payload === 'string' ? event.payload : 'Sessione chiusa' })
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
    try {
      item.content = parseReceived(share.kind, share.title, share.data, from)
    } catch (error) {
      item.error = errorText(error)
    }
    set((s) => ({ inbox: [item, ...s.inbox].slice(0, MAX_INBOX), notice: `${from} ha condiviso ${item.title}` }))
  }
}
