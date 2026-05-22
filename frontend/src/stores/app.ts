import { create } from 'zustand'
import { useSettingsStore } from '@/stores/settings'

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

export const useAppStore = create<AppState>(() => ({
  activeRail: initialRail,
  railHistory: [],
  devToolsVisible: false,
  mockRunning: false,
  proxyRunning: false,
  websocketRunning: false,
  sseRunning: false,
  browserRunning: false,
  setActiveRail: (rail) => useAppStore.setState((s) => ({
    activeRail: rail,
    railHistory: s.activeRail !== rail ? [...s.railHistory.slice(-19), s.activeRail] : s.railHistory,
  })),
  goBack: () => useAppStore.setState((s) => {
    if (s.railHistory.length === 0) return s
    const prev = s.railHistory[s.railHistory.length - 1]
    return { activeRail: prev, railHistory: s.railHistory.slice(0, -1) }
  }),
  toggleSidebar: () => {
    const current = useSettingsStore.getState().settings.appearance.sidebarCollapsed
    useSettingsStore.getState().updateAppearance({ sidebarCollapsed: !current })
  },
  toggleDevTools: () => useAppStore.setState((s) => ({ devToolsVisible: !s.devToolsVisible })),
  setMockRunning: (v) => useAppStore.setState({ mockRunning: v }),
  setProxyRunning: (v) => useAppStore.setState({ proxyRunning: v }),
  setWebsocketRunning: (v) => useAppStore.setState({ websocketRunning: v }),
  setSseRunning: (v) => useAppStore.setState({ sseRunning: v }),
  setBrowserRunning: (v) => useAppStore.setState({ browserRunning: v }),
}))
