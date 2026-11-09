/**
 * A conversation of frames where a REST tab shows its response: the WebSocket messages and the gRPC streams.
 * Header with title and state, filters, search, export, clear, the timeline and an inspector for one frame.
 */
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Download, Search, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WsFrame } from '@/stores/websocketConnections'
import { WsFrameList } from './WsFrameList'
import { WsFrameInspector } from './WsFrameInspector'
import { MiniButton } from './wsUi'
import { STREAM_FILTERS, frameMatches, framesToJsonl, type StreamFilter } from './wsFormat'

/** Time since a moment, as 1m 05s; ticks every second while set. */
export function useUptime(since: number | null) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!since) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [since])
  if (!since) return ''
  const seconds = Math.max(0, Math.floor((now - since) / 1000))
  const minutes = Math.floor(seconds / 60)
  return minutes ? `${minutes}m ${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`
}

function downloadJsonl(text: string, prefix: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/jsonl' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `adomnia-${prefix}-${Date.now()}.jsonl`
  anchor.click()
  URL.revokeObjectURL(url)
}

export interface FrameStreamViewProps {
  title: string
  /** The state chip next to the title. */
  state: ReactNode
  frames: WsFrame[]
  /** More chips in the header (clients, logs…). */
  headerExtra?: ReactNode
  headerActions?: ReactNode
  /** Buttons before Export and Clear (Ping, Pause…). */
  toolbarExtra?: ReactNode
  onClear: () => void
  emptyHint: string
  /** File name prefix of the export. */
  exportName: string
}

export function FrameStreamView({ title, state, frames, headerExtra, headerActions, toolbarExtra, onClear, emptyHint, exportName }: FrameStreamViewProps) {
  const [filter, setFilter] = useState<StreamFilter>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** The inspector takes the whole panel, to read a long message without scrolling a small box. */
  const [expanded, setExpanded] = useState(false)
  const deferredQuery = useDeferredValue(query)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  const visible = useMemo(() => frames.filter((frame) => frameMatches(frame, filter, deferredQuery)), [frames, filter, deferredQuery])
  const selected = selectedId ? frames.find((frame) => frame.id === selectedId) ?? null : null
  const inbound = frames.filter((frame) => frame.direction === 'inbound').length
  const outbound = frames.filter((frame) => frame.direction === 'outbound').length

  // Follow new frames while the list is scrolled to the bottom, like a terminal.
  useEffect(() => {
    const element = scrollRef.current
    if (element && stickToBottom.current) element.scrollTop = element.scrollHeight
  }, [visible.length])

  return (
    <div data-frame-stream className="flex min-h-0 flex-1 flex-col">
      <div data-response-header className="flex h-9 shrink-0 items-center gap-2.5 overflow-hidden border-b border-border-1 bg-surface-1 px-3">
        <span className="api-dot-label">{title}</span>
        {state}
        {frames.length > 0 && <span className="hidden shrink-0 font-mono text-[10px] text-text-4 sm:inline" title="Received / sent">↓{inbound} ↑{outbound}</span>}
        {headerExtra}
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
        {toolbarExtra}
        <MiniButton onClick={() => downloadJsonl(framesToJsonl(frames), exportName)} disabled={frames.length === 0} title="Export the conversation as JSON Lines"><Download size={12} /> Export</MiniButton>
        <MiniButton onClick={() => { onClear(); setSelectedId(null) }} disabled={frames.length === 0} title="Clear the conversation"><Trash2 size={12} /> Clear</MiniButton>
      </div>

      <div
        ref={scrollRef}
        hidden={!!selected && expanded}
        onScroll={(event) => {
          const element = event.currentTarget
          stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24
        }}
        className={cn('overflow-y-auto', selected ? 'min-h-[96px] flex-[2]' : 'min-h-0 flex-1')}
      >
        <WsFrameList
          frames={visible}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId((current) => (current === id ? null : id))}
          onOpen={(id) => { setSelectedId(id); setExpanded(true) }}
          emptyHint={frames.length ? 'No message matches the filter.' : emptyHint}
        />
      </div>
      {selected && (
        <div className={cn('flex min-h-[200px] flex-col', expanded ? 'flex-1' : 'flex-[3] border-t border-border-1')}>
          <WsFrameInspector
            frame={selected}
            onClose={() => { setSelectedId(null); setExpanded(false) }}
            expanded={expanded}
            onToggleExpanded={() => setExpanded((current) => !current)}
          />
        </div>
      )}
    </div>
  )
}
