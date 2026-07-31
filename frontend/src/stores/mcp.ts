import { create } from 'zustand'
import { safeSetItem } from '@/lib/safeLocalStorage'
import { safeStorageGet, safeStoragePut } from '@/lib/wailsStorage'

export interface McpSavedConfig {
  id: string
  name: string
  transport: 'stdio' | 'http'
  command: string
  args: string[]
  env: string[]
  baseURL: string
  bearerToken: string
}

export interface McpCapabilities {
  tools: McpTool[]
  resources: McpResource[]
  prompts: McpPrompt[]
}

export interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface McpResource {
  uri: string
  name: string
  description: string
  mimeType: string
}

export interface McpPromptArgument {
  name: string
  description: string
  required: boolean
}

export interface McpPrompt {
  name: string
  description: string
  arguments: McpPromptArgument[]
}

export interface McpCallEntry {
  id: string
  ts: number
  toolName: string
  args: Record<string, unknown>
  result: string
  isError: boolean
  durationMs: number
}

export type McpConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
export type McpSelectedTab = 'tools' | 'resources' | 'prompts'

export interface McpSessionInfo {
  id: string
  transport: string
  status: string
}

interface McpState {
  savedConfigs: McpSavedConfig[]
  activeConfigId: string | null
  activeSessionId: string | null
  status: McpConnectionStatus
  statusError: string
  serverInfo: string
  capabilities: McpCapabilities
  selectedTool: string | null
  selectedPrompt: string | null
  selectedTab: McpSelectedTab
  history: McpCallEntry[]
  selectedHistoryId: string | null
  sessions: Record<string, McpSessionInfo>
  restartingIds: Set<string>
  configsHydrated: boolean
  hydrateConfigs: () => Promise<void>
  addConfig: (cfg: Omit<McpSavedConfig, 'id'>) => McpSavedConfig
  removeConfig: (id: string) => void
  setActiveConfig: (id: string | null) => void
  setActiveSession: (id: string | null) => void
  setStatus: (status: McpConnectionStatus, error?: string) => void
  setServerInfo: (info: string) => void
  setCapabilities: (capabilities: Partial<McpCapabilities>) => void
  setSelectedTool: (name: string | null) => void
  setSelectedPrompt: (name: string | null) => void
  setSelectedTab: (tab: McpSelectedTab) => void
  appendHistory: (entry: McpCallEntry) => void
  setSelectedHistory: (id: string | null) => void
  clearHistory: () => void
  setSessions: (sessions: McpSessionInfo[]) => void
  setRestarting: (id: string, value: boolean) => void
}

const STORAGE_KEY = 'adomnia.mcp'
const STORAGE_BUCKET = 'mcp'
const STORAGE_ENTRY = 'configs'
const HISTORY_LIMIT = 200

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `mcp-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function loadConfigs(): McpSavedConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function persistConfigs(configs: McpSavedConfig[]): void {
  safeSetItem(STORAGE_KEY, JSON.stringify(configs))
  void safeStoragePut(STORAGE_BUCKET, STORAGE_ENTRY, JSON.stringify(configs))
}

function parseConfigs(raw: string): McpSavedConfig[] | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as McpSavedConfig[] : null
  } catch {
    return null
  }
}

export const useMcpStore = create<McpState>((set, get) => ({
  savedConfigs: loadConfigs(),
  activeConfigId: null,
  activeSessionId: null,
  status: 'disconnected',
  statusError: '',
  serverInfo: '',
  capabilities: { tools: [], resources: [], prompts: [] },
  selectedTool: null,
  selectedPrompt: null,
  selectedTab: 'tools',
  history: [],
  selectedHistoryId: null,
  sessions: {},
  restartingIds: new Set<string>(),
  configsHydrated: false,

  hydrateConfigs: async () => {
    const stored = await safeStorageGet(STORAGE_BUCKET, STORAGE_ENTRY)
    const persisted = stored ? parseConfigs(stored) : null
    const legacy = get().savedConfigs

    if (persisted) {
      set({ savedConfigs: persisted, configsHydrated: true })
      return
    }

    // Existing browser-only configurations are retained and copied into the
    // desktop storage on the first launch after this migration.
    if (legacy.length > 0) await safeStoragePut(STORAGE_BUCKET, STORAGE_ENTRY, JSON.stringify(legacy))
    set({ configsHydrated: true })
  },

  addConfig: (cfg) => {
    const entry: McpSavedConfig = { ...cfg, id: makeId() }
    const next = [...get().savedConfigs, entry]
    set({ savedConfigs: next, activeConfigId: entry.id })
    persistConfigs(next)
    return entry
  },
  removeConfig: (id) => {
    const state = get()
    const next = state.savedConfigs.filter((cfg) => cfg.id !== id)
    set({
      savedConfigs: next,
      activeConfigId: state.activeConfigId === id ? null : state.activeConfigId,
      activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
    })
    persistConfigs(next)
  },
  setActiveConfig: (id) => set({ activeConfigId: id, activeSessionId: id }),
  setActiveSession: (id) => set({ activeSessionId: id, activeConfigId: id }),
  setStatus: (status, error = '') => set({ status, statusError: error }),
  setServerInfo: (info) => set({ serverInfo: info }),
  setCapabilities: (capabilities) => set((state) => ({
    capabilities: { ...state.capabilities, ...capabilities },
    selectedTool: capabilities.tools?.[0]?.name ?? state.selectedTool,
    selectedPrompt: capabilities.prompts?.[0]?.name ?? state.selectedPrompt,
  })),
  setSelectedTool: (name) => set({ selectedTool: name }),
  setSelectedPrompt: (name) => set({ selectedPrompt: name }),
  setSelectedTab: (tab) => set({ selectedTab: tab }),
  appendHistory: (entry) => set((state) => ({
    history: [entry, ...state.history].slice(0, HISTORY_LIMIT),
    selectedHistoryId: entry.id,
  })),
  setSelectedHistory: (id) => set({ selectedHistoryId: id }),
  clearHistory: () => set({ history: [], selectedHistoryId: null }),
  setSessions: (sessions) => set({
    sessions: Object.fromEntries(sessions.map((session) => [session.id, session])),
  }),
  setRestarting: (id, value) => set((state) => {
    const restartingIds = new Set(state.restartingIds)
    if (value) {
      restartingIds.add(id)
    } else {
      restartingIds.delete(id)
    }
    return { restartingIds }
  }),
}))
