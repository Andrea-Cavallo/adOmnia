import { create } from 'zustand'
import {
  cancelCopilotChat,
  copilotSignIn,
  copilotSignOut,
  destroyCopilotChat,
  getCopilotChatModels,
  getCopilotSettings,
  getCopilotStatus,
  installCopilotServer,
  restartCopilot,
  saveCopilotSettings,
  sendCopilotChat,
  subscribeCopilotEvents,
  type CopilotChatEvent,
  type CopilotChatModel,
  type CopilotChatSelection,
  type CopilotInstallProgress,
  type CopilotSettings,
  type CopilotSignInPrompt,
  type CopilotStatus,
} from '@/lib/copilot-api'
import { useGoIDELspStore } from '@/stores/goideLsp'

export interface CopilotChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  context?: string[]
  stopped?: boolean
}

export interface CopilotChatThread {
  conversationId: string
  turnId: string
  title: string
  /** Modello riportato dal backend per l'ultimo turno: assente finché nessuna risposta lo dichiara. */
  model?: string
  messages: CopilotChatMessage[]
  busyToken: string | null
  error: string | null
}

export interface CopilotChatContext {
  documentId?: string
  selection?: CopilotChatSelection | null
  includeDocument: boolean
  includeWorkspace: boolean
  labels: string[]
}

interface CopilotState {
  status: CopilotStatus | null
  settings: CopilotSettings | null
  install: CopilotInstallProgress | null
  signIn: CopilotSignInPrompt | null
  busy: boolean
  error: string | null
  dialogOpen: boolean
  chatThreads: Record<string, CopilotChatThread>
  chatModels: CopilotChatModel[]
  chatModelsLoaded: boolean
  chatModelsError: string | null
  ensure: () => Promise<void>
  saveSettings: (settings: CopilotSettings) => Promise<boolean>
  setEnabled: (enabled: boolean) => Promise<boolean>
  toggleCompletions: () => Promise<boolean>
  installServer: () => Promise<void>
  startSignIn: () => Promise<void>
  signOut: () => Promise<void>
  restart: () => Promise<void>
  setDialogOpen: (open: boolean) => void
  sendChat: (root: string, message: string, context: CopilotChatContext) => Promise<void>
  loadChatModels: () => Promise<void>
  selectChatModel: (root: string, model: string) => Promise<void>
  stopChat: (root: string) => Promise<void>
  newChat: (root: string) => Promise<void>
  clearSignIn: () => void
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))
const emptyThread = (model?: string): CopilotChatThread => ({ conversationId: '', turnId: '', title: '', model, messages: [], busyToken: null, error: null })
const uuid = () => typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`

let subscribed = false

function notify(text: string): void {
  useGoIDELspStore.setState({ message: text })
}

export function applyCopilotChatEvent(threads: Record<string, CopilotChatThread>, event: CopilotChatEvent): Record<string, CopilotChatThread> {
  const match = Object.entries(threads).find(([, thread]) => thread.busyToken === event.token)
  if (!match) return threads
  const [root, thread] = match
  const messages = event.reply
    ? thread.messages.map((entry) => entry.id === `${event.token}-assistant` ? { ...entry, content: entry.content + event.reply } : entry)
    : thread.messages
  const next: CopilotChatThread = {
    ...thread,
    messages,
    conversationId: event.conversationId || thread.conversationId,
    turnId: event.turnId || thread.turnId,
    title: event.title || thread.title,
    busyToken: event.kind === 'end' ? null : thread.busyToken,
    error: event.error || null,
  }
  return { ...threads, [root]: next }
}

export const useCopilotStore = create<CopilotState>((set, get) => {
  const run = async (action: () => Promise<void>) => {
    set({ busy: true, error: null })
    try {
      await action()
      return true
    } catch (error) {
      set({ error: messageOf(error) })
      return false
    } finally {
      set({ busy: false })
    }
  }

  return {
    status: null,
    settings: null,
    install: null,
    signIn: null,
    busy: false,
    error: null,
    dialogOpen: false,
    chatThreads: {},
    chatModels: [],
    chatModelsLoaded: false,
    chatModelsError: null,

    ensure: async () => {
      if (!subscribed) {
        subscribed = true
        subscribeCopilotEvents({
          status: (status) => {
            set(status.state === 'ready' ? { status } : { status, chatModels: [], chatModelsLoaded: false, chatModelsError: null })
            if (status.state === 'ready' && get().signIn) set({ signIn: null })
          },
          install: (install) => set({ install }),
          message: (event) => notify(`GitHub Copilot: ${event.message}`),
          chat: (event) => set((state) => ({ chatThreads: applyCopilotChatEvent(state.chatThreads, event) })),
        })
      }
      try {
        const [status, settings] = await Promise.all([getCopilotStatus(), getCopilotSettings()])
        set({ status, settings })
        if (status.state === 'ready') await get().loadChatModels()
      } catch (error) {
        set({ error: messageOf(error) })
      }
    },

    saveSettings: (settings) => run(async () => set({ settings: await saveCopilotSettings(settings) })),
    setEnabled: async (enabled) => {
      const settings = get().settings
      return settings ? get().saveSettings({ ...settings, enabled }) : false
    },
    toggleCompletions: async () => {
      const settings = get().settings
      if (!settings) return false
      const ok = await get().saveSettings({ ...settings, inlineCompletion: !settings.inlineCompletion })
      if (ok) notify(`Copilot inline completions ${settings.inlineCompletion ? 'disabled' : 'enabled'}`)
      return ok
    },
    installServer: async () => {
      await run(async () => {
        await installCopilotServer()
        set({ install: null })
      })
    },
    startSignIn: async () => {
      await run(async () => {
        const prompt = await copilotSignIn()
        set({ signIn: prompt.userCode ? prompt : null })
        if (prompt.userCode) await navigator.clipboard?.writeText(prompt.userCode).catch(() => undefined)
      })
    },
    signOut: async () => { await run(copilotSignOut) },
    restart: async () => { await run(restartCopilot) },
    setDialogOpen: (dialogOpen) => set({ dialogOpen, error: null }),
    loadChatModels: async () => {
      if (get().chatModelsLoaded || get().status?.state !== 'ready') return
      try {
        const chatModels = await getCopilotChatModels()
        set({ chatModels, chatModelsLoaded: true, chatModelsError: null })
      } catch (error) {
        set({ chatModelsLoaded: true, chatModelsError: messageOf(error) })
      }
    },
    selectChatModel: async (root, model) => {
      const selected = model.trim()
      if (!selected) return
      const current = get().chatThreads[root]
      if (current?.model === selected && !current.conversationId) return
      if (current?.busyToken) await get().stopChat(root)
      if (current?.conversationId) await destroyCopilotChat(current.conversationId).catch(() => undefined)
      set((state) => ({ chatThreads: { ...state.chatThreads, [root]: emptyThread(selected) } }))
    },
    sendChat: async (root, rawMessage, context) => {
      const message = rawMessage.trim()
      if (!message) return
      const thread = get().chatThreads[root] ?? emptyThread()
      if (thread.busyToken) return
      const token = uuid()
      set((state) => ({ chatThreads: {
        ...state.chatThreads,
        [root]: {
          ...thread,
          error: null,
          busyToken: token,
          messages: [
            ...thread.messages,
            { id: `${token}-user`, role: 'user', content: message, context: context.labels },
            { id: `${token}-assistant`, role: 'assistant', content: '' },
          ],
        },
      } }))
      try {
        const response = await sendCopilotChat({
          token,
          model: thread.model,
          conversationId: thread.conversationId,
          turnId: thread.turnId,
          message,
          documentId: context.documentId ?? '',
          selection: context.selection ?? null,
          includeDocument: context.includeDocument,
          includeWorkspace: context.includeWorkspace,
        })
        set((state) => {
          const current = state.chatThreads[root]
          if (!current || !current.messages.some((entry) => entry.id === `${token}-assistant`)) return state
          return { chatThreads: { ...state.chatThreads, [root]: { ...current, conversationId: response.conversationId || current.conversationId, turnId: response.turnId || current.turnId, model: response.model || current.model } } }
        })
      } catch (error) {
        const text = messageOf(error)
        set((state) => {
          const current = state.chatThreads[root]
          if (!current || current.busyToken !== token) return state
          return { chatThreads: { ...state.chatThreads, [root]: { ...current, busyToken: null, error: text } } }
        })
      }
    },
    stopChat: async (root) => {
      const token = get().chatThreads[root]?.busyToken
      if (!token) return
      await cancelCopilotChat(token).catch(() => false)
      set((state) => {
        const current = state.chatThreads[root]
        if (!current || current.busyToken !== token) return state
        const messages = current.messages.map((entry) => entry.id === `${token}-assistant` ? { ...entry, stopped: true } : entry)
        return { chatThreads: { ...state.chatThreads, [root]: { ...current, messages, busyToken: null } } }
      })
    },
    newChat: async (root) => {
      const current = get().chatThreads[root]
      if (current?.busyToken) await get().stopChat(root)
      if (current?.conversationId) await destroyCopilotChat(current.conversationId).catch(() => undefined)
      set((state) => ({ chatThreads: { ...state.chatThreads, [root]: emptyThread(current?.model) } }))
    },
    clearSignIn: () => set({ signIn: null }),
  }
})

export function copilotCompletionsActive(state: Pick<CopilotState, 'status' | 'settings'>): boolean {
  return state.status?.state === 'ready' && !!state.settings?.enabled && !!state.settings?.inlineCompletion
}
