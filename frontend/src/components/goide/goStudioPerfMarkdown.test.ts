import { describe, expect, it } from 'vitest'
import { hotPaths, markdownFileName, profileToMarkdown, sourceLocation, traceToMarkdown } from './goStudioPerfMarkdown'
import type { ProfileReport } from './goStudioProfiles'
import type { TraceReport } from './goStudioTrace'

const fn = (name: string, pkg: string, extra: Record<string, unknown> = {}) => ({ name, short: name.split('.').pop() ?? name, package: pkg, ...extra })
const handler = fn('example.com/shop/api.(*Handler).List', 'example.com/shop/api', { relative: 'api/list.go', line: 41, file: '/home/andrea/shop/api/list.go' })
const query = fn('github.com/jackc/pgx/v5.(*Conn).Query', 'github.com/jackc/pgx/v5', { file: '/home/andrea/go/pkg/mod/github.com/jackc/pgx/v5/conn.go', line: 400 })
const malloc = fn('runtime.mallocgc', 'runtime', { runtime: true, file: 'C:\\Program Files\\Go\\src\\runtime\\malloc.go', line: 900 })
const pipeName = fn('main.weird|name', 'main', { relative: 'main.go', line: 3 })

const node = (f: object, value: number, children: unknown[] = []) => ({ function: f, value: [value], children })

function profile(scale = 1): ProfileReport {
  return {
    path: '/home/andrea/shop/cpu.pprof', name: 'cpu.pprof', kind: 'cpu', durationNanos: 0, time: '2026-10-03 10:00', samples: 1000,
    periodType: { name: 'cpu', unit: 'nanoseconds' }, period: 1,
    sampleTypes: [{ name: 'samples', unit: 'count' }, { name: 'cpu', unit: 'nanoseconds' }],
    totals: [1000, 1_000_000_000],
    topFlat: [
      { function: query, flat: [400, 400_000_000 * scale], cum: [400, 400_000_000] },
      { function: malloc, flat: [300, 300_000_000], cum: [300, 300_000_000] },
      { function: handler, flat: [200, 200_000_000], cum: [900, 900_000_000] },
      { function: pipeName, flat: [100, 100_000_000], cum: [100, 100_000_000] },
    ],
    topCum: [],
    flame: node(fn('root', ''), 1_000_000_000, [node(handler, 900_000_000, [node(query, 400_000_000), node(malloc, 300_000_000)]), node(pipeName, 100_000_000)]) as never,
    edges: [{ caller: handler, callee: query, value: [400, 400_000_000] }],
    lines: [{ file: '/home/andrea/shop/api/list.go', relative: 'api/list.go', line: 44, value: [200, 200_000_000] }],
  } as unknown as ProfileReport
}

describe('profileToMarkdown', () => {
  const markdown = profileToMarkdown(profile(), { sampleIndex: 1 })

  it('has the sections an assistant needs', () => {
    for (const heading of ['# Go cpu profile: cpu.pprof', '## Context', '## How to read this', '## Summary', '## Top 25 functions by flat', '## Hot paths', '## Heaviest call edges', '## Hottest source lines', '## Notes for the assistant']) {
      expect(markdown).toContain(heading)
    }
    expect(markdown).toContain('Biggest hotspot in project code: `example.com/shop/api.(*Handler).List`')
  })

  it('never leaks absolute machine paths', () => {
    expect(markdown).not.toMatch(/\/home\/andrea|Program Files/)
    expect(markdown).toContain('api/list.go:41')
    expect(markdown).toContain('malloc.go:900')
  })

  it('escapes table cells and labels origins', () => {
    expect(markdown).toContain('weird\\|name')
    expect(markdown).toMatch(/\| `List` \| example\.com\/shop\/api \| project \|/)
    expect(markdown).toContain('| dependency |')
  })

  it('adds regressions and improvements when comparing', () => {
    const compared = profileToMarkdown(profile(), { sampleIndex: 1, compareWith: profile(1.5) })
    expect(compared).toContain('## Comparison: cpu.pprof → cpu.pprof')
    expect(compared).toMatch(/### Regressions[\s\S]*`Query`[\s\S]*\+50%/)
  })
})

describe('hotPaths', () => {
  it('ranks stacks by the self value of their last frame', () => {
    const paths = hotPaths(profile().flame, 1)
    expect(paths.map((path) => path.frames.map((frame) => frame.short).join('>'))).toEqual(['List>Query', 'List>mallocgc', 'List', 'weird|name'])
    expect(paths[0].self).toBe(400_000_000)
  })
})

describe('traceToMarkdown', () => {
  const ms = 1_000_000
  const report = {
    path: 'trace.out', name: 'trace.out', durationNanos: 100 * ms,
    goroutines: [
      { id: 7, start: 0, end: 100 * ms, alive: true, startStack: [{ function: 'example.com/shop/worker.(*Pool).run', relative: 'worker/pool.go', line: 12 }],
        spans: [{ state: 'waiting', reason: 'sync.Mutex.Lock', start: 10 * ms, end: 40 * ms, stack: [{ function: 'sync.(*Mutex).Lock', file: '/usr/local/go/src/sync/mutex.go', line: 81 }] }],
        running: 40 * ms, runnable: 20 * ms, waiting: 30 * ms, syscall: 0 },
    ],
    procs: [{ id: 0, running: 60 * ms, spans: [] }],
    gc: [{ kind: 'gc', name: 'GC cycle 1', start: 50 * ms, end: 55 * ms }],
    events: [{ time: 2 * ms, category: 'log', label: 'cache | warmed', goroutine: 7 }],
    stats: { goroutines: 1, events: 1, running: 40 * ms, runnable: 20 * ms, waiting: 30 * ms, syscall: 0, gc: 5 * ms, gcWait: 0, networkWait: 0, syncWait: 30 * ms },
  } as unknown as TraceReport
  const markdown = traceToMarkdown(report)

  it('summarises states, GC, processors, blocking and events', () => {
    for (const heading of ['# Go execution trace: trace.out', '## Time breakdown', '## GC and stop-the-world', '## Processor utilization', '### Synchronization', '## Long-running or still-alive goroutines', '## Most scheduler latency', '## Runtime events']) {
      expect(markdown).toContain(heading)
    }
    expect(markdown).toContain('| P0 | 60.00 ms | 60.0% |')
    expect(markdown).toContain('1 ranges, 5.00 ms in total (5.0% of the trace)')
    expect(markdown).toContain('sync.Mutex.Lock')
    expect(markdown).toContain('mutex.go:81')
    expect(markdown).toContain('cache \\| warmed')
    expect(markdown).not.toContain('/usr/local/go')
  })
})

describe('helpers', () => {
  it('formats safe locations and file names', () => {
    expect(sourceLocation({ relative: 'a/b.go', file: '/x/a/b.go', line: 3 })).toBe('a/b.go:3')
    expect(sourceLocation({ file: 'C:\\Go\\src\\fmt\\print.go' })).toBe('print.go')
    expect(sourceLocation({})).toBe('—')
    expect(markdownFileName('profiles/cpu.pprof', 'profile')).toBe('cpu-profile.md')
  })
})

describe('fitForChat', () => {
  it('keeps short reports and truncates long ones on line boundaries', async () => {
    const { fitForChat } = await import('./GoStudioPerfExport')
    expect(fitForChat('# short\n', 1000)).toBe('# short\n')
    const long = Array.from({ length: 500 }, (_, i) => `| row ${i} | value |`).join('\n')
    const fitted = fitForChat(long, 2000)
    expect(new TextEncoder().encode(fitted).length).toBeLessThanOrEqual(2000)
    expect(fitted).toContain('Report truncated to fit the chat')
    expect(fitted.split('\n')[0]).toBe('| row 0 | value |')
  })
})
