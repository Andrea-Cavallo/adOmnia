import { useMemo, useState } from 'react'
import { Check, Copy, Filter, GanttChartSquare, List, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { buildCallWaterfall, type CorrelationResult, type LogEvent } from '@/lib/loginspector'
import { LEVEL_SHORT, LEVEL_STYLE, formatClock } from './EventList'

function formatDelta(ms: number | null): string {
  if (ms === null) return ''
  if (ms === 0) return '+0ms'
  if (Math.abs(ms) < 1000) return `+${ms}ms`
  return `+${(ms / 1000).toFixed(2)}s`
}

function formatSpan(ms: number | null): string {
  if (ms === null) return 'unknown span'
  return ms < 1000 ? `${ms}ms total` : `${(ms / 1000).toFixed(2)}s total`
}

interface RelatedEventsProps {
  result: CorrelationResult
  onClose: () => void
  onApplyAsFilter: () => void
  onSelect: (event: LogEvent) => void
}

export function RelatedEvents({ result, onClose, onApplyAsFilter, onSelect }: RelatedEventsProps) {
  const [view, setView] = useState<'list' | 'timeline'>('list')
  const [copied, setCopied] = useState(false)

  const waterfall = useMemo(() => buildCallWaterfall(result.events.map((entry) => entry.event)), [result])
  const eventById = useMemo(() => new Map(result.events.map((entry) => [entry.event.id, entry.event])), [result])
  let waterfallStart = Number.MAX_SAFE_INTEGER
  let waterfallEnd = 0
  for (const call of waterfall) {
    if (call.startMs === null) continue
    waterfallStart = Math.min(waterfallStart, call.startMs)
    waterfallEnd = Math.max(waterfallEnd, call.startMs + (call.durationMs ?? 0))
  }
  const waterfallSpan = waterfallStart === Number.MAX_SAFE_INTEGER ? 1 : Math.max(1, waterfallEnd - waterfallStart)

  const copyValue = () => {
    navigator.clipboard.writeText(result.value).then(
      () => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1200)
      },
      () => setCopied(false),
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-0">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-1 bg-surface-1 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-wider text-text-4">Related events</p>
          <p className="truncate font-mono text-xs text-text-1" title={result.value}>{result.key}: {result.value}</p>
        </div>
        <button onClick={copyValue} title="Copy the identifier" className="grid h-6 w-6 place-items-center rounded border border-border-2 text-text-3 hover:text-text-1">
          {copied ? <Check size={11} className="text-success" /> : <Copy size={11} />}
        </button>
        <button
          onClick={onApplyAsFilter}
          title="Copy this value into the main filter"
          className="flex h-6 items-center gap-1 rounded border border-accent/40 bg-accent/15 px-2 text-[10px] text-accent-light hover:bg-accent/25"
        >
          <Filter size={10} /> Use as filter
        </button>
        <div className="flex overflow-hidden rounded border border-border-2">
          <ViewButton active={view === 'list'} onClick={() => setView('list')} title="List view"><List size={12} /></ViewButton>
          <ViewButton active={view === 'timeline'} onClick={() => setView('timeline')} title="Timeline view"><GanttChartSquare size={12} /></ViewButton>
        </div>
        <button onClick={onClose} title="Close (Esc)" className="text-text-4 hover:text-error"><X size={13} /></button>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border-1 bg-surface-0 px-3 py-1.5 font-mono text-[10px] text-text-3">
        <span>{result.events.length} events</span>
        <span>{formatSpan(result.spanMs)}</span>
        <span className={result.errorCount > 0 ? 'text-error' : undefined}>{result.errorCount} errors</span>
        {result.services.length > 0 && <span className="truncate">{result.services.join(' -> ')}</span>}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {result.events.length === 0 && <p className="px-3 py-8 text-center text-xs text-text-4">No related event found.</p>}

        {view === 'list' && result.events.map(({ event, deltaMs }) => (
          <button
            key={event.id}
            onClick={() => onSelect(event)}
            className={cn(
              'flex w-full items-start gap-2 border-l-2 px-3 py-1 text-left text-[11px] transition-colors hover:bg-surface-1',
              event.level === 'error' || event.level === 'fatal' ? 'border-error bg-error/[0.06]' : 'border-transparent',
            )}
          >
            <span className="w-[92px] shrink-0 font-mono text-[10px] text-text-3">{formatClock(event.ts, event.tsRaw)}</span>
            <span className="w-[62px] shrink-0 text-right font-mono text-[10px] text-accent-light">{formatDelta(deltaMs)}</span>
            <span className={cn('shrink-0 rounded px-1.5 py-[1px] font-mono text-[9px] font-semibold', LEVEL_STYLE[event.level])}>
              {LEVEL_SHORT[event.level]}
            </span>
            <span className="w-[110px] shrink-0 truncate font-mono text-[10px] text-text-2" title={event.service}>{event.service || '-'}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-text-1">{event.message}</span>
          </button>
        ))}

        {view === 'timeline' && (
          <div className="px-3 py-2">
            <div className="mb-2 flex items-center gap-3 text-[9px] text-text-4">
              <span>Service / call waterfall</span>
              <span className="ml-auto">solid = span</span>
              <span>dashed = inferred</span>
            </div>
            {waterfall.map((call) => {
              const offset = call.startMs !== null && waterfallStart !== Number.MAX_SAFE_INTEGER
                ? ((call.startMs - waterfallStart) / waterfallSpan) * 100
                : 0
              const width = call.durationMs !== null ? Math.max(1.5, (call.durationMs / waterfallSpan) * 100) : 1.5
              const event = call.eventIds.map((id) => eventById.get(id)).find((candidate) => candidate?.level === 'error' || candidate?.level === 'fatal')
                ?? eventById.get(call.eventIds[0])
              const isError = call.status === 'error'
              return (
                <button
                  key={call.id}
                  onClick={() => { if (event) onSelect(event) }}
                  className="group mb-1 flex w-full items-center gap-2 text-left"
                >
                  <span className="w-[110px] shrink-0 truncate font-mono text-[10px] text-text-3" title={call.service}>
                    {call.service}
                  </span>
                  <span className="relative h-4 min-w-0 flex-1 rounded bg-surface-1 group-hover:bg-surface-2">
                    <span
                      className={cn(
                        'absolute top-1/2 h-2.5 -translate-y-1/2 rounded-sm border',
                        isError ? 'border-error bg-error/70' : 'border-accent bg-accent/60',
                        call.inferred && 'border-dashed bg-transparent',
                      )}
                      style={{ left: `${Math.min(98.5, Math.max(0, offset))}%`, width: `${Math.min(100 - offset, width)}%` }}
                    />
                  </span>
                  <span className="w-[62px] shrink-0 text-right font-mono text-[10px] text-accent-light">
                    {call.durationMs === null ? 'point' : formatSpan(call.durationMs).replace(' total', '')}
                  </span>
                  <span className={cn('w-[220px] shrink-0 truncate font-mono text-[10px]', isError ? 'text-error' : 'text-text-2')} title={call.label}>
                    {call.parentId ? '↳ ' : ''}{call.label}{call.inferred ? ' · inferred' : ''}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function ViewButton({ active, onClick, title, children }: { active: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn('grid h-6 w-7 place-items-center transition-colors', active ? 'bg-accent/20 text-accent-light' : 'text-text-4 hover:text-text-1')}
    >
      {children}
    </button>
  )
}
