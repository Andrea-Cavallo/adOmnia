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

/** Colore dello stato: tre tinte validate per running, runnable e syscall; ogni attesa è neutra. */
export function traceSpanTone(span: Pick<TraceSpan, 'state'>): string {
  switch (span.state) {
    case 'running': return 'var(--gs-viz-running)'
    case 'runnable': return 'var(--gs-viz-runnable)'
    case 'syscall': return 'var(--gs-viz-syscall)'
    default: return 'var(--gs-viz-wait)'
  }
}

/** Spessore relativo dello span: lo stato si legge anche senza colore (pieno = lavora, sottile = aspetta). */
export function traceSpanThickness(span: Pick<TraceSpan, 'state'>): number {
  switch (span.state) {
    case 'running': case 'syscall': return 1
    case 'runnable': return 0.62
    default: return 0.34
  }
}

export const TRACE_STATE_LEGEND = [
  { id: 'running', label: 'Running', color: 'var(--gs-viz-running)', thickness: 1 },
  { id: 'syscall', label: 'Syscall', color: 'var(--gs-viz-syscall)', thickness: 1 },
  { id: 'runnable', label: 'Runnable (waiting for a P)', color: 'var(--gs-viz-runnable)', thickness: 0.62 },
  { id: 'waiting', label: 'Blocked / waiting', color: 'var(--gs-viz-wait)', thickness: 0.34 },
] as const

/** Tacche "tonde" sull'asse del tempo: 1, 2 o 5 × 10^n, circa `target` tacche sulla durata. */
export function traceTicks(durationNanos: number, target = 6): number[] {
  if (durationNanos <= 0) return []
  const rough = durationNanos / target
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= rough) ?? 10 * magnitude
  const ticks: number[] = []
  for (let tick = 0; tick <= durationNanos + 1e-6; tick += step) ticks.push(tick)
  return ticks
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
    { label: 'Running', value: formatTraceDuration(stats.running), tone: 'var(--gs-viz-running)' },
    { label: 'Waiting', value: formatTraceDuration(stats.waiting), tone: 'var(--gs-viz-wait)' },
    { label: 'Syscall', value: formatTraceDuration(stats.syscall), tone: 'var(--gs-viz-syscall)' },
    { label: 'GC', value: formatTraceDuration(stats.gc), tone: 'var(--gs-viz-gc)' },
    { label: 'Network wait', value: formatTraceDuration(stats.networkWait) },
    { label: 'Sync wait', value: formatTraceDuration(stats.syncWait) },
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
