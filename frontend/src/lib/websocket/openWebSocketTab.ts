/**
 * Ways into a WebSocket tab: the WebSocket rail item, a WebSocket entity found
 * in code, and "New WebSocket". They all end in the WebSocket module, whose tab
 * strip holds only WebSocket connections.
 */
import { useAppStore } from '@/stores/app'
import { useTabsStore } from '@/stores/tabs'
import type { RequestItem } from '@/lib/types'
import { blankWebSocketRequest, takeLegacyWebSocketRequest } from './wsRequest'

function showWebSocketModule() {
  if (useAppStore.getState().activeRail !== 'websocket') useAppStore.getState().setActiveRail('websocket')
}

export function openWebSocketTab(request: RequestItem = blankWebSocketRequest()): void {
  useTabsStore.getState().openTab(request)
  showWebSocketModule()
}

/** A WebSocket entity from code: a new connection on its URL, never connected by itself. */
export function openWebSocketUrl(url: string, name = 'WebSocket'): void {
  openWebSocketTab(blankWebSocketRequest(name, url))
}

/**
 * The old WebSocket panel's saved connection, migrated into the module once.
 * Called when the module opens with no connection of its own.
 */
export function migrateLegacyWebSocketTab(): void {
  const legacy = takeLegacyWebSocketRequest()
  if (legacy) openWebSocketTab(legacy)
}
