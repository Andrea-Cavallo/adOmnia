import { describe, expect, it } from 'vitest'
import { changeLabel, isStagedChange, isUnstagedChange, parseGitOverview, shortBranch } from './overview'
import type { FileChange } from './types'

const change = (index: string, worktree: string, extra: Partial<FileChange> = {}): FileChange => ({ path: 'a.go', index, worktree, status: `${index}${worktree}`, conflicted: false, ...extra })

describe('parseGitOverview', () => {
  it('coerces null collections coming from Go nil slices', () => {
    const overview = parseGitOverview(JSON.stringify({ status: { branch: 'main', modified: null }, changes: null, branches: null, stashes: null, commits: [null] }))
    expect(overview.status.branch).toBe('main')
    expect(overview.status.modified).toEqual([])
    expect(overview.changes).toEqual([])
    expect(overview.stashes).toEqual([])
    expect(overview.commits[0]).toMatchObject({ hash: '', parents: [], decorations: [] })
  })

  it('survives invalid JSON', () => {
    expect(parseGitOverview('not json').branches).toEqual([])
  })
})

describe('staging model', () => {
  it('treats MM as both staged and unstaged', () => {
    expect(isStagedChange(change('M', 'M'))).toBe(true)
    expect(isUnstagedChange(change('M', 'M'))).toBe(true)
  })

  it('ignores blank index/worktree columns, untracked files and conflicts', () => {
    expect(isStagedChange(change(' ', 'M'))).toBe(false)
    expect(isStagedChange(change('?', '?'))).toBe(false)
    expect(isUnstagedChange(change('M', ' '))).toBe(false)
    expect(isStagedChange(change('U', 'U', { conflicted: true }))).toBe(false)
  })

  it('labels and shortens', () => {
    expect(changeLabel(change('?', '?'))).toBe('Untracked')
    expect(changeLabel(change('A', ' '))).toBe('Added')
    expect(shortBranch('remotes/origin/main')).toBe('main')
  })
})
