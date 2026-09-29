import { describe, expect, it } from 'vitest'
import type { GoIDEGoroutine } from '@/lib/goide-debug-api'
import { LEAK_THRESHOLD, diagnoseConcurrency, groupGoroutines, parseRaceReports, raceDiagnostics, splitFunctionName, waitResources } from './goStudioConcurrency'
import { frameVariables, inlineValueText } from './goStudioDebugInlineValues'

function goroutine(id: number, state: string, origin: string, extra: Partial<GoIDEGoroutine> = {}): GoIDEGoroutine {
  return {
    id, name: `[Go ${id}] ${origin}`, current: false, state, frames: [],
    origin: { id: 0, name: origin, relativePath: 'service.go', line: 40, column: 1 },
    location: { id: 0, name: origin, relativePath: 'service.go', line: 84, column: 1 },
    ...extra,
  } as GoIDEGoroutine
}

describe('Go Studio concurrency view', () => {
  it('splits package and function names, including import paths', () => {
    expect(splitFunctionName('main.(*Service).Start.func1')).toEqual({ pkg: 'main', name: '(*Service).Start.func1' })
    expect(splitFunctionName('github.com/acme/kafka.Consumer')).toEqual({ pkg: 'github.com/acme/kafka', name: 'Consumer' })
  })

  it('groups goroutines by package and starting function, current goroutine first', () => {
    const tree = groupGoroutines([
      goroutine(24, 'mutex', 'main.worker'),
      goroutine(18, 'running', 'main.worker', { current: true }),
      goroutine(31, 'running', 'github.com/acme/kafka.Consumer'),
      goroutine(1, 'running', 'main.main'),
    ])
    expect(tree.map((entry) => entry.pkg)).toEqual(['github.com/acme/kafka', 'main'])
    const main = tree[1]
    expect(main.total).toBe(3)
    expect(main.groups[0].name).toBe('worker')
    expect(main.groups[0].goroutines.map((item) => item.id)).toEqual([18, 24])
    expect(main.groups[0].blocked).toBe(1)
  })

  it('flags a possible deadlock only when every goroutine waits on another one', () => {
    const stuck = [goroutine(1, 'chan receive', 'main.main'), goroutine(7, 'mutex', 'main.worker')]
    expect(diagnoseConcurrency(stuck)[0].kind).toBe('deadlock')
    expect(diagnoseConcurrency([...stuck, goroutine(9, 'running', 'main.tick')]).some((item) => item.kind === 'deadlock')).toBe(false)
    expect(diagnoseConcurrency([goroutine(3, 'sleep', 'main.tick')])).toEqual([])
  })

  it('reports channel blocking, mutex contention and leaks by wait location', () => {
    const blockedOnChannel = [1, 2].map((id) => goroutine(id, 'chan receive', 'main.consumer', { blockedOn: 's.orders' }))
    const contended = [3, 4].map((id) => goroutine(id, 'mutex', 'main.update', { blockedOn: 's.mu', location: { id: 0, name: 'main.update', relativePath: 'store.go', line: 12, column: 1 } }))
    const leaked = Array.from({ length: LEAK_THRESHOLD }, (_, index) => goroutine(100 + index, 'chan send', 'main.fanOut', { blockedOn: 'results', location: { id: 0, name: 'main.fanOut', relativePath: 'fan.go', line: 7, column: 1 } }))
    const kinds = diagnoseConcurrency([...blockedOnChannel, ...contended, ...leaked, goroutine(9, 'running', 'main.main')]).map((item) => item.kind)
    expect(kinds).toContain('channel')
    expect(kinds).toContain('mutex')
    expect(kinds).toContain('leak')
    expect(waitResources(blockedOnChannel)).toHaveLength(1)
  })

  it('parses race detector reports into accesses and creation stacks', () => {
    const output = `ok
==================
WARNING: DATA RACE
Write at 0x00c00001c0f8 by goroutine 7:
  main.(*Counter).Inc()
      /home/me/app/counter.go:14 +0x44
  main.main.func1()
      /home/me/app/main.go:21 +0x30

Previous read at 0x00c00001c0f8 by main goroutine:
  main.(*Counter).Value()
      /home/me/app/counter.go:18 +0x3a

Goroutine 7 (running) created at:
  main.main()
      /home/me/app/main.go:20 +0x9c
==================
Found 1 data race(s)`
    const reports = parseRaceReports(output)
    expect(reports).toHaveLength(1)
    const [write, read] = reports[0].accesses
    expect(write).toMatchObject({ kind: 'Write', goroutine: 7 })
    expect(write.frames[0]).toEqual({ func: 'main.(*Counter).Inc', path: '/home/me/app/counter.go', line: 14 })
    expect(read).toMatchObject({ kind: 'Previous read', goroutine: 1 })
    expect(reports[0].goroutines[0]).toMatchObject({ id: 7, state: 'running' })
    expect(reports[0].goroutines[0].createdAt[0].line).toBe(20)
    expect(parseRaceReports(output + '\n' + output)).toHaveLength(1)
    expect(raceDiagnostics(reports)[0]).toMatchObject({ kind: 'race', severity: 'error', line: 14 })
  })
})

describe('Go Studio inline debug values', () => {
  const source = [
    'package main',
    '',
    'func main() {',
    '\tcount := 3',
    '\tname := "gopher" // name is shown',
    '\tfmt.Println(count)',
    '\tuser.name = "x"',
    '}',
  ]

  it('shows each variable on the last line where it appears, inside the current function', () => {
    const lines = inlineValueText(source, 7, [{ name: 'count', value: '3' }, { name: 'name', value: '"gopher"' }])
    expect(lines.get(6)).toBe('count = 3')
    expect(lines.get(5)).toBe('name = "gopher"')
    expect(lines.has(7)).toBe(false)
  })

  it('skips globals and synthetic return values', () => {
    const variables = frameVariables(
      [{ name: 'Locals', variablesReference: 1, expensive: false }, { name: 'Globals (package main)', variablesReference: 2, expensive: false }],
      { 1: [{ name: 'count', value: '3', variablesReference: 0 }, { name: '~r0', value: '0', variablesReference: 0 }], 2: [{ name: 'Version', value: '"1"', variablesReference: 0 }] },
    )
    expect(variables).toEqual([{ name: 'count', value: '3' }])
  })
})
