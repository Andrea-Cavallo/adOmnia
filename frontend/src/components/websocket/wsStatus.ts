import type { WsStatus } from '@/stores/websocketConnections'

export const WS_STATUS_LABEL: Record<WsStatus, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  error: 'Error',
}

export const WS_STATUS_DOT: Record<WsStatus, string> = {
  disconnected: 'bg-text-4',
  connecting: 'bg-warning motion-safe:animate-pulse',
  connected: 'bg-success',
  reconnecting: 'bg-warning motion-safe:animate-pulse',
  error: 'bg-error',
}
