import { create } from 'zustand'
import type { Tab, RequestItem, ResponseData, HttpMethod } from '@/lib/types'
import { uid, blankRequest } from '@/lib/types'

interface TabsState {
  tabs: Tab[]
  activeTabId: string | null
  responseHistory: ResponseData[]
  openTab: (request: RequestItem, collectionId?: string) => void
  closeTab: (id: string) => void
  closeTabsToRight: (id: string) => void
  closeTabsToLeft: (id: string) => void
  setActiveTab: (id: string) => void
  newTab: (method?: HttpMethod) => void
  updateRequest: (tabId: string, request: RequestItem) => void
  setLoading: (tabId: string, loading: boolean) => void
  setResponse: (tabId: string, response: ResponseData | null) => void
  markClean: (tabId: string) => void
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  responseHistory: [],

  openTab: (request, collectionId) => {
    const existing = get().tabs.find((t) => t.request.id === request.id)
    if (existing) {
      set({ activeTabId: existing.id })
      return
    }
    const tab: Tab = {
      id: uid(),
      request: { ...request },
      collectionId,
      dirty: false,
      response: null,
      loading: false,
    }
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }))
  },

  closeTab: (id) => {
    set((s) => {
      const filtered = s.tabs.filter((t) => t.id !== id)
      let activeTabId = s.activeTabId
      if (activeTabId === id) {
        const idx = s.tabs.findIndex((t) => t.id === id)
        activeTabId = filtered[Math.min(idx, filtered.length - 1)]?.id ?? null
      }
      return { tabs: filtered, activeTabId }
    })
  },

  closeTabsToRight: (id) => {
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id)
      if (idx === -1) return s
      const filtered = s.tabs.filter((_, i) => i <= idx)
      const activeTabStillExists = filtered.some((t) => t.id === s.activeTabId)
      return {
        tabs: filtered,
        activeTabId: activeTabStillExists ? s.activeTabId : filtered[filtered.length - 1]?.id ?? null,
      }
    })
  },

  closeTabsToLeft: (id) => {
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id)
      if (idx === -1) return s
      const filtered = s.tabs.filter((_, i) => i >= idx)
      const activeTabStillExists = filtered.some((t) => t.id === s.activeTabId)
      return {
        tabs: filtered,
        activeTabId: activeTabStillExists ? s.activeTabId : filtered[0]?.id ?? null,
      }
    })
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  newTab: (method = 'GET') => {
    const request = blankRequest(method)
    const tab: Tab = {
      id: uid(),
      request,
      dirty: false,
      response: null,
      loading: false,
    }
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }))
  },

  updateRequest: (tabId, request) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, request, dirty: true } : t)),
    }))
  },

  setLoading: (tabId, loading) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, loading } : t)),
    }))
  },

  setResponse: (tabId, response) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, response, loading: false } : t)),
      responseHistory: response ? [response, ...s.responseHistory].slice(0, 100) : s.responseHistory,
    }))
  },

  markClean: (tabId) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, dirty: false } : t)),
    }))
  },
}))
