import { describe, expect, it } from 'vitest'
import { buildTreeMarks, vcsMark } from './goStudioTreeMarks'

const change = (relativePath: string, status: string, extra: Partial<{ untracked: boolean; conflicted: boolean }> = {}) => ({ relativePath, status, untracked: false, conflicted: false, ...extra })

describe('Project tree marks', () => {
  it('maps git porcelain codes', () => {
    expect(vcsMark(change('a.go', ' M'))).toBe('modified')
    expect(vcsMark(change('a.go', 'A '))).toBe('added')
    expect(vcsMark(change('a.go', '??', { untracked: true }))).toBe('untracked')
    expect(vcsMark(change('a.go', ' D'))).toBe('deleted')
    expect(vcsMark(change('a.go', 'UU', { conflicted: true }))).toBe('conflicted')
  })

  it('propagates the most important mark to every parent folder', () => {
    const marks = buildTreeMarks({
      changes: [change('internal/api/server.go', ' M'), change('internal/db/store.go', 'UU', { conflicted: true }), change('notes.md', '??', { untracked: true })],
      diagnostics: [
        { relativePath: 'internal/api/server.go', diagnostics: [{ severity: 2 }, { severity: 2 }] },
        { relativePath: 'internal/api/handler.go', diagnostics: [{ severity: 1 }] },
        { relativePath: 'cmd/app/main.go', diagnostics: [{ severity: 3 }] },
      ],
      failedTestFiles: ['internal/api/server_test.go'],
    })
    expect(marks.get('internal/api/server.go')).toEqual({ vcs: 'modified', problem: 'warning', problems: 2 })
    expect(marks.get('internal/api')).toMatchObject({ vcs: 'modified', problem: 'error', problems: 1, testFailed: true })
    expect(marks.get('internal')).toMatchObject({ vcs: 'conflicted', problem: 'error' })
    expect(marks.get('notes.md')).toEqual({ vcs: 'untracked' })
    expect(marks.has('cmd/app/main.go')).toBe(false)
  })
})
