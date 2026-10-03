import type { ReactNode } from 'react'
import {
  TRACE_STATE_LEGEND, formatTraceDuration, traceSpanLeft, traceSpanPercent, traceSpanThickness, traceSpanTone, traceTicks, waitCategory,
  type TraceRange, type TraceSpan,
} from './goStudioTrace'
import { VizLegend, VizTooltip, VizTooltipRow, useVizTooltip } from './GoStudioVizKit'

const TRACK_HEIGHT_PX = 16
const MIN_SPAN_PERCENT = 0.15

export interface TraceTimelineRow {
  key: string
  label: ReactNode
  /** Testo dell'etichetta per tooltip e filtri accessibili. */
  title: string
  spans: TraceSpan[]
  total: string
}

interface GoStudioTraceTimelineProps {
  rows: TraceTimelineRow[]
  durationNanos: number
  gc: TraceRange[]
  labelHeader: string
  empty: string
  onSelect: (span: TraceSpan) => void
}

const WAIT_LABEL: Record<ReturnType<typeof waitCategory>, string> = {
  network: 'Network', sync: 'Synchronization', gc: 'GC', sleep: 'Sleep / timer', other: 'Other',
}

/** Righe etichetta + traccia con asse del tempo condiviso e fasce GC/stop-the-world dietro gli span. */
export function GoStudioTraceTimeline({ rows, durationNanos, gc, labelHeader, empty, onSelect }: GoStudioTraceTimelineProps) {
  const { tooltip, show, hide } = useVizTooltip()
  const ticks = traceTicks(durationNanos)
  const position = (start: number, end: number) => ({
    left: `${traceSpanLeft({ start, end } as TraceSpan, durationNanos)}%`,
    width: `${Math.max(MIN_SPAN_PERCENT, traceSpanPercent({ start, end } as TraceSpan, durationNanos))}%`,
  })

  const background = (
    <>
      {ticks.map((tick) => (
        <span key={tick} aria-hidden="true" className="absolute inset-y-0 w-px" style={{ left: `${(tick / durationNanos) * 100}%`, background: 'var(--gs-viz-grid)' }} />
      ))}
      {gc.map((range, index) => (
        <span key={`gc-${index}`} aria-hidden="true" className="absolute inset-y-0" style={{ ...position(range.start, range.end), background: 'color-mix(in srgb, var(--gs-viz-gc) 9%, transparent)' }} />
      ))}
    </>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border-1 px-3 py-1.5">
        <VizLegend items={[...TRACE_STATE_LEGEND, { id: 'gc', label: 'GC / stop-the-world', color: 'color-mix(in srgb, var(--gs-viz-gc) 45%, transparent)' }]} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto" onMouseLeave={hide}>
        <div className="sticky top-0 z-[2] bg-[var(--gs-island)] px-3 pt-2">
          <div className="grid grid-cols-[17rem_minmax(0,1fr)_4.5rem] items-end gap-3">
            <span className="pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-text-4">{labelHeader}</span>
            <div className="relative h-5">
              {ticks.map((tick, index) => (
                <span key={tick} className={`absolute bottom-1 whitespace-nowrap font-mono text-[10px] tabular-nums text-text-4 ${index === 0 ? '' : index === ticks.length - 1 ? '-translate-x-full' : '-translate-x-1/2'}`} style={{ left: `${(tick / durationNanos) * 100}%` }}>
                  {formatTraceDuration(tick)}
                </span>
              ))}
            </div>
            <span className="pb-1 text-right text-[10.5px] font-semibold uppercase tracking-wide text-text-4">Total</span>
          </div>
          <div className="grid grid-cols-[17rem_minmax(0,1fr)_4.5rem] items-center gap-3 border-b border-border-1/70 pb-1.5">
            <span className="text-[11px] text-text-3">GC / STW</span>
            <div className="relative h-2.5 overflow-hidden rounded-full" style={{ background: 'var(--gs-viz-track)' }}>
              {gc.map((range, index) => (
                <span
                  key={`lane-${index}`}
                  className="absolute inset-y-0 rounded-full"
                  style={{ ...position(range.start, range.end), background: 'var(--gs-viz-gc)' }}
                  onMouseMove={(event) => show(event, (
                    <>
                      <div className="mb-1 font-medium text-text-1">{range.name || range.kind}</div>
                      <VizTooltipRow label="Starts at" value={formatTraceDuration(range.start)} />
                      <VizTooltipRow label="Duration" value={formatTraceDuration(range.end - range.start)} color="var(--gs-viz-gc)" />
                    </>
                  ))}
                />
              ))}
            </div>
            <span className="text-right font-mono text-[10.5px] tabular-nums text-text-4">{gc.length}×</span>
          </div>
        </div>

        {rows.length === 0 && <p className="p-4 text-[12px] text-text-4">{empty}</p>}
        <div className="px-3 py-1">
          {rows.map((row) => (
            <div key={row.key} className="grid grid-cols-[17rem_minmax(0,1fr)_4.5rem] items-center gap-3 rounded-md py-[3px] hover:bg-surface-2/50">
              <span className="min-w-0 truncate" title={row.title}>{row.label}</span>
              <div className="relative overflow-hidden rounded-[5px]" style={{ height: TRACK_HEIGHT_PX, background: 'var(--gs-viz-track)' }}>
                {background}
                {row.spans.map((span, index) => {
                  const thickness = traceSpanThickness(span)
                  const frame = span.stack?.[0]
                  return (
                    <button
                      key={`${span.start}-${index}`}
                      type="button"
                      aria-label={`${span.state} ${formatTraceDuration(span.end - span.start)}`}
                      onClick={() => onSelect(span)}
                      onMouseMove={(event) => show(event, (
                        <>
                          <div className="mb-1 font-medium capitalize text-text-1">{span.state}{span.state === 'waiting' ? ` · ${WAIT_LABEL[waitCategory(span.reason)]}` : ''}</div>
                          {span.reason && <VizTooltipRow label="Reason" value={span.reason} />}
                          <VizTooltipRow label="Duration" value={formatTraceDuration(span.end - span.start)} color={traceSpanTone(span)} />
                          <VizTooltipRow label="From" value={formatTraceDuration(span.start)} />
                          {frame && <div className="mt-1 truncate font-mono text-[10.5px] text-text-4">{frame.function}{frame.line ? `:${frame.line}` : ''}</div>}
                          {frame && <div className="text-[10.5px] text-text-4">Click to open the source</div>}
                        </>
                      ))}
                      className="absolute rounded-[3px] hover:brightness-110 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
                      style={{
                        ...position(span.start, span.end),
                        top: `${((1 - thickness) / 2) * 100}%`,
                        height: `${thickness * 100}%`,
                        background: traceSpanTone(span),
                      }}
                    />
                  )
                })}
              </div>
              <span className="text-right font-mono text-[10.5px] tabular-nums text-text-3">{row.total}</span>
            </div>
          ))}
        </div>
      </div>
      <VizTooltip tooltip={tooltip} />
    </div>
  )
}
