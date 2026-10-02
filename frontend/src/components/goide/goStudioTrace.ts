import type { GoIDETraceReport } from '@/lib/goide-api'

export type TraceReport = GoIDETraceReport
export type TraceGoroutine = TraceReport['goroutines'][number]
export type TraceSpan = TraceGoroutine['spans'][number]
export type TraceFrame = NonNullable<TraceSpan['stack']>[number]
export type TraceEvent = TraceReport['events'][number]
export type TraceRange = TraceReport['gc'][number]

export type TraceCategory = 'running' | 'runnable' | 'waiting' | 'syscall'

export function formatTraceDuration(nanoseconds: number): string {
  const value = Math.abs(nanoseconds)
  const sign = nanoseconds < 0 ? '-' : ''
  if (value < 1_000) return `${sign}${value} ns`
  if (value < 1_000_000) return `${sign}${(value / 1_000).toFixed(1)} µs`
  if (value < 1_000_000_000) return `${sign}${(value / 1_000_000).toFixed(2)} ms`
  return `${sign}${(value / 1_000_000_000).toFixed(2)} s`
}

export function traceSpanPercent(span: TraceSpan, durationNanos: number): number {
  if (durationNanos <= 0) return 0
  return ((span.end - span.start) / durationNanos) * 100
}

export function traceSpanLeft(span: TraceSpan, durationNanos: number): number {
  if (durationNanos <= 0) return 0
  return (span.start / durationNanos) * 100
}

/** Categoria di attesa dedotta dalla ragione riportata dal runtime (stessa logica del backend). */
export function waitCategory(reason: string | undefined): 'network' | 'sync' | 'gc' | 'sleep' | 'other' {
  const lower = (reason ?? '').toLowerCase()
  if (lower.includes('network') || lower.includes('poll')) return 'network'
  if (['chan', 'sync', 'select', 'mutex', 'semacquire', 'waitgroup'].some((marker) => lower.includes(marker))) return 'sync'
  if (lower.includes('gc')) return 'gc'
  if (lower.includes('sleep') || lower.includes('timer') || lower.includes('finalizer')) return 'sleep'
  return 'other'
}

export function traceSpanTone(span: TraceSpan): string {
  switch (span.state) {
    case 'running': return 'var(--color-success, #22c55e)'
    case 'runnable': return 'var(--color-accent, #3b82f6)'
    case 'syscall': return 'var(--color-warning, #f59e0b)'
    default: {
      const category = waitCategory(span.reason)
      if (category === 'network') return 'var(--color-info, #06b6d4)'
      if (category === 'sync') return 'var(--color-danger, #ef4444)'
      if (category === 'gc') return 'var(--color-purple, #a855f7)'
      return 'var(--color-text-4, #888)'
    }
  }
}

/** Nome della funzione principale di un frame di stack. */
export function frameFunction(frame: TraceFrame): string {
  return frame.function.split('/').pop() ?? frame.function
}

export function goroutineTotal(goroutine: TraceGoroutine): number {
  return goroutine.running + goroutine.runnable + goroutine.waiting + goroutine.syscall
}

export function matchesGoroutine(goroutine: TraceGoroutine, query: string): boolean {
  if (!query) return true
  const needle = query.toLowerCase()
  if (`${goroutine.id}`.includes(needle)) return true
  const first = goroutine.startStack?.[0]
  return !!first && first.function.toLowerCase().includes(needle)
}

/** Goroutine ordinate per tempo totale, filtrate per id/funzione di partenza. */
export function visibleGoroutines(report: TraceReport, query: string, limit = 60): TraceGoroutine[] {
  return report.goroutines.filter((goroutine) => matchesGoroutine(goroutine, query)).slice(0, limit)
}

export interface TraceStatChip {
  label: string
  value: string
  detail?: string
  tone?: string
}

export function traceStatChips(report: TraceReport): TraceStatChip[] {
  const stats = report.stats
  return [
    { label: 'Duration', value: formatTraceDuration(report.durationNanos) },
    { label: 'Goroutines', value: `${stats.goroutines}` },
    { label: 'Running', value: formatTraceDuration(stats.running), tone: 'var(--color-success, #22c55e)' },
    { label: 'Waiting', value: formatTraceDuration(stats.waiting), tone: 'var(--color-text-3, #999)' },
    { label: 'Syscall', value: formatTraceDuration(stats.syscall) },
    { label: 'GC', value: formatTraceDuration(stats.gc), tone: 'var(--color-purple, #a855f7)' },
    { label: 'Network wait', value: formatTraceDuration(stats.networkWait), tone: 'var(--color-info, #06b6d4)' },
    { label: 'Sync wait', value: formatTraceDuration(stats.syncWait), tone: 'var(--color-danger, #ef4444)' },
  ]
}

/** Goroutine con l'attesa più lunga nella categoria indicata (rete, sync, GC, sleep). */
export function goroutinesByWait(report: TraceReport, category: 'network' | 'sync' | 'gc' | 'sleep', limit = 20): Array<{ goroutine: TraceGoroutine; span: TraceSpan }> {
  const rows: Array<{ goroutine: TraceGoroutine; span: TraceSpan }> = []
  for (const goroutine of report.goroutines) {
    let longest: TraceSpan | null = null
    for (const span of goroutine.spans) {
      if (span.state !== 'waiting' || waitCategory(span.reason) !== category) continue
      if (!longest || span.end - span.start > longest.end - longest.start) longest = span
    }
    if (longest) rows.push({ goroutine, span: longest })
  }
  return rows.sort((a, b) => (b.span.end - b.span.start) - (a.span.end - a.span.start)).slice(0, limit)
}

/** Goroutine ancora vive a fine traccia o con un tempo cumulato sopra la soglia. */
export function longRunningGoroutines(report: TraceReport, minimumNanos: number, limit = 20): TraceGoroutine[] {
  return report.goroutines
    .filter((goroutine) => goroutine.alive || goroutineTotal(goroutine) >= minimumNanos)
    .sort((a, b) => goroutineTotal(b) - goroutineTotal(a))
    .slice(0, limit)
}
