import { create } from 'zustand'
import {
  cancelMilkPrompt,
  getMilkSettings,
  getMilkStatus,
  installMilk,
  resetMilkSession,
  restartMilk,
  respondMilkPermission,
  saveMilkSettings,
  sendMilkPrompt,
  setMilkWorkspace,
  subscribeMilkEvents,
  type MilkChatEvent,
  type MilkPermissionEvent,
  type MilkRouteInfo,
  type MilkSettings,
  type MilkStatus,
  type MilkToolUpdate,
} from '@/lib/milk-api'

export interface MilkToolActivity {
  toolCallId: string
  name: string
  status: string
  rawOutput?: string
}

export interface MilkChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** The model's reasoning (agent_thought_chunk), kept apart from the answer. */
  thought?: string
  tools?: MilkToolActivity[]
  route?: MilkRouteInfo
  stopped?: boolean
}

export interface MilkChatThread {
  messages: MilkChatMessage[]
  busyToken: string | null
  error: string | null
}

interface MilkState {
  status: MilkStatus | null
  settings: MilkSettings | null
  busy: boolean
  error: string | null
  dialogOpen: boolean
  chatThreads: Record<string, MilkChatThread>
  permissions: MilkPermissionEvent[]
  ensure: () => Promise<void>
  saveSettings: (settings: MilkSettings) => Promise<boolean>
  setEnabled: (enabled: boolean) => Promise<boolean>
  restart: () => Promise<void>
  /** Downloads the latest milk release from its repository, then enables and starts it. */
  install: () => Promise<void>
  setDialogOpen: (open: boolean) => void
  setWorkspace: (root: string) => Promise<void>
  sendChat: (root: string, message: string) => Promise<void>
  stopChat: (root: string) => Promise<void>
  newChat: (root: string) => Promise<void>
  respondPermission: (requestId: string, allow: boolean) => Promise<void>
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))
const emptyThread = (): MilkChatThread => ({ messages: [], busyToken: null, error: null })
const uuid = () => typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`

function upsertTool(tools: MilkToolActivity[] | undefined, update: MilkToolUpdate): MilkToolActivity[] {
  const list = tools ?? []
  if (!list.some((tool) => tool.toolCallId === update.toolCallId)) {
    return [...list, { toolCallId: update.toolCallId, name: update.name, status: update.status, rawOutput: update.rawOutput }]
  }
  return list.map((tool) => (tool.toolCallId === update.toolCallId
    ? { ...tool, name: update.name || tool.name, status: update.status, rawOutput: update.rawOutput ?? tool.rawOutput }
    : tool))
}

export function applyMilkChatEvent(threads: Record<string, MilkChatThread>, event: MilkChatEvent): Record<string, MilkChatThread> {
  const match = Object.entries(threads).find(([, thread]) => thread.busyToken === event.token)
  if (!match) return threads
  const [root, thread] = match
  const assistantId = `${event.token}-assistant`
  const patch = (transform: (message: MilkChatMessage) => MilkChatMessage): MilkChatMessage[] =>
    thread.messages.map((message) => (message.id === assistantId ? transform(message) : message))

  let messages = thread.messages
  switch (event.kind) {
    case 'text':
      messages = patch((message) => ({ ...message, content: message.content + (event.reply ?? '') }))
      break
    case 'thought':
      messages = patch((message) => ({ ...message, thought: (message.thought ?? '') + (event.reply ?? '') }))
      break
    case 'tool':
      if (event.tool) messages = patch((message) => ({ ...message, tools: upsertTool(message.tools, event.tool!) }))
      break
    case 'route':
      if (event.route) messages = patch((message) => ({ ...message, route: event.route! }))
      break
    case 'warning':
      messages = patch((message) => ({ ...message, content: message.content ? `${message.content}\n\n⚠ ${event.reply ?? ''}` : `⚠ ${event.reply ?? ''}` }))
      break
  }

  const ended = event.kind === 'end'
  const failed = event.kind === 'error'
  const next: MilkChatThread = {
    ...thread,
    messages: ended ? patch((message) => ({ ...message, stopped: event.stopReason === 'cancelled' })) : messages,
    busyToken: ended || failed ? null : thread.busyToken,
    error: failed ? event.error ?? null : thread.error,
  }
  return { ...threads, [root]: next }
}

let subscribed = false

export const useMilkStore = create<MilkState>((set, get) => {
  const run = async (action: () => Promise<void>): Promise<boolean> => {
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
    busy: false,
    error: null,
    dialogOpen: false,
    chatThreads: {},
    permissions: [],

    ensure: async () => {
      if (!subscribed) {
        subscribed = true
        subscribeMilkEvents({
          status: (status) => set({ status }),
          chat: (event) => set((state) => ({ chatThreads: applyMilkChatEvent(state.chatThreads, event) })),
          permission: (event) => set((state) => ({ permissions: [...state.permissions, event] })),
          permissionResolved: (requestId) => set((state) => ({ permissions: state.permissions.filter((entry) => entry.requestId !== requestId) })),
        })
      }
      try {
        const [status, settings] = await Promise.all([getMilkStatus(), getMilkSettings()])
        set({ status, settings })
      } catch (error) {
        set({ error: messageOf(error) })
      }
    },

    saveSettings: (settings) => run(async () => set({ settings: await saveMilkSettings(settings) })),

    setEnabled: async (enabled) => {
      const settings = get().settings
      return settings ? get().saveSettings({ ...settings, enabled }) : false
    },

    restart: async () => { await run(restartMilk) },
    install: async () => {
      await run(async () => {
        const status = await installMilk()
        set({ status, settings: await getMilkSettings() })
      })
    },
    setDialogOpen: (dialogOpen) => set({ dialogOpen, error: null }),

    setWorkspace: async (root) => {
      if (!root) return
      await setMilkWorkspace(root).catch(() => undefined)
    },

    sendChat: async (root, rawMessage) => {
      const message = rawMessage.trim()
      if (!message) return
      const thread = get().chatThreads[root] ?? emptyThread()
      if (thread.busyToken) return
      const token = uuid()
      set((state) => ({
        chatThreads: {
          ...state.chatThreads,
          [root]: {
            ...thread,
            error: null,
            busyToken: token,
            messages: [
              ...thread.messages,
              { id: `${token}-user`, role: 'user', content: message },
              { id: `${token}-assistant`, role: 'assistant', content: '' },
            ],
          },
        },
      }))
      try {
        await sendMilkPrompt({ token, root, message })
        // The turn is over even if milk never sent its closing "idle" update.
        set((state) => {
          const current = state.chatThreads[root]
          if (!current || current.busyToken !== token) return state
          return { chatThreads: { ...state.chatThreads, [root]: { ...current, busyToken: null } } }
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
      await cancelMilkPrompt(token).catch(() => undefined)
      set((state) => {
        const current = state.chatThreads[root]
        if (!current || current.busyToken !== token) return state
        const messages = current.messages.map((entry) => (entry.id === `${token}-assistant` ? { ...entry, stopped: true } : entry))
        return { chatThreads: { ...state.chatThreads, [root]: { ...current, messages, busyToken: null } } }
      })
    },

    newChat: async (root) => {
      const current = get().chatThreads[root]
      if (current?.busyToken) await get().stopChat(root)
      // A new chat is a new milk session: the old one would still remember the conversation.
      await resetMilkSession(root).catch(() => undefined)
      set((state) => ({ chatThreads: { ...state.chatThreads, [root]: emptyThread() } }))
    },

    respondPermission: async (requestId, allow) => {
      set((state) => ({ permissions: state.permissions.filter((entry) => entry.requestId !== requestId) }))
      await respondMilkPermission(requestId, allow).catch(() => undefined)
    },
  }
})
