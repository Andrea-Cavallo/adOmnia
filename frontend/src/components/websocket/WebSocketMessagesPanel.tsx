/**
 * The right half of a WebSocket tab, where a REST tab shows its response: the live conversation of the
 * connection, with Ping, Pause and the service's connection logs on top of the shared frame view.
 */
import type { ReactNode } from 'react'
import { Activity, PauseCircle, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import { openWebSocketLogs } from '@/lib/devsession/websocketHandler'
import { emptyConnection, useWsConnections } from '@/stores/websocketConnections'
import { WS_STATUS_DOT, WS_STATUS_LABEL } from './wsStatus'
import { MiniButton } from './wsUi'
import { FrameStreamView, useUptime } from './FrameStreamView'

const IDLE = emptyConnection()

export function WebSocketMessagesPanel({ tabId, headerActions }: { tabId: string; headerActions?: ReactNode }) {
  const connection = useWsConnections((state) => state.connections[tabId]) ?? IDLE
  const clear = useWsConnections((state) => state.clear)
  const setPaused = useWsConnections((state) => state.setPaused)
  const ping = useWsConnections((state) => state.ping)
  const uptime = useUptime(connection.connectedAt)
  const status = connection.status
  return (
    <FrameStreamView
      title="Messages"
      exportName="websocket"
      frames={connection.frames}
      onClear={() => clear(tabId)}
      emptyHint="Connect, then send a saved message. Ctrl+Enter sends."
      headerActions={headerActions}
      state={(
        <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] font-medium text-text-3" data-ws-status={status}>
          <span className={cn('h-1.5 w-1.5 rounded-full', WS_STATUS_DOT[status])} />
          {WS_STATUS_LABEL[status]}{uptime && ` · ${uptime}`}
        </span>
      )}
      headerExtra={(
        <>
          {connection.extraClients.length > 0 && <span className="shrink-0 rounded bg-warning/15 px-1.5 font-mono text-[10px] text-warning">+{connection.extraClients.length} clients</span>}
          {connection.live && (
            <button type="button" onClick={() => void openWebSocketLogs(connection.live!)} title="The service's log lines for this connection in the Log Inspector" className="shrink-0 rounded border border-border-2 px-1.5 py-0.5 text-[10px] text-text-2 hover:border-accent hover:text-accent">Connection logs</button>
          )}
        </>
      )}
      toolbarExtra={(
        <>
          <MiniButton onClick={() => void ping(tabId)} disabled={status !== 'connected'} title="Send a ping frame"><Activity size={12} /> Ping</MiniButton>
          <MiniButton active={connection.paused} onClick={() => setPaused(tabId, !connection.paused)} title={connection.paused ? 'Show the messages that arrived while paused' : 'Freeze the list; new messages wait'}>
            {connection.paused ? <Play size={12} /> : <PauseCircle size={12} />} {connection.paused ? `Resume${connection.queued.length ? ` · ${connection.queued.length}` : ''}` : 'Pause'}
          </MiniButton>
        </>
      )}
    />
  )
}
