/**
 * Ways into a WebSocket tab of the API workspace: the WebSocket rail item, a WebSocket entity
 * found in code, and "New WebSocket". All of them end on the API workspace with the tab active.
 */
import { useAppStore } from '@/stores/app'
import { useCollectionsStore } from '@/stores/collections'
import { useTabsStore } from '@/stores/tabs'
import type { RequestItem } from '@/lib/types'
import { blankWebSocketRequest, isWebSocketRequest, takeLegacyWebSocketRequest } from './wsRequest'

function showWorkspace() {
  if (useAppStore.getState().activeRail !== 'collections') useAppStore.getState().setActiveRail('collections')
}

export function openWebSocketTab(request: RequestItem = blankWebSocketRequest()): void {
  useTabsStore.getState().openTab(request)
  showWorkspace()
}

/** A WebSocket entity from code: a new connection on its URL, never connected by itself. */
export function openWebSocketUrl(url: string, name = 'WebSocket'): void {
  openWebSocketTab(blankWebSocketRequest(name, url))
}

/**
 * The WebSocket rail item: the WebSocket tab already in front, else the last one open, else the
 * old panel's saved connection (once), else a new one.
 */
export function focusWebSocketTab(): void {
  const tabs = useTabsStore.getState()
  const workspaceId = useCollectionsStore.getState().activeWorkspaceId
  const open = tabs.tabs.filter((tab) => !tab.tool && isWebSocketRequest(tab.request) && (tab.workspaceId ?? workspaceId) === workspaceId)
  const active = open.find((tab) => tab.id === tabs.activeTabId) ?? open[open.length - 1]
  if (active) {
    tabs.setActiveTab(active.id)
    showWorkspace()
    return
  }
  openWebSocketTab(takeLegacyWebSocketRequest() ?? undefined)
}
