import { useEffect } from 'react'
import { focusWebSocketTab } from '@/lib/websocket/openWebSocketTab'

/**
 * The WebSocket rail item. WebSocket connections are tabs of the API workspace, so this only
 * brings one to the front (or creates it) and switches to the workspace.
 */
export function WebSocketRailEntry() {
  useEffect(() => { focusWebSocketTab() }, [])
  return <div className="h-full bg-surface-0" />
}
