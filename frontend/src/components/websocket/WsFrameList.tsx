import { memo } from 'react'
import { Wifi } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WsFrame } from '@/stores/websocketConnections'
import { compactPayload, fmtTime, topicOf } from './wsFormat'

const dotTone = (frame: WsFrame) => {
  if (frame.type === 'error') return 'bg-error'
  if (frame.direction === 'inbound') return 'bg-accent'
  return frame.direction === 'outbound' ? 'bg-info' : 'bg-text-4'
}

const badge = (frame: WsFrame) => {
  if (frame.type === 'error') return { label: 'ERR', tone: 'bg-error/20 text-error' }
  if (frame.direction === 'inbound') return { label: 'IN', tone: 'bg-accent/20 text-accent' }
  if (frame.direction === 'outbound') return { label: 'OUT', tone: 'bg-info/20 text-info' }
  return { label: 'SYS', tone: 'bg-surface-3 text-text-3' }
}

interface FrameRowProps { frame: WsFrame; selected: boolean; onSelect: (id: string) => void; onOpen: (id: string) => void }

const FrameRow = memo(function FrameRow({ frame, selected, onSelect, onOpen }: FrameRowProps) {
  const { label, tone } = badge(frame)
  return (
    <button
      type="button"
      onClick={() => onSelect(frame.id)}
      onDoubleClick={() => onOpen(frame.id)}
      title="Click to inspect, double-click to read it in the whole panel"
      aria-pressed={selected}
      className={cn(
        'group relative grid w-full grid-cols-[84px_40px_minmax(0,1fr)] items-start gap-2 rounded-md border px-2 py-2 text-left transition-colors',
        selected ? 'border-accent/60 bg-accent/10' : 'border-transparent hover:border-border-2 hover:bg-surface-2/70',
      )}
    >
      <span className={cn('absolute -left-[13px] top-3 h-2 w-2 rounded-full border border-surface-0', dotTone(frame))} />
      <span className="pt-0.5 font-mono text-[11px] text-text-4">{fmtTime(frame.timestamp)}</span>
      <span className={cn('inline-flex h-5 w-fit items-center rounded px-1.5 font-mono text-[10px] font-semibold', tone)}>{label}</span>
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          {frame.client && <span className="rounded bg-warning/15 px-1 font-mono text-[9px] font-semibold text-warning">{frame.client}</span>}
          <span className="block truncate text-[12.5px] font-semibold text-text-1">{topicOf(frame)}</span>
        </span>
        {/* Up to three lines of the payload, so a message reads without opening it. */}
        <span className={cn('mt-1 line-clamp-3 break-all font-mono text-[12px] leading-[1.45]', frame.type === 'error' ? 'text-error' : 'text-text-2')}>
          {frame.binary ? `[binary base64] ${frame.content}` : compactPayload(frame.content)}
        </span>
      </span>
    </button>
  )
})

/** The conversation, oldest first, on a timeline. */
export function WsFrameList({ frames, selectedId, onSelect, onOpen, emptyHint }: {
  frames: WsFrame[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** Double-click: read the message in the whole panel. */
  onOpen: (id: string) => void
  emptyHint: string
}) {
  if (frames.length === 0) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center px-6 text-center">
        <div>
          <Wifi size={32} className="mx-auto mb-3 text-text-4 opacity-40" />
          <div className="text-[12px] font-semibold text-text-2">No messages yet</div>
          <div className="mt-1 text-[11px] text-text-4">{emptyHint}</div>
        </div>
      </div>
    )
  }
  return (
    <div className="relative py-2 pl-5 pr-2">
      <div className="absolute bottom-2 left-[11px] top-2 w-px bg-border-2" />
      <div className="flex flex-col gap-0.5">
        {frames.map((frame) => <FrameRow key={frame.id} frame={frame} selected={frame.id === selectedId} onSelect={onSelect} onOpen={onOpen} />)}
      </div>
    </div>
  )
}
