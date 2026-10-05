import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fuzzFailureSignature, fuzzTargetOfCommand, groupFuzzCrashes, loadFuzzSessions, parseFuzzSession, recordFuzzSession } from './goStudioFuzzSessions'

const CRASH = [
  'fuzz: elapsed: 0s, gathering baseline coverage: 3/3 completed, now fuzzing with 8 workers',
  'fuzz: elapsed: 3s, execs: 325017 (108336/sec), new interesting: 11 (total: 14)',
  'fuzz: elapsed: 4s, minimizing',
  '--- FAIL: FuzzReverse (0.03s)',
  '    --- FAIL: FuzzReverse (0.00s)',
  '        reverse_test.go:20: Reverse produced invalid UTF-8 string "\x9c\xdd"',
  '',
  '    Failing input written to testdata/fuzz/FuzzReverse/af69258a12129d6c',
  '    To re-run:',
  '    go test -run=FuzzReverse/af69258a12129d6c',
  'FAIL',
].join('\n')

const run = (id: string, startedAt = '2026-10-05T10:00:00Z') => ({ id, command: 'go test ./rev -run ^$ -fuzz ^FuzzReverse$ -fuzztime=30s', status: 'failed', startedAt, durationMillis: 4100 })

describe('fuzz sessions', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) })
  })

  it('recognises fuzz commands but not replays', () => {
    expect(fuzzTargetOfCommand('go test . -run ^$ -fuzz ^FuzzX$ -fuzztime=30s')).toBe('FuzzX')
    expect(fuzzTargetOfCommand('go test . -fuzz=FuzzY')).toBe('FuzzY')
    expect(fuzzTargetOfCommand('go test . -run=^FuzzX$/abc')).toBeNull()
  })

  it('parses stats, the crash file and minimization from go test output', () => {
    expect(parseFuzzSession(run('a'), CRASH)).toMatchObject({
      target: 'FuzzReverse', status: 'crashed', workers: 8, execs: 325017, execsPerSecond: 108336, newInteresting: 11, corpusTotal: 14,
      crashFile: 'testdata/fuzz/FuzzReverse/af69258a12129d6c', minimized: true,
      failure: 'reverse_test.go:20: Reverse produced invalid UTF-8 string "\x9c\xdd"',
      signature: 'Reverse produced invalid UTF-N string …',
    })
    expect(parseFuzzSession({ ...run('b'), status: 'exited' }, 'fuzz: elapsed: 30s, execs: 10 (1/sec), new interesting: 0 (total: 3)\nPASS')).toMatchObject({ status: 'exited', crashFile: null, failure: null })
  })

  it('normalises panics and groups identical crashes', () => {
    expect(fuzzFailureSignature('panic: runtime error: index out of range [3] with length 3')).toBe('panic: runtime error: index out of range [N] with length N')
    const first = parseFuzzSession(run('a', '2026-10-05T10:00:00Z'), CRASH)!
    const second = parseFuzzSession(run('b', '2026-10-05T11:00:00Z'), CRASH.replace('\x9c\xdd', '\xff'))!
    recordFuzzSession('C:/p', first)
    const sessions = recordFuzzSession('C:/p', second)
    expect(loadFuzzSessions('C:/p')).toHaveLength(2)
    const groups = groupFuzzCrashes(sessions)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ count: 2, latest: { id: 'b' } })
  })
})
