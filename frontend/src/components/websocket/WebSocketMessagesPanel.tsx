/**
 * The right half of a WebSocket tab, where a REST tab shows its response: the live conversation
 * with filters, search, pause, export and an inspector for the selected frame.
 */
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Activity, Download, PauseCircle, Play, Search, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { openWebSocketLogs } from '@/lib/devsession/websocketHandler'
import { emptyConnection, useWsConnections } from '@/stores/websocketConnections'
import { WS_STATUS_DOT, WS_STATUS_LABEL } from './wsStatus'
import { WsFrameList } from './WsFrameList'
import { WsFrameInspector } from './WsFrameInspector'
import { MiniButton } from './wsUi'
import { STREAM_FILTERS, frameMatches, framesToJsonl, type StreamFilter } from './wsFormat'

const IDLE = emptyConnection()

/** Time since the connection opened, as 1m 05s. */
function useUptime(connectedAt: number | null) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!connectedAt) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [connectedAt])
  if (!connectedAt) return ''
  const seconds = Math.max(0, Math.floor((now - connectedAt) / 1000))
  const minutes = Math.floor(seconds / 60)
  return minutes ? `${minutes}m ${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`
}

function downloadJsonl(text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/jsonl' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `adomnia-websocket-${Date.now()}.jsonl`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function WebSocketMessagesPanel({ tabId, headerActions }: { tabId: string; headerActions?: ReactNode }) {
  const connection = useWsConnections((state) => state.connections[tabId]) ?? IDLE
  const clear = useWsConnections((state) => state.clear)
  const setPaused = useWsConnections((state) => state.setPaused)
  const ping = useWsConnections((state) => state.ping)
  const [filter, setFilter] = useState<StreamFilter>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const deferredQuery = useDeferredValue(query)
  const uptime = useUptime(connection.connectedAt)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  const frames = connection.frames
  const visible = useMemo(() => frames.filter((frame) => frameMatches(frame, filter, deferredQuery)), [frames, filter, deferredQuery])
  const selected = selectedId ? frames.find((frame) => frame.id === selectedId) ?? null : null
  const inbound = frames.filter((frame) => frame.direction === 'inbound').length
  const outbound = frames.filter((frame) => frame.direction === 'outbound').length

  // Follow new frames while the list is scrolled to the bottom, like a terminal.
  useEffect(() => {
    const element = scrollRef.current
    if (element && stickToBottom.current) element.scrollTop = element.scrollHeight
  }, [visible.length])

  const status = connection.status
  return (
    <div data-ws-messages className="flex min-h-0 flex-1 flex-col">
      <div data-response-header className="flex h-9 shrink-0 items-center gap-2.5 overflow-hidden border-b border-border-1 bg-surface-1 px-3">
        <span className="api-dot-label">Messages</span>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] font-medium text-text-3" data-ws-status={status}>
          <span className={cn('h-1.5 w-1.5 rounded-full', WS_STATUS_DOT[status])} />
          {WS_STATUS_LABEL[status]}{uptime && ` · ${uptime}`}
        </span>
        {frames.length > 0 && (
          <span className="hidden shrink-0 font-mono text-[10px] text-text-4 sm:inline" title="Received / sent">↓{inbound} ↑{outbound}</span>
        )}
        {connection.extraClients.length > 0 && <span className="shrink-0 rounded bg-warning/15 px-1.5 font-mono text-[10px] text-warning">+{connection.extraClients.length} clients</span>}
        {connection.live && (
          <button type="button" onClick={() => void openWebSocketLogs(connection.live!)} title="The service's log lines for this connection in the Log Inspector" className="shrink-0 rounded border border-border-2 px-1.5 py-0.5 text-[10px] text-text-2 hover:border-accent hover:text-accent">Connection logs</button>
        )}
        {headerActions && <div className="ml-auto flex shrink-0 items-center">{headerActions}</div>}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border-1 px-3 py-1.5">
        <div className="flex items-center rounded border border-border-2 bg-surface-1 p-0.5" role="group" aria-label="Filter messages">
          {STREAM_FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
              className={cn('h-6 rounded px-2 text-[10.5px] font-semibold transition-colors', filter === item.id ? 'bg-accent/15 text-accent' : 'text-text-3 hover:text-text-1')}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="flex h-7 min-w-[140px] flex-1 items-center gap-2 rounded border border-border-2 bg-surface-0 px-2 focus-within:border-accent/50">
          <Search size={12} className="text-text-4" />
          <span className="sr-only">Search messages</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search messages…" className="h-full min-w-0 flex-1 bg-transparent font-mono text-[11px] text-text-1 outline-none placeholder:text-text-4" />
        </label>
        <MiniButton onClick={() => void ping(tabId)} disabled={connection.status !== 'connected'} title="Send a ping frame"><Activity size={12} /> Ping</MiniButton>
        <MiniButton active={connection.paused} onClick={() => setPaused(tabId, !connection.paused)} title={connection.paused ? 'Show the messages that arrived while paused' : 'Freeze the list; new messages wait'}>
          {connection.paused ? <Play size={12} /> : <PauseCircle size={12} />} {connection.paused ? `Resume${connection.queued.length ? ` · ${connection.queued.length}` : ''}` : 'Pause'}
        </MiniButton>
        <MiniButton onClick={() => downloadJsonl(framesToJsonl(frames))} disabled={frames.length === 0} title="Export the conversation as JSON Lines"><Download size={12} /> Export</MiniButton>
        <MiniButton onClick={() => { clear(tabId); setSelectedId(null) }} disabled={frames.length === 0} title="Clear the conversation"><Trash2 size={12} /> Clear</MiniButton>
      </div>

      <div
        ref={scrollRef}
        onScroll={(event) => {
          const element = event.currentTarget
          stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24
        }}
        className={cn('overflow-y-auto', selected ? 'min-h-[96px] flex-[3]' : 'min-h-0 flex-1')}
      >
        <WsFrameList
          frames={visible}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId((current) => (current === id ? null : id))}
          emptyHint={frames.length ? 'No message matches the filter.' : 'Connect, then send a saved message. Ctrl+Enter sends.'}
        />
      </div>
      {selected && (
        <div className="flex min-h-[120px] flex-[2] flex-col border-t border-border-1">
          <WsFrameInspector frame={selected} onClose={() => setSelectedId(null)} />
        </div>
      )}
    </div>
  )
}
