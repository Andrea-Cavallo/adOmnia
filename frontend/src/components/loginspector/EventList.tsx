import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Layers } from 'lucide-react'
import { cn } from '@/lib/utils'
import { buildLookup, flattenPayload, highlightSegments } from '@/lib/loginspector'
import type { LogEvent, LogLevel } from '@/lib/loginspector'

export const LIST_COLUMNS = [
  { id: 'time', label: 'Time', width: 96 },
  { id: 'level', label: 'Level', width: 52 },
  { id: 'service', label: 'Service', width: 130 },
  { id: 'pod', label: 'Pod / Container', width: 170 },
  { id: 'logger', label: 'Logger', width: 150 },
  { id: 'thread', label: 'Thread', width: 120 },
  { id: 'correlation', label: 'Correlation', width: 120 },
  { id: 'source', label: 'Source file', width: 140 },
] as const

export type BuiltinListColumnId = (typeof LIST_COLUMNS)[number]['id']
export type ListColumnId = BuiltinListColumnId | `field:${string}`

export const DEFAULT_COLUMNS: ListColumnId[] = ['time', 'level', 'service', 'pod', 'correlation', 'source']

export function availableListColumns(events: LogEvent[], configured: ListColumnId[]): ListColumnId[] {
  const available = new Set<ListColumnId>()
  for (const event of events) {
    if (event.ts !== null || event.tsRaw) available.add('time')
    if (event.level !== 'unknown' || event.levelRaw) available.add('level')
    if (event.service) available.add('service')
    if (event.pod || event.container) available.add('pod')
    if (event.logger) available.add('logger')
    if (event.thread) available.add('thread')
    if (event.correlationId || event.traceId || event.requestId) available.add('correlation')
    if (event.sourceName) available.add('source')
  }
  return configured.filter((column) => column.startsWith('field:') || available.has(column as BuiltinListColumnId))
}

function columnDefinition(id: ListColumnId, widths: Record<string, number> = {}): { id: ListColumnId; label: string; width: number } {
  const builtin = LIST_COLUMNS.find((column) => column.id === id)
  if (builtin) return { ...builtin, width: widths[id] ?? builtin.width }
  return { id, label: id.slice('field:'.length), width: widths[id] ?? 150 }
}

export const LEVEL_STYLE: Record<LogLevel, string> = {
  fatal: 'bg-error/25 text-error',
  error: 'bg-error/15 text-error',
  warn: 'bg-warning/15 text-warning',
  info: 'bg-info/15 text-info',
  debug: 'bg-surface-3 text-text-2',
  trace: 'bg-surface-2 text-text-3',
  unknown: 'bg-surface-2 text-text-4',
}

export const LEVEL_SHORT: Record<LogLevel, string> = {
  fatal: 'FTL', error: 'ERR', warn: 'WRN', info: 'INF', debug: 'DBG', trace: 'TRC', unknown: '---',
}

export type Density = 'compact' | 'comfortable'

function rowHeight(density: Density, wrap: boolean): number {
  if (wrap) return density === 'compact' ? 46 : 62
  return density === 'compact' ? 24 : 32
}

export function formatClock(ts: number | null, fallback: string): string {
  if (ts === null) return fallback ? fallback.slice(0, 12) : '--:--:--'
  const date = new Date(ts)
  const pad = (n: number, size = 2) => String(n).padStart(size, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

interface EventListProps {
  events: LogEvent[]
  selectedId: number | null
  onSelect: (event: LogEvent) => void
  onContextMenu?: (event: LogEvent, position: { x: number; y: number }) => void
  density: Density
  wrap: boolean
  columns: ListColumnId[]
  columnWidths: Record<string, number>
  onColumnWidthChange: (id: ListColumnId, width: number) => void
  highlights: string[]
  /** Scroll target requested from outside (e.g. from the related-events view). */
  scrollToId?: number | null
}

/**
 * Windowed list: only the visible slice is mounted, so 100k events cost the
 * same as 40. ponytail: fixed row heights instead of a measuring virtualizer —
 * no dependency, and the density/wrap toggles already pin the height.
 */
export function EventList({
  events,
  selectedId,
  onSelect,
  onContextMenu,
  density,
  wrap,
  columns,
  columnWidths,
  onColumnWidthChange,
  highlights,
  scrollToId = null,
}: EventListProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(600)
  const height = rowHeight(density, wrap)
  const visibleColumns = useMemo(() => availableListColumns(events, columns), [events, columns])

  useEffect(() => {
    const node = viewportRef.current
    if (!node) return
    const observer = new ResizeObserver(() => setViewportHeight(node.clientHeight))
    observer.observe(node)
    setViewportHeight(node.clientHeight)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (scrollToId === null) return
    const index = events.findIndex((event) => event.id === scrollToId)
    if (index >= 0) viewportRef.current?.scrollTo({ top: Math.max(0, index * height - viewportHeight / 2) })
  }, [scrollToId, events, height, viewportHeight])

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  const overscan = 12
  const first = Math.max(0, Math.floor(scrollTop / height) - overscan)
  const last = Math.min(events.length, Math.ceil((scrollTop + viewportHeight) / height) + overscan)
  const visible = events.slice(first, last)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-border-1 bg-surface-1 px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-text-4">
        {visibleColumns.map((id) => columnDefinition(id, columnWidths)).map((column) => (
          <span key={column.id} style={{ width: column.width }} className="group relative shrink-0 truncate pr-2">
            {column.label}
            <span
              role="separator"
              aria-label={`Resize ${column.label}`}
              onMouseDown={(event) => {
                event.preventDefault()
                const startX = event.clientX
                const startWidth = column.width
                const move = (moveEvent: MouseEvent) => onColumnWidthChange(column.id, Math.max(56, Math.min(420, startWidth + moveEvent.clientX - startX)))
                const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
                window.addEventListener('mousemove', move)
                window.addEventListener('mouseup', up)
              }}
              className="absolute inset-y-0 right-0 w-1.5 cursor-col-resize bg-border-2/0 group-hover:bg-accent/40"
            />
          </span>
        ))}
        <span className="min-w-0 flex-1">Message</span>
      </div>

      <div ref={viewportRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-auto">
        {events.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-text-4">No event matches the current filters.</p>
        ) : (
          <div style={{ height: events.length * height, position: 'relative' }}>
            <div style={{ transform: `translateY(${first * height}px)` }}>
              {visible.map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  height={height}
                  wrap={wrap}
                  columns={visibleColumns}
                  columnWidths={columnWidths}
                  highlights={highlights}
                  selected={event.id === selectedId}
                  onSelect={() => onSelect(event)}
                  onContextMenu={onContextMenu}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

interface EventRowProps {
  event: LogEvent
  height: number
  wrap: boolean
  columns: ListColumnId[]
  columnWidths: Record<string, number>
  highlights: string[]
  selected: boolean
  onSelect: () => void
  onContextMenu?: (event: LogEvent, position: { x: number; y: number }) => void
}

function columnValue(event: LogEvent, id: ListColumnId): string {
  if (id.startsWith('field:')) {
    const path = id.slice('field:'.length)
    const source = event.json && typeof event.json === 'object' && !Array.isArray(event.json)
      ? event.json as Record<string, unknown>
      : event.extra
    const value = buildLookup(flattenPayload(source)).get(path)?.value
    if (value === null || value === undefined) return ''
    return typeof value === 'object' ? JSON.stringify(value) : String(value)
  }
  switch (id) {
    case 'time': return formatClock(event.ts, event.tsRaw)
    case 'level': return LEVEL_SHORT[event.level]
    case 'service': return event.service
    case 'pod': return event.pod || event.container
    case 'logger': return event.logger
    case 'thread': return event.thread
    case 'correlation': return event.correlationId || event.traceId || event.requestId
    case 'source': return event.sourceName || ''
  }
  return ''
}

function EventRow({ event, height, wrap, columns, columnWidths, highlights, selected, onSelect, onContextMenu }: EventRowProps) {
  const segments = highlightSegments(event.message, highlights)
  return (
    <div
      role="row"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(keyEvent) => { if (keyEvent.key === 'Enter' || keyEvent.key === ' ') { keyEvent.preventDefault(); onSelect() } }}
      onContextMenu={(mouseEvent) => {
        if (!onContextMenu) return
        mouseEvent.preventDefault()
        onContextMenu(event, { x: mouseEvent.clientX, y: mouseEvent.clientY })
      }}
      style={{ height }}
      className={cn(
        'flex cursor-pointer items-start gap-2 border-l-2 px-2 py-[3px] text-[11px] outline-none transition-colors',
        selected ? 'border-accent bg-accent/12' : 'border-transparent hover:bg-surface-1',
        'focus-visible:bg-surface-1 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent',
      )}
    >
      {columns.map((id) => columnDefinition(id, columnWidths)).map((column) => {
        const value = columnValue(event, column.id)
        if (column.id === 'level') {
          return (
            <span key={column.id} style={{ width: column.width }} className="shrink-0">
              <span className={cn('rounded px-1.5 py-[1px] font-mono text-[9px] font-semibold', LEVEL_STYLE[event.level])}>
                {event.parseError ? 'RAW' : value}
              </span>
            </span>
          )
        }
        return (
          <span
            key={column.id}
            style={{ width: column.width }}
            title={value}
            className={cn('shrink-0 truncate font-mono text-[10px]', column.id === 'time' ? 'text-text-3' : 'text-text-2')}
          >
            {value || '-'}
          </span>
        )
      })}

      <span className={cn('min-w-0 flex-1 font-mono text-text-1', wrap ? 'whitespace-pre-wrap break-words' : 'truncate')}>
        {segments.map((segment, index) => (
          segment.hit
            ? <mark key={index} className="rounded-[2px] bg-accent/35 text-text-1">{segment.text}</mark>
            : <span key={index}>{segment.text}</span>
        ))}
      </span>

      <span className="flex shrink-0 items-center gap-1.5 pt-[1px]">
        {event.parseError && <AlertTriangle size={11} className="text-warning" aria-label="Unparsed line" />}
        {event.stack && <Layers size={11} className="text-accent-light" aria-label="Has stack trace" />}
      </span>
    </div>
  )
}
