import { create } from 'zustand'
import { useSettingsStore } from '@/stores/settings'
import type { RoutedToolFile } from '@/lib/globalFileRouter'

export type RailItem =
  | 'collections'
  | 'scenarios'
  | 'history'
  | 'kafka'
  | 'broker'
  | 'websocket'
  | 'sse'
  | 'loadtest'
  | 'proxy'
  | 'mock'
  | 'grpc'
  | 'nettools'
  | 'browser'
  | 'dockerlab'
  | 'jsontools'
  | 'xmltools'
  | 'utils'
  | 'flows'
  | 'runner'
  | 'soap'
  | 'testdata'
  | 'markdown'
  | 'powertools'
  | 'storage'
  | 'database'
  | 'vault'
  | 'workspace'
  | 'themes'
  | 'templates'
  | 'plugins'
  | 'apis'
  | 'har'
  | 'observe'
  | 'secretscanner'
  | 'settings'
  | 'welcome'
  | 'gitsync'
  | 'mcp'

// Canonical Cmd/Ctrl+1..9 quick-navigation targets, ordered to match the
// visible rail category order (each entry is that category's primary tool).
// Keep in sync with the category order in components/layout/Rail.tsx.
export const RAIL_QUICK_NAV: RailItem[] = [
  'collections', // 1 · API Core
  'websocket',   // 2 · Protocols & Streaming
  'mock',        // 3 · Infrastructure & Simulation
  'browser',     // 4 · Debugging & Analysis
  'database',    // 5 · Local Data & Workspace
  'jsontools',   // 6 · Power Tools
  'markdown',    // 7 · Markdown
]

interface AppState {
  activeRail: RailItem
  railHistory: RailItem[]
  devToolsVisible: boolean
  mockRunning: boolean
  proxyRunning: boolean
  websocketRunning: boolean
  sseRunning: boolean
  browserRunning: boolean
  pendingFileImport: RoutedToolFile | null
  setActiveRail: (rail: RailItem) => void
  queueFileImport: (file: RoutedToolFile) => void
  consumeFileImport: (kind: RoutedToolFile['kind']) => RoutedToolFile | null
  goBack: () => void
  toggleSidebar: () => void
  toggleDevTools: () => void
  setMockRunning: (v: boolean) => void
  setProxyRunning: (v: boolean) => void
  setWebsocketRunning: (v: boolean) => void
  setSseRunning: (v: boolean) => void
  setBrowserRunning: (v: boolean) => void
}

const initialRail: RailItem = 'welcome'

export const useAppStore = create<AppState>((set, get) => ({
  activeRail: initialRail,
  railHistory: [],
  devToolsVisible: false,
  mockRunning: false,
  proxyRunning: false,
  websocketRunning: false,
  sseRunning: false,
  browserRunning: false,
  pendingFileImport: null,
  setActiveRail: (rail) => set((s) => ({
    activeRail: rail,
    railHistory: s.activeRail !== rail ? [...s.railHistory.slice(-19), s.activeRail] : s.railHistory,
  })),
  queueFileImport: (file) => set({ pendingFileImport: file }),
  consumeFileImport: (kind) => {
    const file = get().pendingFileImport
    if (!file || file.kind !== kind) return null
    set({ pendingFileImport: null })
    return file
  },
  goBack: () => set((s) => {
    if (s.railHistory.length === 0) return s
    const prev = s.railHistory[s.railHistory.length - 1]
    return { activeRail: prev, railHistory: s.railHistory.slice(0, -1) }
  }),
  toggleSidebar: () => {
    const current = useSettingsStore.getState().settings.appearance.sidebarCollapsed
    useSettingsStore.getState().updateAppearance({ sidebarCollapsed: !current })
  },
  toggleDevTools: () => set((s) => ({ devToolsVisible: !s.devToolsVisible })),
  setMockRunning: (v) => set({ mockRunning: v }),
  setProxyRunning: (v) => set({ proxyRunning: v }),
  setWebsocketRunning: (v) => set({ websocketRunning: v }),
  setSseRunning: (v) => set({ sseRunning: v }),
  setBrowserRunning: (v) => set({ browserRunning: v }),
}))
