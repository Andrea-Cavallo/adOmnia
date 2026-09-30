import { describe, expect, it } from 'vitest'
import { TerminalLineTracker, cleanBufferText, detectGoCommand, findTerminalLinks, projectRelativePath, pushHistory, terminalLinkTarget } from './goStudioTerminalLinks'

describe('findTerminalLinks', () => {
  it('finds build errors, stack frames and Windows paths but not host:port', () => {
    expect(findTerminalLinks('./geom/area.go:12:5: undefined: foo')).toEqual([{ start: 0, end: 19, path: './geom/area.go', line: 12, column: 5 }])
    const frame = findTerminalLinks('\t/usr/local/go/src/runtime/panic.go:770 +0x124')[0]
    expect(frame).toMatchObject({ start: 1, path: '/usr/local/go/src/runtime/panic.go', line: 770, column: 1 })
    expect(findTerminalLinks('\tC:/Users/me/app/main.go:9 +0x25')[0]).toMatchObject({ path: 'C:/Users/me/app/main.go', line: 9 })
    expect(findTerminalLinks('    main_test.go:21: got 3, want 4')[0]).toMatchObject({ path: 'main_test.go', line: 21 })
    expect(findTerminalLinks('listening on example.com:443 and 127.0.0.1:8080')).toEqual([])
  })
})

describe('terminalLinkTarget', () => {
  it('opens project files by relative path and anything else as external', () => {
    expect(terminalLinkTarget('./geom/area.go', 'C:\\proj\\cmd', ['C:\\proj'])).toEqual({ kind: 'project', relativePath: 'cmd/geom/area.go' })
    expect(terminalLinkTarget('../lib.go', '/home/me/proj/cmd', ['/home/me/proj'])).toEqual({ kind: 'project', relativePath: 'lib.go' })
    expect(terminalLinkTarget('/usr/local/go/src/runtime/panic.go', '/home/me/proj', ['/home/me/proj'])).toEqual({ kind: 'external', path: '/usr/local/go/src/runtime/panic.go' })
    expect(projectRelativePath('C:\\proj', ['c:/proj/'])).toBe('')
    expect(projectRelativePath('C:\\proj\\cmd\\app', ['C:\\proj'])).toBe('cmd/app')
    expect(projectRelativePath('C:\\projects', ['C:\\proj'])).toBeNull()
  })
})

describe('detectGoCommand', () => {
  it('turns go test into a Test Explorer request', () => {
    expect(detectGoCommand('go test ./... -run TestArea -race -tags=integration,slow -count 1')).toEqual({
      subcommand: 'test',
      test: { packages: ['./...'], run: 'TestArea', bench: undefined, race: true, coverage: false, buildTags: ['integration', 'slow'] },
    })
    expect(detectGoCommand('go test -cover')?.test).toMatchObject({ packages: ['.'], coverage: true })
  })

  it('recognizes other go commands without a test request', () => {
    expect(detectGoCommand('go build ./cmd/app')).toEqual({ subcommand: 'build' })
    expect(detectGoCommand('go test ./... | tee out.txt')).toEqual({ subcommand: 'test' })
    expect(detectGoCommand('go test -exec foo ./...')).toEqual({ subcommand: 'test' })
    expect(detectGoCommand('gofmt -l .')).toBeNull()
    expect(detectGoCommand('echo go test')).toBeNull()
  })
})

describe('TerminalLineTracker', () => {
  it('rebuilds typed commands, including backspace and paste', () => {
    const tracker = new TerminalLineTracker()
    expect(tracker.push('go tesx')).toEqual([])
    expect(tracker.push('\x7ft ./...\r')).toEqual(['go test ./...'])
    expect(tracker.push('\x1b[200~go vet ./...\x1b[201~')).toEqual([])
    expect(tracker.push('\r')).toEqual(['go vet ./...'])
  })

  it('skips lines edited with arrows or tab completion, and resets on Ctrl+C', () => {
    const tracker = new TerminalLineTracker()
    expect(tracker.push('\x1b[A\r')).toEqual([])
    expect(tracker.push('go te\t\r')).toEqual([])
    expect(tracker.push('\x1b[Dxx\x03ls\r')).toEqual(['ls'])
  })
})

describe('history and clean output', () => {
  it('keeps history unique and newest first', () => {
    expect(pushHistory(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
    expect(pushHistory(['a'], 'export GITHUB_TOKEN=abc')).toEqual(['a'])
    expect(pushHistory(['a'], 'curl -H "Authorization: Bearer x" localhost')).toEqual(['a'])
  })

  it('joins wrapped rows and trims trailing blanks', () => {
    expect(cleanBufferText([{ text: 'abc', wrapped: false }, { text: 'def  ', wrapped: true }, { text: 'x', wrapped: false }, { text: '', wrapped: false }])).toBe('abcdef\nx')
  })
})
