import { create } from 'zustand'
import type { Tab, RequestItem, RequestHistoryEntry, ResponseData, HttpMethod } from '@/lib/types'
import { uid, blankRequest } from '@/lib/types'
import { debouncedSave } from '@/lib/storeSave'
import { safeStorageGet, safeStoragePut } from '@/lib/wailsStorage'
import { useSettingsStore } from '@/stores/settings'
import { useCollectionsStore } from '@/stores/collections'

const BUCKET = 'tabs'
const KEY = 'session-v1'

type PersistedTabsState = {
  version: 1 | 2
  tabs: Tab[]
  activeTabId: string | null
  responseHistory: Array<RequestHistoryEntry | ResponseData>
}

export type ComposerSection = 'overview' | 'params' | 'headers' | 'body' | 'scripts'
export type ResponseSection = 'body' | 'headers' | 'contract' | 'assertions'
export type ResponseBodyView = 'pretty' | 'raw' | 'graph'
export type TabDropPosition = 'before' | 'after'

export interface TabViewState {
  composerSection: ComposerSection
  composerScrollTop: number
  composerContentScrollTop: Partial<Record<ComposerSection, number>>
  responseSection: ResponseSection
  responseBodyView: ResponseBodyView
  responseScrollTop: Partial<Record<ResponseSection, number>>
  responseGraphExpanded: string[]
}

interface TabsState {
  tabs: Tab[]
  activeTabId: string | null
  responseHistory: RequestHistoryEntry[]
  viewStateByTabId: Record<string, TabViewState>
  loaded: boolean
  loadError: boolean
  load: () => Promise<void>
  save: () => void
  activateWorkspace: (workspaceId: string) => void
  deleteWorkspaceTabs: (workspaceId: string) => void
  moveCollectionTabs: (collectionId: string, targetWorkspaceId: string) => void
  openTab: (request: RequestItem, collectionId?: string) => void
  closeTab: (id: string) => void
  closeRequestTabs: (requestId: string) => void
  renameRequestTabs: (requestId: string, name: string) => void
  closeTabsToRight: (id: string) => void
  closeTabsToLeft: (id: string) => void
  reorderTab: (fromId: string, toId: string, position: TabDropPosition) => void
  setActiveTab: (id: string) => void
  newTab: (method?: HttpMethod) => void
  duplicateTab: (id: string) => void
  updateRequest: (tabId: string, request: RequestItem) => void
  setLoading: (tabId: string, loading: boolean) => void
  setResponse: (tabId: string, response: ResponseData | null) => void
  openHistoryEntry: (entryId: string) => void
  removeHistoryEntry: (entryId: string) => void
  clearResponseHistory: () => void
  markClean: (tabId: string) => void
  getViewState: (tabId: string) => TabViewState
  updateViewState: (tabId: string, patch: Partial<TabViewState>) => void
}

function historyLimit(): number {
  const settings = useSettingsStore.getState().settings
  return Math.max(0, settings.requests.maxResponseHistoryPerTab || 0)
}

function shouldSaveResponses(): boolean {
  return useSettingsStore.getState().settings.requests.saveResponsesToHistory
}

function cleanLoadedTab(tab: Tab): Tab {
  return {
    ...tab,
    workspaceId: tab.workspaceId ?? useCollectionsStore.getState().activeWorkspaceId,
    loading: false,
  }
}

function activeWorkspaceId(): string {
  return useCollectionsStore.getState().activeWorkspaceId
}

function belongsToWorkspace(tab: Tab, workspaceId = activeWorkspaceId()): boolean {
  return (tab.workspaceId ?? workspaceId) === workspaceId
}

function isHistoryEntry(value: RequestHistoryEntry | ResponseData): value is RequestHistoryEntry {
  return 'response' in value
}

function cloneForHistory<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function normalizeHistoryEntries(history: Array<RequestHistoryEntry | ResponseData> | undefined): RequestHistoryEntry[] {
  return (history ?? []).map((item) => isHistoryEntry(item)
    ? item
    : { id: uid(), recordedAt: null, response: item })
}

function defaultViewState(): TabViewState {
  return {
    composerSection: 'overview',
    composerScrollTop: 0,
    composerContentScrollTop: {},
    responseSection: 'body',
    responseBodyView: 'pretty',
    responseScrollTop: {},
    responseGraphExpanded: ['$'],
  }
}

function retainViewStates(
  viewStateByTabId: Record<string, TabViewState>,
  tabs: Tab[],
): Record<string, TabViewState> {
  return Object.fromEntries(
    tabs.flatMap((tab) => viewStateByTabId[tab.id] ? [[tab.id, viewStateByTabId[tab.id]]] : []),
  )
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  responseHistory: [],
  viewStateByTabId: {},
  loaded: false,
  loadError: false,

  load: async () => {
    try {
      const raw = await safeStorageGet(BUCKET, KEY)
      const settings = useSettingsStore.getState().settings
      if (!raw) {
        set({ loaded: true, loadError: false })
        return
      }
      const parsed = JSON.parse(raw) as PersistedTabsState
      const restoredTabs = settings.general.restoreTabsOnStartup
        ? (parsed.tabs ?? []).map(cleanLoadedTab)
        : []
      const activeTabId = restoredTabs.some((t) => t.id === parsed.activeTabId && belongsToWorkspace(t))
        ? parsed.activeTabId
        : restoredTabs.find((tab) => belongsToWorkspace(tab))?.id ?? null
      set({
        tabs: restoredTabs,
        activeTabId,
        responseHistory: normalizeHistoryEntries(parsed.responseHistory).slice(0, historyLimit()),
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
      version: 2,
      tabs: useSettingsStore.getState().settings.general.restoreTabsOnStartup ? tabs.map(cleanLoadedTab) : [],
      activeTabId,
      responseHistory: responseHistory.slice(0, historyLimit()),
    }
    debouncedSave('tabs', () => safeStoragePut(BUCKET, KEY, JSON.stringify(payload)))
  },

  activateWorkspace: (workspaceId) => {
    set((s) => ({
      activeTabId: s.tabs.find((tab) => belongsToWorkspace(tab, workspaceId))?.id ?? null,
    }))
    get().save()
  },

  deleteWorkspaceTabs: (workspaceId) => {
    set((s) => {
      const tabs = s.tabs.filter((tab) => tab.workspaceId !== workspaceId)
      const activeTabId = tabs.some((tab) => tab.id === s.activeTabId)
        ? s.activeTabId
        : tabs.find((tab) => belongsToWorkspace(tab))?.id ?? null
      return {
        tabs,
        activeTabId,
        viewStateByTabId: retainViewStates(s.viewStateByTabId, tabs),
      }
    })
    get().save()
  },

  moveCollectionTabs: (collectionId, targetWorkspaceId) => {
    const sourceWorkspaceId = activeWorkspaceId()
    set((s) => {
      const tabs = s.tabs.map((tab) => (
        tab.collectionId === collectionId && belongsToWorkspace(tab, sourceWorkspaceId)
          ? { ...tab, workspaceId: targetWorkspaceId }
          : tab
      ))
      const activeTabMoved = s.tabs.some((tab) => (
        tab.id === s.activeTabId &&
        tab.collectionId === collectionId &&
        belongsToWorkspace(tab, sourceWorkspaceId)
      ))
      return {
        tabs,
        activeTabId: activeTabMoved
          ? tabs.find((tab) => belongsToWorkspace(tab) && tab.collectionId !== collectionId)?.id ?? null
          : s.activeTabId,
      }
    })
    get().save()
  },

  openTab: (request, collectionId) => {
    const workspaceId = activeWorkspaceId()
    const existing = get().tabs.find((t) => t.request.id === request.id && belongsToWorkspace(t, workspaceId))
    if (existing) {
      set({ activeTabId: existing.id })
      get().save()
      return
    }
    const tab: Tab = {
      id: uid(),
      request: { ...request },
      collectionId,
      workspaceId,
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
        const visibleTabs = s.tabs.filter((tab) => belongsToWorkspace(tab))
        const idx = visibleTabs.findIndex((t) => t.id === id)
        const remainingVisibleTabs = filtered.filter((tab) => belongsToWorkspace(tab))
        activeTabId = remainingVisibleTabs[Math.min(idx, remainingVisibleTabs.length - 1)]?.id ?? null
      }
      return { tabs: filtered, activeTabId }
    })
    set((s) => ({ viewStateByTabId: retainViewStates(s.viewStateByTabId, s.tabs) }))
    get().save()
  },

  closeRequestTabs: (requestId) => {
    set((s) => {
      const tabs = s.tabs.filter((tab) => tab.request.id !== requestId)
      const activeTabId = tabs.some((tab) => tab.id === s.activeTabId)
        ? s.activeTabId
        : tabs.find((tab) => belongsToWorkspace(tab))?.id ?? null
      return {
        tabs,
        activeTabId,
        viewStateByTabId: retainViewStates(s.viewStateByTabId, tabs),
      }
    })
    get().save()
  },

  renameRequestTabs: (requestId, name) => {
    set((s) => ({
      tabs: s.tabs.map((tab) => (
        tab.request.id === requestId ? { ...tab, request: { ...tab.request, name } } : tab
      )),
    }))
    get().save()
  },

  closeTabsToRight: (id) => {
    set((s) => {
      const workspaceTabs = s.tabs.filter((tab) => belongsToWorkspace(tab))
      const idx = workspaceTabs.findIndex((t) => t.id === id)
      if (idx === -1) return s
      const removeIds = new Set(workspaceTabs.slice(idx + 1).map((tab) => tab.id))
      const filtered = s.tabs.filter((tab) => !removeIds.has(tab.id))
      const activeTabStillExists = filtered.some((t) => t.id === s.activeTabId)
      const remainingWorkspaceTabs = filtered.filter((tab) => belongsToWorkspace(tab))
      return {
        tabs: filtered,
        activeTabId: activeTabStillExists ? s.activeTabId : remainingWorkspaceTabs[remainingWorkspaceTabs.length - 1]?.id ?? null,
        viewStateByTabId: retainViewStates(s.viewStateByTabId, filtered),
      }
    })
    get().save()
  },

  closeTabsToLeft: (id) => {
    set((s) => {
      const workspaceTabs = s.tabs.filter((tab) => belongsToWorkspace(tab))
      const idx = workspaceTabs.findIndex((t) => t.id === id)
      if (idx === -1) return s
      const removeIds = new Set(workspaceTabs.slice(0, idx).map((tab) => tab.id))
      const filtered = s.tabs.filter((tab) => !removeIds.has(tab.id))
      const activeTabStillExists = filtered.some((t) => t.id === s.activeTabId)
      return {
        tabs: filtered,
        activeTabId: activeTabStillExists ? s.activeTabId : filtered.find((tab) => belongsToWorkspace(tab))?.id ?? null,
        viewStateByTabId: retainViewStates(s.viewStateByTabId, filtered),
      }
    })
    get().save()
  },

  reorderTab: (fromId, toId, position) => {
    if (fromId === toId) return
    set((s) => {
      const moving = s.tabs.find((tab) => tab.id === fromId)
      if (!moving || !s.tabs.some((tab) => tab.id === toId)) return s
      const reordered = s.tabs.filter((tab) => tab.id !== fromId)
      const targetIndex = reordered.findIndex((tab) => tab.id === toId)
      const insertIndex = targetIndex + (position === 'after' ? 1 : 0)
      reordered.splice(insertIndex, 0, moving)
      return { tabs: reordered }
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
      workspaceId: activeWorkspaceId(),
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
      collectionId: src.collectionId,
      workspaceId: src.workspaceId ?? activeWorkspaceId(),
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
    set((s) => {
      const tab = s.tabs.find((current) => current.id === tabId)
      const entry: RequestHistoryEntry | null = response && tab && shouldSaveResponses()
        ? {
            id: uid(),
            recordedAt: new Date().toISOString(),
            request: cloneForHistory(tab.request),
            response: cloneForHistory(response),
          }
        : null
      return {
        tabs: s.tabs.map((current) => (current.id === tabId ? { ...current, response, loading: false } : current)),
        responseHistory: entry
          ? [entry, ...s.responseHistory].slice(0, historyLimit())
          : s.responseHistory,
      }
    })
    get().save()
  },

  openHistoryEntry: (entryId) => {
    const entry = get().responseHistory.find((candidate) => candidate.id === entryId)
    if (!entry?.request) return
    const request = cloneForHistory(entry.request)
    request.id = uid()
    const tab: Tab = {
      id: uid(),
      request,
      workspaceId: activeWorkspaceId(),
      dirty: false,
      response: cloneForHistory(entry.response),
      loading: false,
    }
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }))
    get().save()
  },

  removeHistoryEntry: (entryId) => {
    set((s) => ({ responseHistory: s.responseHistory.filter((entry) => entry.id !== entryId) }))
    get().save()
  },

  clearResponseHistory: () => {
    set({ responseHistory: [] })
    get().save()
  },

  markClean: (tabId) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, dirty: false } : t)),
    }))
    get().save()
  },

  getViewState: (tabId) => get().viewStateByTabId[tabId] ?? defaultViewState(),

  updateViewState: (tabId, patch) => {
    set((s) => ({
      viewStateByTabId: {
        ...s.viewStateByTabId,
        [tabId]: { ...(s.viewStateByTabId[tabId] ?? defaultViewState()), ...patch },
      },
    }))
  },
}))
