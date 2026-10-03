import { describe, expect, it } from 'vitest'
import { formatTraceDuration, goroutineTotal, goroutinesByWait, longRunningGoroutines, matchesGoroutine, traceSpanPercent, visibleGoroutines, waitCategory, type TraceReport } from './goStudioTrace'

function goroutine(id: number, overrides: Partial<TraceReport['goroutines'][number]> = {}): TraceReport['goroutines'][number] {
  return { id, start: 0, end: 100, alive: false, spans: [], running: 0, runnable: 0, waiting: 0, syscall: 0, ...overrides }
}

function report(goroutines: TraceReport['goroutines']): TraceReport {
  return {
    path: '/p/trace.out', name: 'trace.out', durationNanos: 100,
    goroutines, procs: [], gc: [], events: [],
    stats: { goroutines: goroutines.length, events: 0, running: 0, runnable: 0, waiting: 0, syscall: 0, gc: 0, gcWait: 0, networkWait: 0, syncWait: 0 },
  }
}

describe('goStudioTrace', () => {
  it('formats durations', () => {
    expect(formatTraceDuration(500)).toBe('500 ns')
    expect(formatTraceDuration(1_500_000)).toBe('1.50 ms')
    expect(formatTraceDuration(2_000_000_000)).toBe('2.00 s')
  })

  it('computes span position and width', () => {
    expect(traceSpanPercent({ state: 'running', start: 25, end: 75 }, 100)).toBe(50)
    expect(traceSpanPercent({ state: 'running', start: 0, end: 0 }, 0)).toBe(0)
  })

  it('classifies wait reasons', () => {
    expect(waitCategory('network')).toBe('network')
    expect(waitCategory('chan receive')).toBe('sync')
    expect(waitCategory('GC worker')).toBe('gc')
    expect(waitCategory('sleep')).toBe('sleep')
    expect(waitCategory('something else')).toBe('other')
  })

  it('filters and limits goroutines', () => {
    const r = report([goroutine(1, { running: 50 }), goroutine(2, { waiting: 90 }), goroutine(3)])
    expect(visibleGoroutines(r, '2', 10).map((g) => g.id)).toEqual([2])
    expect(visibleGoroutines(r, '', 2)).toHaveLength(2)
    expect(matchesGoroutine({ ...goroutine(1), startStack: [{ function: 'main.worker', relative: 'main.go', line: 1 }] }, 'worker')).toBe(true)
    expect(goroutineTotal(goroutine(1, { running: 5, waiting: 3 }))).toBe(8)
  })

  it('finds longest waits per category and long-running goroutines', () => {
    const r = report([
      goroutine(1, { spans: [{ state: 'waiting', reason: 'network', start: 0, end: 40 }, { state: 'waiting', reason: 'sync', start: 40, end: 60 }] }),
      goroutine(2, { alive: true, running: 80 }),
    ])
    expect(goroutinesByWait(r, 'network')[0].goroutine.id).toBe(1)
    expect(goroutinesByWait(r, 'sync')[0].span.end).toBe(60)
    expect(longRunningGoroutines(r, 10).map((g) => g.id)).toContain(2)
  })
})

describe('trace chart encoding', () => {
  it('encodes state by thickness as well as colour', async () => {
    const { traceSpanThickness, traceSpanTone } = await import('./goStudioTrace')
    expect(traceSpanThickness({ state: 'running' })).toBe(1)
    expect(traceSpanThickness({ state: 'runnable' })).toBeLessThan(1)
    expect(traceSpanThickness({ state: 'waiting' })).toBeLessThan(traceSpanThickness({ state: 'runnable' }))
    expect(traceSpanTone({ state: 'waiting' })).toBe('var(--gs-viz-wait)')
  })

  it('places ticks on round 1-2-5 steps', async () => {
    const { traceTicks } = await import('./goStudioTrace')
    expect(traceTicks(10_000_000)).toEqual([0, 2_000_000, 4_000_000, 6_000_000, 8_000_000, 10_000_000])
    expect(traceTicks(0)).toEqual([])
  })
})
