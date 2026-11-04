import { beforeEach, describe, expect, it } from 'vitest'
import { consoleServerURL, parseConsoleLines, resetConsoleLineCache, resolveCarriageReturns, type ConsoleChunk } from './codeStudioConsoleLines'

function chunk(text: string, sequence = 1, stream: ConsoleChunk['stream'] = 'stdout'): ConsoleChunk {
  return { text, sequence, stream }
}

beforeEach(() => resetConsoleLineCache())

describe('parseConsoleLines', () => {
  it('joins a line split across two chunks instead of rendering the tail at the left margin', () => {
    // I chunk arrivano a pezzi dalla pipe: una riga spezzata a metà non diventa due righe.
    const lines = parseConsoleLines([chunk('[INFO] Building the proj'), chunk('ect SUCCESS\n')])
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toBe('[INFO] Building the project SUCCESS')
    expect(lines[0].raw).toBe('[INFO] Building the project SUCCESS')
  })

  it('keeps empty lines and the final partial line', () => {
    const lines = parseConsoleLines([chunk('a\n\nb'), chunk('c\n')])
    expect(lines.map((line) => line.text)).toEqual(['a', '', 'bc'])
  })

  it('shows the unfinished tail while the process is still writing', () => {
    expect(parseConsoleLines([chunk('partial')]).map((line) => line.text)).toEqual(['partial'])
  })

  it('appends incrementally without reparsing the whole buffer', () => {
    const first = [chunk('one\n')]
    const parsed = parseConsoleLines(first)
    const next = [...first, chunk('two\n', 2)]
    const extended = parseConsoleLines(next)
    expect(extended.map((line) => line.text)).toEqual(['one', 'two'])
    expect(extended[0]).toBe(parsed[0])
    // Stessi chunk, stesso risultato (nessun lavoro).
    expect(parseConsoleLines(next)).toBe(extended)
  })

  it('rebuilds from scratch when chunks are replaced (trimmed buffer)', () => {
    parseConsoleLines([chunk('old\n', 1)])
    const trimmed = [chunk('kept\n', 2)]
    expect(parseConsoleLines(trimmed).map((line) => line.text)).toEqual(['kept'])
  })

  it('keeps parsing incrementally when the buffer drops its oldest chunks', () => {
    const first = chunk('one\n', 1)
    const second = chunk('two\nthr', 2)
    const before = parseConsoleLines([first, second])
    const third = chunk('ee\n', 3)
    const after = parseConsoleLines([second, third])
    expect(after.map((line) => line.text)).toEqual(['two', 'three'])
    // Stessi oggetti e stessi id: al limite dei 4 MB React non ridisegna le righe e la regex non riparte.
    expect(after[0]).toBe(before[1])
    expect(after[1].id).toBe(before[2].id)
  })

  it('finds the server URL once, also after its line left the buffer', () => {
    const banner = chunk('Listening on http://localhost:8080\n', 1)
    const log = chunk('request\n', 2)
    expect(consoleServerURL([banner])).toBe('http://localhost:8080')
    expect(consoleServerURL([banner, log])).toBe('http://localhost:8080')
    expect(consoleServerURL([log])).toBe('http://localhost:8080')
    expect(consoleServerURL([chunk('nothing here\n', 3)])).toBeUndefined()
  })

  it('overwrites the line on carriage return like a terminal', () => {
    const lines = parseConsoleLines([chunk('abcdef\rXY\n')])
    expect(lines[0].text).toBe('XYcdef')
  })

  it('does not erase the line on a trailing carriage return', () => {
    const lines = parseConsoleLines([chunk('Progress 100%\r\n')])
    expect(lines[0].text).toBe('Progress 100%')
  })

  it('collapses redraw chains to the final state of the line', () => {
    const lines = parseConsoleLines([chunk('Progress: 10%\rProgress: 55%\rProgress: 100%\n')])
    expect(lines[0].text).toBe('Progress: 100%')
  })

  it('keeps SGR colors in raw and strips every escape from text', () => {
    const lines = parseConsoleLines([chunk('\x1b[31mERROR\x1b[0m \x1b]0;window title\x07\x1b[2Kdone\n')])
    expect(lines[0].text).toBe('ERROR done')
    expect(lines[0].raw).toBe('\x1b[31mERROR\x1b[0m done')
  })

  it('strips an OSC hyperlink closed with the ST terminator (ESC + backslash)', () => {
    const lines = parseConsoleLines([chunk('\x1b]8;;http://example.test\x1b\\link\x1b]8;;\x1b\\ end\n')])
    expect(lines[0].text).toBe('link end')
  })

  it('reports file locations on the cleaned text', () => {
    const lines = parseConsoleLines([chunk('[ERROR] /work/src/Main.java:[12,34] cannot find symbol\n')])
    expect(lines[0].path).toBe('/work/src/Main.java')
    expect(lines[0].line).toBe(12)
    expect(lines[0].column).toBe(34)
  })

  it('keeps stream and sequence per line', () => {
    const lines = parseConsoleLines([chunk('out\n', 1), chunk('err\n', 2, 'stderr')])
    expect(lines.map((line) => [line.stream, line.sequence])).toEqual([['stdout', 1], ['stderr', 2]])
  })
})

describe('resolveCarriageReturns', () => {
  it('leaves text without carriage returns untouched', () => {
    expect(resolveCarriageReturns('plain text')).toBe('plain text')
  })
})
