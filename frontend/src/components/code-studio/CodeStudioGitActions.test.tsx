import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { normalizeBranch, normalizeChange } from '@/lib/git/overview'
import { CodeStudioGitBranches, CodeStudioGitChangesActions } from './CodeStudioGitActions'

vi.mock('@/wailsjs/go/main/GitSync', () => ({}))

const run = async () => undefined

describe('IDE Git actions', () => {
  it('offers switch, merge and delete only for non-current local branches', () => {
    const branches = [normalizeBranch({ name: 'main', current: true }), normalizeBranch({ name: 'feature/x' }), normalizeBranch({ name: 'origin/main', remote: true })]
    const html = renderToStaticMarkup(<CodeStudioGitBranches repoRoot="/repo" branches={branches} busy={false} run={run} />)
    expect(html).toContain('aria-label="New branch name"')
    expect(html).toContain('Merge feature/x into current branch')
    expect(html).toContain('Delete branch feature/x')
    expect(html).not.toContain('Delete branch main')
    expect(html).toContain('title="Check out main as a tracking branch"')
  })

  it('lists conflicts with resolve and abort, and disables stash without changes', () => {
    const conflicts = [normalizeChange({ path: 'a.go', conflicted: true, index: 'U', worktree: 'U' })]
    const html = renderToStaticMarkup(<CodeStudioGitChangesActions repoRoot="/repo" changes={[]} conflicts={conflicts} stashes={['stash@{0}: WIP']} busy={false} run={run} onResolve={() => undefined} />)
    expect(html).toContain('Merge conflicts (1)')
    expect(html).toContain('Mark resolved')
    expect(html).toContain('Abort')
    expect(html).toMatch(/disabled=""[^>]*title="Stash working changes"/)
    expect(html).toContain('1 stash · stash@{0}: WIP')
  })
})
