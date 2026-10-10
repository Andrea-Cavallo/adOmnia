import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { prepareStudioChat, type StudioChatContext } from '@/lib/goide/studioChatContext'
import type {
  MilkChatEvent,
  MilkPermissionEvent,
  MilkPromptRequest,
  MilkPromptResponse,
  MilkRouteInfo,
  MilkSettings,
  MilkStatus,
  MilkToolUpdate,
} from '@/lib/milk-api'

/**
 * Chat with an ACP agent hosted by the backend (milk, Claude Code). The Go side is one
 * client (internal/milk) for every agent, so the store is one factory too.
 */
export interface AgentChatApi {
  status: () => Promise<MilkStatus>
  settings: () => Promise<MilkSettings>
  saveSettings: (settings: MilkSettings) => Promise<MilkSettings>
  restart: () => Promise<void>
  setWorkspace: (root: string) => Promise<void>
  prompt: (request: MilkPromptRequest) => Promise<MilkPromptResponse>
  cancelPrompt: (token: string) => Promise<void>
  resetSession: (root: string) => Promise<void>
  respondPermission: (requestId: string, allow: boolean) => Promise<void>
  subscribe: (handlers: {
    status: (status: MilkStatus) => void
    chat: (event: MilkChatEvent) => void
    permission: (event: MilkPermissionEvent) => void
    permissionResolved: (requestId: string) => void
  }) => () => void
  /** Only agents adOmnia can download itself (milk). */
  install?: () => Promise<MilkStatus>
}

export interface AgentToolActivity {
  toolCallId: string
  name: string
  status: string
  rawOutput?: string
}

export interface AgentChatMessage {
  context?: string[]
  id: string
  role: 'user' | 'assistant'
  content: string
  /** The model's reasoning (agent_thought_chunk), kept apart from the answer. */
  thought?: string
  tools?: AgentToolActivity[]
  route?: MilkRouteInfo
  stopped?: boolean
}

export interface AgentChatThread {
  messages: AgentChatMessage[]
  busyToken: string | null
  error: string | null
}

export interface AgentChatState {
  status: MilkStatus | null
  settings: MilkSettings | null
  busy: boolean
  error: string | null
  dialogOpen: boolean
  chatThreads: Record<string, AgentChatThread>
  permissions: MilkPermissionEvent[]
  ensure: () => Promise<void>
  saveSettings: (settings: MilkSettings) => Promise<boolean>
  setEnabled: (enabled: boolean) => Promise<boolean>
  restart: () => Promise<void>
  /** Downloads the agent (milk only), then enables and starts it. */
  install: () => Promise<void>
  setDialogOpen: (open: boolean) => void
  setWorkspace: (root: string) => Promise<void>
  sendChat: (root: string, message: string, context?: StudioChatContext) => Promise<void>
  stopChat: (root: string) => Promise<void>
  newChat: (root: string) => Promise<void>
  respondPermission: (requestId: string, allow: boolean) => Promise<void>
}

export type AgentChatStore = UseBoundStore<StoreApi<AgentChatState>>

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))
const emptyThread = (): AgentChatThread => ({ messages: [], busyToken: null, error: null })
const uuid = () => typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`

function upsertTool(tools: AgentToolActivity[] | undefined, update: MilkToolUpdate): AgentToolActivity[] {
  const list = tools ?? []
  if (!list.some((tool) => tool.toolCallId === update.toolCallId)) {
    return [...list, { toolCallId: update.toolCallId, name: update.name, status: update.status, rawOutput: update.rawOutput }]
  }
  // ACP v1 updates carry only what changed: an empty name or status keeps the previous one.
  return list.map((tool) => (tool.toolCallId === update.toolCallId
    ? { ...tool, name: update.name || tool.name, status: update.status || tool.status, rawOutput: update.rawOutput || tool.rawOutput }
    : tool))
}

export function applyAgentChatEvent(threads: Record<string, AgentChatThread>, event: MilkChatEvent): Record<string, AgentChatThread> {
  const match = Object.entries(threads).find(([, thread]) => thread.busyToken === event.token)
  if (!match) return threads
  const [root, thread] = match
  const assistantId = `${event.token}-assistant`
  const patch = (transform: (message: AgentChatMessage) => AgentChatMessage): AgentChatMessage[] =>
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
  const next: AgentChatThread = {
    ...thread,
    messages: ended ? patch((message) => ({ ...message, stopped: event.stopReason === 'cancelled' })) : messages,
    busyToken: ended || failed ? null : thread.busyToken,
    error: failed ? event.error ?? null : thread.error,
  }
  return { ...threads, [root]: next }
}

export function createAgentChatStore(api: AgentChatApi): AgentChatStore {
  let subscribed = false

  return create<AgentChatState>((set, get) => {
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
          api.subscribe({
            status: (status) => set({ status }),
            chat: (event) => set((state) => ({ chatThreads: applyAgentChatEvent(state.chatThreads, event) })),
            permission: (event) => set((state) => ({ permissions: [...state.permissions, event] })),
            permissionResolved: (requestId) => set((state) => ({ permissions: state.permissions.filter((entry) => entry.requestId !== requestId) })),
          })
        }
        try {
          const [status, settings] = await Promise.all([api.status(), api.settings()])
          set({ status, settings })
        } catch (error) {
          set({ error: messageOf(error) })
        }
      },

      saveSettings: (settings) => run(async () => set({ settings: await api.saveSettings(settings) })),

      setEnabled: async (enabled) => {
        const settings = get().settings
        return settings ? get().saveSettings({ ...settings, enabled }) : false
      },

      restart: async () => { await run(api.restart) },
      install: async () => {
        const install = api.install
        if (!install) return
        await run(async () => {
          const status = await install()
          set({ status, settings: await api.settings() })
        })
      },
      setDialogOpen: (dialogOpen) => set({ dialogOpen, error: null }),

      setWorkspace: async (root) => {
        if (!root) return
        await api.setWorkspace(root).catch(() => undefined)
      },

      sendChat: async (root, rawMessage, context = { includeDocument: true, includeWorkspace: true }) => {
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
          const prepared = await prepareStudioChat(root, message, context, true)
          set((state) => {
            const current = state.chatThreads[root]
            if (!current || current.busyToken !== token) return state
            return { chatThreads: { ...state.chatThreads, [root]: { ...current, messages: current.messages.map((entry) => entry.id === `${token}-user` ? { ...entry, context: prepared.labels } : entry) } } }
          })
          if (get().chatThreads[root]?.busyToken !== token) return
          await api.prompt({ token, root, message: prepared.message })
          // The turn is over even if the agent never sent its closing update.
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
        await api.cancelPrompt(token).catch(() => undefined)
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
        // A new chat is a new agent session: the old one would still remember the conversation.
        await api.resetSession(root).catch(() => undefined)
        set((state) => ({ chatThreads: { ...state.chatThreads, [root]: emptyThread() } }))
      },

      respondPermission: async (requestId, allow) => {
        set((state) => ({ permissions: state.permissions.filter((entry) => entry.requestId !== requestId) }))
        await api.respondPermission(requestId, allow).catch(() => undefined)
      },
    }
  })
}
