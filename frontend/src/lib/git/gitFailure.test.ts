import { describe, expect, it } from 'vitest'
import { explainGitFailure } from './gitFailure'

describe('explainGitFailure', () => {
  it('offers stash+retry when local changes block the pull', () => {
    const raw = 'git pull --rebase --autostash origin main: exit status 1\nerror: Your local changes to the following files would be overwritten by merge:\n\ta.go'
    const result = explainGitFailure(raw, 'pull')
    expect(result.recovery).toBe('stash-retry')
    expect(result.details[0]).toMatchObject({ label: 'Command', value: 'git pull --rebase --autostash origin main' })
    expect(result.details[1].value).toContain('would be overwritten')
  })

  it('routes conflicts to the resolver', () => {
    expect(explainGitFailure('git pull: exit status 1\nCONFLICT (content): Merge conflict in a.go', 'pull').recovery).toBe('resolve-conflicts')
  })

  it('explains auth and falls back to the raw output', () => {
    expect(explainGitFailure('git push: exit status 128\nfatal: Authentication failed', 'push').recovery).toBeNull()
    const unknown = explainGitFailure('boom', 'pull')
    expect(unknown.title).toBe('Git could not complete the pull')
    expect(unknown.details[0].value).toBe('boom')
  })
})
