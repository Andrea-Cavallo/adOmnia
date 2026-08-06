import { create } from 'zustand'
import { useSettingsStore } from '@/stores/settings'
import type { RoutedToolFile } from '@/lib/globalFileRouter'

export type RailItem =
  | 'collections'
  | 'scenarios'
  | 'history'
  | 'broker'
  | 'websocket'
  | 'sse'
  | 'proxy'
  | 'mock'
  | 'grpc'
  | 'browser'
  | 'dockerlab'
  | 'jsonviewer'
  | 'xmltools'
  | 'flows'
  | 'soap'
  | 'markdown'
  | 'mermaid'
  | 'latex'
  | 'pdfeditor'
  | 'powertools'
  | 'storage'
  | 'database'
  | 'vault'
  | 'workspace'
  | 'themes'
  | 'templates'
  | 'plugins'
  | 'har'
  | 'observe'
  | 'secretscanner'
  | 'settings'
  | 'welcome'
  | 'gitsync'
  | 'mcp'
  | 'apidocs'

// Canonical Cmd/Ctrl+1..7 quick-navigation targets, ordered by expected daily
// use — core tools first, advanced-only tools last. This is deliberately NOT a
// 1:1 mapping of the rail categories in components/layout/Rail.tsx: categories
// without a frequently-used entry point (Infrastructure, Document Studio) have
// no shortcut. Entries gated behind "Show advanced features" are marked below.
export const RAIL_QUICK_NAV: RailItem[] = [
  'collections', // 1 - API Core
  'websocket',   // 2 - Protocols
  'jsonviewer',  // 3 - Power Tools · JSON Studio
  'powertools',  // 4 - Power Tools · Utilities
  'browser',     // 5 - Browser Debug   (advanced)
  'database',    // 6 - Local Data      (advanced)
  'gitsync',     // 7 - Workspace       (advanced)
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
