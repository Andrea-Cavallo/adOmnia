import { create } from 'zustand'

export interface DebugNetworkEntry {
  id: string
  url: string
  method: string
  status: number
  statusText: string
  mimeType: string
  requestHeaders: Record<string, string>
  responseHeaders: Record<string, string>
  timestamp: number
  duration: number
  size: number
  completed: boolean
}

export type TypeFilter = 'all' | 'xhr' | 'doc' | 'css' | 'js' | 'img' | 'font' | 'other'

interface BrowserDebugState {
  connected: boolean
  entries: DebugNetworkEntry[]
  selectedEntry: DebugNetworkEntry | null
  filter: string
  typeFilter: TypeFilter

  setConnected: (v: boolean) => void
  setEntries: (entries: DebugNetworkEntry[]) => void
  addEntry: (entry: DebugNetworkEntry) => void
  setSelectedEntry: (entry: DebugNetworkEntry | null) => void
  setFilter: (f: string) => void
  setTypeFilter: (t: TypeFilter) => void
  clearEntries: () => void
}

export const useBrowserDebugStore = create<BrowserDebugState>((set) => ({
  connected: false,
  entries: [],
  selectedEntry: null,
  filter: '',
  typeFilter: 'all',

  setConnected: (v) => set({ connected: v }),
  setEntries: (entries) => set({ entries }),
  addEntry: (entry) => set((s) => ({ entries: [...s.entries, entry] })),
  setSelectedEntry: (entry) => set({ selectedEntry: entry }),
  setFilter: (f) => set({ filter: f }),
  setTypeFilter: (t) => set({ typeFilter: t }),
  clearEntries: () => set({ entries: [], selectedEntry: null }),
}))
