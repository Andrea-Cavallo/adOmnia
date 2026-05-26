import { create } from 'zustand'
import type { Tab, RequestItem, ResponseData, HttpMethod } from '@/lib/types'
import { uid, blankRequest } from '@/lib/types'
import { StorageGet, StoragePut } from '@/wailsjs/go/main/App'
import { debouncedSave } from '@/lib/storeSave'
import { useSettingsStore } from '@/stores/settings'

const BUCKET = 'tabs'
const KEY = 'session-v1'

type PersistedTabsState = {
  version: 1
  tabs: Tab[]
  activeTabId: string | null
  responseHistory: ResponseData[]
}

interface TabsState {
  tabs: Tab[]
  activeTabId: string | null
  responseHistory: ResponseData[]
  loaded: boolean
  loadError: boolean
  load: () => Promise<void>
  save: () => void
  openTab: (request: RequestItem, collectionId?: string) => void
  closeTab: (id: string) => void
  closeTabsToRight: (id: string) => void
  closeTabsToLeft: (id: string) => void
  setActiveTab: (id: string) => void
  newTab: (method?: HttpMethod) => void
  duplicateTab: (id: string) => void
  updateRequest: (tabId: string, request: RequestItem) => void
  setLoading: (tabId: string, loading: boolean) => void
  setResponse: (tabId: string, response: ResponseData | null) => void
  markClean: (tabId: string) => void
}

function historyLimit(): number {
  const settings = useSettingsStore.getState().settings
  return Math.max(0, settings.requests.maxResponseHistoryPerTab || 0)
}

function shouldSaveResponses(): boolean {
  return useSettingsStore.getState().settings.requests.saveResponsesToHistory
}

function cleanLoadedTab(tab: Tab): Tab {
  return { ...tab, loading: false }
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  responseHistory: [],
  loaded: false,
  loadError: false,

  load: async () => {
    try {
      const raw = await StorageGet(BUCKET, KEY)
      const settings = useSettingsStore.getState().settings
      if (!raw) {
        set({ loaded: true, loadError: false })
        return
      }
      const parsed = JSON.parse(raw) as PersistedTabsState
      const restoredTabs = settings.general.restoreTabsOnStartup
        ? (parsed.tabs ?? []).map(cleanLoadedTab)
        : []
      const activeTabId = restoredTabs.some((t) => t.id === parsed.activeTabId)
        ? parsed.activeTabId
        : restoredTabs[0]?.id ?? null
      set({
        tabs: restoredTabs,
        activeTabId,
        responseHistory: (parsed.responseHistory ?? []).slice(0, historyLimit()),
        loaded: true,
        loadError: false,
      })
    } catch (e) {
      console.error('Failed to restore tabs:', e)
      set({ loaded: true, loadError: true })
    }
  },

  save: () => {
    const s = get()
    if (!s.loaded || s.loadError) return
    const { tabs, activeTabId, responseHistory } = s
    const payload: PersistedTabsState = {
      version: 1,
      tabs: useSettingsStore.getState().settings.general.restoreTabsOnStartup ? tabs.map(cleanLoadedTab) : [],
      activeTabId,
      responseHistory: responseHistory.slice(0, historyLimit()),
    }
    debouncedSave('tabs', () => StoragePut(BUCKET, KEY, JSON.stringify(payload)))
  },

  openTab: (request, collectionId) => {
    const existing = get().tabs.find((t) => t.request.id === request.id)
    if (existing) {
      set({ activeTabId: existing.id })
      get().save()
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
    get().save()
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
    get().save()
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
    get().save()
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
    get().save()
  },

  setActiveTab: (id) => {
    set({ activeTabId: id })
    get().save()
  },

  newTab: (method) => {
    const effectiveMethod = method ?? (useSettingsStore.getState().settings.requests.defaultHttpMethod as HttpMethod) ?? 'GET'
    const request = blankRequest(effectiveMethod)
    const requestSettings = useSettingsStore.getState().settings.requests
    request.timeout = requestSettings.defaultTimeoutMs
    request.followRedirects = requestSettings.followRedirects
    const tab: Tab = {
      id: uid(),
      request,
      dirty: false,
      response: null,
      loading: false,
    }
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }))
    get().save()
  },

  duplicateTab: (id) => {
    const src = get().tabs.find((t) => t.id === id)
    if (!src) return
    const newRequest = {
      ...src.request,
      id: uid(),
      name: src.request.name ? `${src.request.name} (Copy)` : 'Copy',
    }
    const newTab: Tab = {
      id: uid(),
      request: newRequest,
      dirty: true,
      response: null,
      loading: false,
    }
    const idx = get().tabs.findIndex((t) => t.id === id)
    set((s) => {
      const updated = [...s.tabs]
      updated.splice(idx + 1, 0, newTab)
      return { tabs: updated, activeTabId: newTab.id }
    })
    get().save()
  },

  updateRequest: (tabId, request) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, request, dirty: true } : t)),
    }))
    get().save()
  },

  setLoading: (tabId, loading) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, loading } : t)),
    }))
    get().save()
  },

  setResponse: (tabId, response) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, response, loading: false } : t)),
      responseHistory: response && shouldSaveResponses()
        ? [response, ...s.responseHistory].slice(0, historyLimit())
        : s.responseHistory,
    }))
    get().save()
  },

  markClean: (tabId) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, dirty: false } : t)),
    }))
    get().save()
  },
}))
