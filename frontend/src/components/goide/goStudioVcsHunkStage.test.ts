import { beforeEach, describe, expect, it, vi } from 'vitest'

const gitsync = vi.hoisted(() => ({ fileDiff: vi.fn(), applyHunk: vi.fn((_repo: string, _patch: string, _reverse: boolean) => Promise.resolve()) }))
const vcs = vi.hoisted(() => ({ repoRoot: '/repo' as string | undefined }))

vi.mock('@/wailsjs/go/main/GitSync', () => ({ FileDiff: gitsync.fileDiff, ApplyHunk: gitsync.applyHunk }))
vi.mock('@/stores/goideVcs', () => ({ useGoIDEVCSStore: { getState: () => ({ status: { s1: { repoRoot: vcs.repoRoot } } }) } }))

import { applyGoStudioHunkToIndex } from './goStudioVcsHunkStage'

const fileDiff = [
  'diff --git a/pkg/a.go b/pkg/a.go',
  'index 1111111..2222222 100644',
  '--- a/pkg/a.go',
  '+++ b/pkg/a.go',
  '@@ -1,3 +1,4 @@',
  ' one',
  '+added',
  ' two',
  ' three',
  '@@ -20,2 +21,2 @@',
  '-old',
  '+new',
  '',
].join('\n')

describe('hunk staging on the Git index', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vcs.repoRoot = '/repo'
    gitsync.fileDiff.mockResolvedValue(fileDiff)
  })

  it('stages only the hunks that touch the given lines, with the patch built from the file diff', async () => {
    const count = await applyGoStudioHunkToIndex('s1', '/repo/pkg/a.go', { oldStart: 1, oldEnd: 3, newStart: 1, newEnd: 4 }, 'stage')
    expect(count).toBe(1)
    expect(gitsync.fileDiff).toHaveBeenCalledWith('/repo', 'pkg/a.go', false)
    const [repo, patch, reverse] = gitsync.applyHunk.mock.calls[0]
    expect(repo).toBe('/repo')
    expect(reverse).toBe(false)
    expect(patch).toContain('@@ -1,3 +1,4 @@')
    expect(patch).not.toContain('@@ -20,2 +21,2 @@')
  })

  it('unstages from the index with the reverse patch', async () => {
    const count = await applyGoStudioHunkToIndex('s1', '/repo/pkg/a.go', { oldStart: 20, oldEnd: 21, newStart: 21, newEnd: 22 }, 'unstage')
    expect(count).toBe(1)
    expect(gitsync.fileDiff).toHaveBeenCalledWith('/repo', 'pkg/a.go', true)
    expect(gitsync.applyHunk.mock.calls[0][2]).toBe(true)
    expect(gitsync.applyHunk.mock.calls[0][1]).toContain('@@ -20,2 +21,2 @@')
  })

  it('applies nothing when no hunk touches those lines', async () => {
    const count = await applyGoStudioHunkToIndex('s1', '/repo/pkg/a.go', { oldStart: 90, oldEnd: 91, newStart: 90, newEnd: 91 }, 'stage')
    expect(count).toBe(0)
    expect(gitsync.applyHunk).not.toHaveBeenCalled()
  })

  it('fails clearly outside a Git repository', async () => {
    vcs.repoRoot = undefined
    await expect(applyGoStudioHunkToIndex('s1', '/repo/pkg/a.go', { oldStart: 1, oldEnd: 3, newStart: 1, newEnd: 4 }, 'stage')).rejects.toThrow('not inside a Git repository')
    expect(gitsync.fileDiff).not.toHaveBeenCalled()
  })
})
