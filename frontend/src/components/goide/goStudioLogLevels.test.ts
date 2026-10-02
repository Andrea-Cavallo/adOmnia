import { describe, expect, it } from 'vitest'
import { consoleLogLevel, consoleSegments } from './goStudioLogLevels'

describe('consoleLogLevel', () => {
  it.each([
    ['2026/10/02 08:41:35 [ERROR] db down', 'error'],
    ['time=2026-10-02T08:41:35Z level=WARN msg="slow query"', 'warn'],
    ['{"time":"2026-10-02T08:41:35Z","level":"INFO","msg":"started"}', 'info'],
    ['2026-10-02T08:41:35.123Z\tDEBUG\tcache\thit', 'debug'],
    ['INFO[0000] listening on :8080', 'info'],
    ['panic: runtime error: index out of range', 'error'],
    ['--- FAIL: TestLogin (0.01s)', 'error'],
    ['ok  \texample.com/app\t0.012s', 'success'],
    ['--- PASS: TestLogin (0.00s)', 'success'],
  ])('%s → %s', (line, level) => {
    expect(consoleLogLevel(line)).toBe(level)
  })

  it('ignores plain lines and level words deep inside the message', () => {
    expect(consoleLogLevel('2026/10/02 08:41:35 listening on :8080')).toBeNull()
    expect(consoleLogLevel('2026/10/02 08:41:35 user clicked the button that shows the error page')).toBeNull()
  })
})

describe('consoleSegments', () => {
  it('splits timestamp, level token and message', () => {
    expect(consoleSegments('2026/10/02 08:41:35 [WARN] disk 91%')).toEqual([
      { text: '2026/10/02 08:41:35', kind: 'timestamp' },
      { text: ' [', kind: 'text' },
      { text: 'WARN', kind: 'level' },
      { text: '] disk 91%', kind: 'text' },
    ])
  })

  it('leaves lines without a header untouched', () => {
    expect(consoleSegments('hello')).toEqual([{ text: 'hello', kind: 'text' }])
  })
})
