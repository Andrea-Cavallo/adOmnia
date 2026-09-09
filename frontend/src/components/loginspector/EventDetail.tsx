import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, Filter, Share2, WrapText, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { correlationCandidates, hideJsonFields, unwrapNestedJson, type CorrelationKey, type LogEvent } from '@/lib/loginspector'
import { JsonTree } from './JsonTree'
import { LEVEL_STYLE } from './EventList'

type DetailTab = 'overview' | 'json' | 'message' | 'stack' | 'context'

const TABS: { id: DetailTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'json', label: 'JSON' },
  { id: 'message', label: 'Message' },
  { id: 'stack', label: 'Stack Trace' },
  { id: 'context', label: 'Context' },
]

interface EventDetailProps {
  event: LogEvent
  onClose: () => void
  onFilterBy: (field: string, value: string) => void
  onShowRelated: (key: CorrelationKey, value: string) => void
  hiddenFields: string[]
}

export function EventDetail({ event, onClose, onFilterBy, onShowRelated, hiddenFields }: EventDetailProps) {
  const [tab, setTab] = useState<DetailTab>('overview')
  const [wrap, setWrap] = useState(true)
  const [copied, setCopied] = useState('')

  // A stack trace is the reason you opened the event — jump straight to it.
  useEffect(() => {
    setTab((current) => (current === 'stack' && !event.stack ? 'overview' : current))
  }, [event.id, event.stack])

  const copy = (text: string, token: string) => {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(token)
        window.setTimeout(() => setCopied(''), 1200)
      },
      () => setCopied(''),
    )
  }

  const related = correlationCandidates(event)
  const stackLines = useMemo(() => (event.stack ? event.stack.split('\n') : []), [event.stack])
  const hasDecoded = Object.keys(event.decoded).length > 0
  // Logs bury JSON inside JSON strings; unwrapping is what makes the tree
  // navigable, so it is the default.
  const [unwrap, setUnwrap] = useState(true)
  const visibleJson = useMemo(() => {
    const base = hasDecoded ? { ...(event.json as object), __decoded: event.decoded } : event.json
    return hideJsonFields(unwrap ? unwrapNestedJson(base) : base, hiddenFields)
  }, [event.json, event.decoded, hasDecoded, hiddenFields, unwrap])
  const visibleExtra = useMemo(
    () => hideJsonFields(event.extra, hiddenFields) as Record<string, unknown>,
    [event.extra, hiddenFields],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-0">
      <div className="flex shrink-0 items-start gap-2 border-b border-border-1 bg-surface-1 px-3 py-2">
        <span className={cn('mt-[1px] rounded px-1.5 py-[2px] font-mono text-[9px] font-semibold', LEVEL_STYLE[event.level])}>
          {event.levelRaw || event.level}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-text-1" title={event.message}>{event.message || '(empty message)'}</p>
          <p className="mt-0.5 truncate font-mono text-[10px] text-text-4">
            line {event.line}
            {event.lineCount > 1 ? ` (+${event.lineCount - 1})` : ''}
            {event.service ? ` · ${event.service}` : ''}
            {event.pod ? ` · ${event.pod}` : ''}
          </p>
        </div>
        <button
          onClick={() => copy(event.raw, 'raw')}
          title="Copy the original source line"
          className="flex h-6 shrink-0 items-center gap-1 rounded border border-border-2 px-2 text-[10px] text-text-3 hover:border-accent/40 hover:text-text-1"
        >
          {copied === 'raw' ? <Check size={11} className="text-success" /> : <Copy size={11} />}
          Raw
        </button>
        <button onClick={onClose} title="Close details (Esc)" className="mt-0.5 shrink-0 text-text-4 hover:text-error">
          <X size={13} />
        </button>
      </div>

      <div className="flex shrink-0 border-b border-border-1 bg-surface-0">
        {TABS.map((item) => {
          const disabled = item.id === 'stack' && !event.stack
          return (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              disabled={disabled}
              className={cn(
                'relative px-3 py-1.5 text-[11px] transition-colors disabled:opacity-35',
                tab === item.id ? 'text-accent-light' : 'text-text-3 hover:text-text-1',
              )}
            >
              {item.label}
              {item.id === 'stack' && event.stack ? <span className="ml-1 text-[9px] text-text-4">{stackLines.length}</span> : null}
              {tab === item.id && <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-accent" />}
            </button>
          )
        })}
      </div>

      {tab === 'overview' && (
        <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
          {related.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {related.map((candidate) => (
                <button
                  key={candidate.key}
                  onClick={() => onShowRelated(candidate.key, candidate.value)}
                  title={`Show every event with ${candidate.label} = ${candidate.value}`}
                  className="flex items-center gap-1.5 rounded border border-accent/35 bg-accent/12 px-2 py-1 font-mono text-[10px] text-accent-light hover:bg-accent/20"
                >
                  <Share2 size={10} />
                  {candidate.label}: {candidate.value}
                </button>
              ))}
            </div>
          )}
          <FieldGrid
            rows={[
              ['Timestamp', event.ts !== null ? new Date(event.ts).toISOString() : event.tsRaw, ''],
              ['Level', event.level, 'level'],
              ['Service', event.service, 'service'],
              ['Namespace', event.namespace, 'namespace'],
              ['Pod', event.pod, 'pod'],
              ['Container', event.container, 'container'],
              ['Logger', event.logger, 'logger'],
              ['Thread', event.thread, 'thread'],
              ['Correlation ID', event.correlationId, 'correlationId'],
              ['Trace ID', event.traceId, 'traceId'],
              ['Request ID', event.requestId, 'requestId'],
            ]}
            onFilterBy={onFilterBy}
          />
          {event.parseError && (
            <p className="mt-3 rounded border border-warning/40 bg-warning/10 px-2 py-1.5 font-mono text-[10px] text-warning">
              Not parsable: {event.parseError}
            </p>
          )}
        </div>
      )}

      {tab === 'json' && (
        event.json
          ? (
            <JsonTree
              value={visibleJson}
              actions={
                <button
                  onClick={() => setUnwrap((value) => !value)}
                  title="Unwrap JSON that was escaped inside string fields"
                  className={cn(
                    'h-6 rounded border px-2 text-[10px] transition-colors',
                    unwrap ? 'border-accent/50 bg-accent/20 text-accent-light' : 'border-border-2 text-text-3 hover:text-text-1',
                  )}
                >
                  Unwrap
                </button>
              }
            />
          )
          : (
            <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
              <p className="mb-2 text-[11px] text-text-4">This event is not structured JSON. The original line is shown below.</p>
              <pre className="whitespace-pre-wrap break-words rounded border border-border-1 bg-surface-1 p-2 font-mono text-[11px] text-text-2">{event.raw}</pre>
            </div>
          )
      )}

      {tab === 'message' && (
        <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
          <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-[1.6] text-text-1">{event.message}</pre>
          {hasDecoded && (
            <div className="mt-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-4">Decoded JSON payload</p>
              <pre className="whitespace-pre-wrap break-words rounded border border-border-1 bg-surface-1 p-2 font-mono text-[11px] text-text-2">
                {JSON.stringify(event.decoded, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {tab === 'stack' && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center gap-2 border-b border-border-1 bg-surface-1 px-2 py-1">
            <button
              onClick={() => setWrap((value) => !value)}
              title="Word wrap"
              className={cn(
                'grid h-6 w-6 place-items-center rounded border',
                wrap ? 'border-accent/50 bg-accent/20 text-accent-light' : 'border-border-2 text-text-4 hover:text-text-1',
              )}
            >
              <WrapText size={12} />
            </button>
            <button
              onClick={() => copy(event.stack, 'stack')}
              className="flex h-6 items-center gap-1 rounded border border-border-2 px-2 text-[10px] text-text-3 hover:border-accent/40 hover:text-text-1"
            >
              {copied === 'stack' ? <Check size={11} className="text-success" /> : <Copy size={11} />}
              Copy stack
            </button>
            <span className="ml-auto font-mono text-[10px] text-text-4">{stackLines.length} lines</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto bg-surface-0 py-1">
            {stackLines.map((line, index) => (
              <div key={index} className="flex gap-2 px-2 font-mono text-[11px] leading-[1.55] hover:bg-surface-1">
                <span className="w-8 shrink-0 select-none text-right text-text-4">{index + 1}</span>
                <span className={cn('min-w-0 flex-1 text-text-2', wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre')}>{line}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'context' && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 overflow-auto px-3 py-2" style={{ maxHeight: '45%' }}>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-4">Kubernetes / OpenShift</p>
            <FieldGrid
              rows={[
                ['Namespace', event.namespace, 'namespace'],
                ['Pod', event.pod, 'pod'],
                ['Container', event.container, 'container'],
                ['Service', event.service, 'service'],
              ]}
              onFilterBy={onFilterBy}
            />
            <p className="mb-1.5 mt-3 text-[10px] font-semibold uppercase tracking-wider text-text-4">Tracing</p>
            <FieldGrid
              rows={[
                ['Trace ID', event.traceId, 'traceId'],
                ['Correlation ID', event.correlationId, 'correlationId'],
                ['Request ID', event.requestId, 'requestId'],
                ['Thread', event.thread, 'thread'],
                ['Logger', event.logger, 'logger'],
                ['Source line', String(event.line), ''],
              ]}
              onFilterBy={onFilterBy}
            />
          </div>
          <div className="flex min-h-0 flex-1 flex-col border-t border-border-1">
            <p className="shrink-0 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-4">
              Other fields ({Object.keys(visibleExtra).length})
            </p>
            {Object.keys(visibleExtra).length > 0
              ? <JsonTree value={visibleExtra} />
              : <p className="px-3 pb-3 text-[11px] text-text-4">Every field of this event was recognized.</p>}
          </div>
        </div>
      )}
    </div>
  )
}

function FieldGrid({ rows, onFilterBy }: { rows: [string, string, string][]; onFilterBy: (field: string, value: string) => void }) {
  const filled = rows.filter(([, value]) => value)
  if (!filled.length) return <p className="text-[11px] text-text-4">No value available.</p>
  return (
    <div className="grid grid-cols-[124px_minmax(0,1fr)] gap-x-3 gap-y-1">
      {filled.map(([label, value, field]) => (
        <div key={label} className="contents">
          <span className="py-[2px] text-[10px] text-text-4">{label}</span>
          <span className="group flex min-w-0 items-center gap-1.5 py-[2px]">
            <span className="min-w-0 break-all font-mono text-[11px] text-text-1">{value}</span>
            {field && (
              <button
                onClick={() => onFilterBy(field, value)}
                title={`Filter by ${field}:${value}`}
                className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 text-text-4 hover:text-accent-light"
              >
                <Filter size={10} />
              </button>
            )}
          </span>
        </div>
      ))}
    </div>
  )
}
