import { useMemo, useState } from 'react'
import { Check, Copy, Maximize2, Minimize2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { JsonTree } from '@/components/loginspector/JsonTree'
import type { WsFrame } from '@/stores/websocketConnections'
import { binaryPayloadPreview } from './binaryPayload'
import { byteSize, fmtDate, fmtTime, topicOf, tryParseJson } from './wsFormat'

const COPIED_MS = 1000
type BinaryPreview = ReturnType<typeof binaryPayloadPreview>
/** A JSON payload opens with this many levels expanded: enough to read a typical message without clicking. */
const JSON_LEVELS_OPEN = 3

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-0.5 text-[10px] uppercase tracking-wide text-text-4">{label}</div>
      <div className="truncate font-mono text-[11.5px] text-text-1">{children}</div>
    </div>
  )
}

const directionTone = (frame: WsFrame) => {
  if (frame.direction === 'inbound') return 'bg-accent/20 text-accent'
  return frame.direction === 'outbound' ? 'bg-info/20 text-info' : 'bg-surface-3 text-text-3'
}

/** The payload: a JSON tree when it parses, a hex/ASCII dump when binary, readable text otherwise. */
function FramePayload({ frame, binary }: { frame: WsFrame; binary: BinaryPreview | null }) {
  const parsed = useMemo(() => (frame.binary ? null : tryParseJson(frame.content)), [frame])
  if (parsed !== null && typeof parsed === 'object') {
    return <JsonTree key={frame.id} value={parsed} startExpanded={JSON_LEVELS_OPEN} size="md" className="min-h-0 flex-1" />
  }
  const text = frame.binary ? (binary ? binary.rows.join('\n') || '(empty)' : 'Invalid Base64 payload') : frame.content
  return (
    <>
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[13px] leading-6 text-text-1">{text}</pre>
      {binary?.truncated && <div className="border-t border-border-1 px-3 py-1.5 text-[10px] text-text-4">Showing first 4 KiB of {binary.size.toLocaleString()} bytes</div>}
    </>
  )
}

/** The selected frame: metadata, payload and copy; it can take the whole panel to read a long message. */
export function WsFrameInspector({ frame, onClose, expanded, onToggleExpanded }: {
  frame: WsFrame
  onClose: () => void
  expanded: boolean
  onToggleExpanded: () => void
}) {
  const [copied, setCopied] = useState(false)
  const binary = useMemo(() => (frame.binary ? binaryPayloadPreview(frame.content) : null), [frame])

  const copy = () => {
    const parsed = frame.binary ? null : tryParseJson(frame.content)
    const text = parsed === null ? frame.content : JSON.stringify(parsed, null, 2)
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), COPIED_MS)
    }).catch(() => undefined)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface-0">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border-1 bg-surface-1 px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Inspector</span>
        <span className={cn('rounded px-1.5 font-mono text-[10px] font-semibold uppercase', directionTone(frame))}>{frame.direction}</span>
        <button type="button" onClick={copy} title={frame.binary ? 'Copy Base64 payload' : 'Copy payload'} className="ml-auto flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-text-3 hover:bg-surface-2 hover:text-text-1">
          {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />} Copy
        </button>
        <button
          type="button"
          onClick={onToggleExpanded}
          title={expanded ? 'Show the message list again' : 'Use the whole panel for this message'}
          aria-label={expanded ? 'Restore inspector' : 'Expand inspector'}
          aria-pressed={expanded}
          className="flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-text-3 hover:bg-surface-2 hover:text-text-1"
        >
          {expanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />} {expanded ? 'Restore' : 'Expand'}
        </button>
        <button type="button" onClick={onClose} title="Close inspector" aria-label="Close inspector" className="flex h-6 w-6 items-center justify-center rounded text-text-4 hover:bg-surface-2 hover:text-text-1"><X size={12} /></button>
      </div>
      <div className="grid shrink-0 grid-cols-4 gap-3 border-b border-border-1 px-3 py-2">
        <Meta label="Event">{topicOf(frame)}</Meta>
        <Meta label="Time">{fmtTime(frame.timestamp)}</Meta>
        <Meta label="Date">{fmtDate(frame.timestamp)}</Meta>
        <Meta label="Size">{frame.binary && binary ? binary.size : byteSize(frame.content)} B{frame.client ? ` · ${frame.client}` : ''}</Meta>
      </div>
      <FramePayload frame={frame} binary={binary} />
    </div>
  )
}
