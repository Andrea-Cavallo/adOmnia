import { create } from 'zustand'

export type RailItem =
  | 'collections'
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
  | 'matrix'
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
  | 'har'
  | 'observe'
  | 'secretscanner'
  | 'settings'
  | 'welcome'

interface AppState {
  activeRail: RailItem
  railHistory: RailItem[]
  sidebarCollapsed: boolean
  devToolsVisible: boolean
  mockRunning: boolean
  proxyRunning: boolean
  websocketRunning: boolean
  sseRunning: boolean
  browserRunning: boolean
  setActiveRail: (rail: RailItem) => void
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

export const useAppStore = create<AppState>((set) => ({
  activeRail: initialRail,
  railHistory: [],
  sidebarCollapsed: false,
  devToolsVisible: false,
  mockRunning: false,
  proxyRunning: false,
  websocketRunning: false,
  sseRunning: false,
  browserRunning: false,
  setActiveRail: (rail) => set((s) => ({
    activeRail: rail,
    railHistory: s.activeRail !== rail ? [...s.railHistory.slice(-19), s.activeRail] : s.railHistory,
  })),
  goBack: () => set((s) => {
    if (s.railHistory.length === 0) return s
    const prev = s.railHistory[s.railHistory.length - 1]
    return { activeRail: prev, railHistory: s.railHistory.slice(0, -1) }
  }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleDevTools: () => set((s) => ({ devToolsVisible: !s.devToolsVisible })),
  setMockRunning: (v) => set({ mockRunning: v }),
  setProxyRunning: (v) => set({ proxyRunning: v }),
  setWebsocketRunning: (v) => set({ websocketRunning: v }),
  setSseRunning: (v) => set({ sseRunning: v }),
  setBrowserRunning: (v) => set({ browserRunning: v }),
}))
