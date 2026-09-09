import { useState } from 'react'
import { Check, Copy, Filter, GanttChartSquare, List, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CorrelationResult, LogEvent } from '@/lib/loginspector'
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

  const stamps = result.events.map((entry) => entry.event.ts).filter((ts): ts is number => ts !== null)
  const min = stamps.length ? Math.min(...stamps) : 0
  const span = stamps.length ? Math.max(Math.max(...stamps) - min, 1) : 1

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
            {result.events.map(({ event, deltaMs }) => {
              const offset = event.ts !== null ? ((event.ts - min) / span) * 100 : 0
              const isError = event.level === 'error' || event.level === 'fatal'
              return (
                <button
                  key={event.id}
                  onClick={() => onSelect(event)}
                  className="group mb-1 flex w-full items-center gap-2 text-left"
                >
                  <span className="w-[110px] shrink-0 truncate font-mono text-[10px] text-text-3" title={event.service}>
                    {event.service || event.pod || '-'}
                  </span>
                  <span className="relative h-4 min-w-0 flex-1 rounded bg-surface-1 group-hover:bg-surface-2">
                    <span
                      className={cn('absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full', isError ? 'bg-error' : 'bg-accent')}
                      style={{ left: `${Math.min(99, Math.max(1, offset))}%` }}
                    />
                  </span>
                  <span className="w-[62px] shrink-0 text-right font-mono text-[10px] text-accent-light">{formatDelta(deltaMs)}</span>
                  <span className={cn('w-[220px] shrink-0 truncate font-mono text-[10px]', isError ? 'text-error' : 'text-text-2')} title={event.message}>
                    {event.message}
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
