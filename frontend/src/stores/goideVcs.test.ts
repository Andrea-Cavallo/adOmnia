import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/goide-api', () => ({ subscribeGoIDEEvents: vi.fn(() => () => undefined) }))
vi.mock('@/lib/goide-vcs-api', () => ({
  checkoutGoIDEBranch: vi.fn(), commitGoIDEFiles: vi.fn(), getGoIDEBlame: vi.fn(),
  getGoIDEFileAtRevision: vi.fn(), getGoIDEVCSStatus: vi.fn(),
}))

import { getGoIDEFileAtRevision } from '@/lib/goide-vcs-api'
import type { GoIDEVCSStatus } from '@/lib/goide-vcs-api'
import { isBinaryText, lineDiff } from '@/components/goide/goStudioLineDiff'
import { headKey, useGoIDEVCSStore } from './goideVcs'

const fileAtRevision = vi.mocked(getGoIDEFileAtRevision)

function status(changes: Array<{ relativePath: string; untracked?: boolean }>): GoIDEVCSStatus {
  return {
    available: true, branch: 'main', head: 'abc', ahead: 0, behind: 0, branches: ['main'], conflicts: 0,
    changes: changes.map((change) => ({ status: change.untracked ? '??' : ' M', staged: false, conflicted: false, untracked: false, ...change })),
  } as unknown as GoIDEVCSStatus
}

describe('Go Studio VCS gutter baseline', () => {
  beforeEach(() => {
    fileAtRevision.mockReset()
    useGoIDEVCSStore.setState({ status: {}, head: {}, blame: {}, hunkPopup: null, error: null })
  })

  it('never diffs an untracked file: no HEAD read, no markers', async () => {
    useGoIDEVCSStore.setState({ status: { s1: status([{ relativePath: 'new.go', untracked: true }]) } })
    await useGoIDEVCSStore.getState().loadHead('s1', 'new.go')
    expect(fileAtRevision).not.toHaveBeenCalled()
    expect(useGoIDEVCSStore.getState().head[headKey('s1', 'new.go')]).toBeNull()
  })

  it('treats a binary HEAD revision like an unversioned file', async () => {
    useGoIDEVCSStore.setState({ status: { s1: status([{ relativePath: 'logo.png' }]) } })
    fileAtRevision.mockResolvedValue('\u0089PNG\r\n\u001a\n\u0000\u0000\u0000\rIHDR')
    await useGoIDEVCSStore.getState().loadHead('s1', 'logo.png')
    expect(useGoIDEVCSStore.getState().head[headKey('s1', 'logo.png')]).toBeNull()
  })

  it('keeps a text HEAD revision, per session, and diffs it ignoring CRLF', async () => {
    useGoIDEVCSStore.setState({ status: { s1: status([{ relativePath: 'main.go' }]), s2: status([]) } })
    fileAtRevision.mockResolvedValue('package main\r\n\r\nfunc main() {}\r\n')
    await useGoIDEVCSStore.getState().loadHead('s1', 'main.go')
    const head = useGoIDEVCSStore.getState().head[headKey('s1', 'main.go')]
    expect(head).toContain('package main')
    expect(useGoIDEVCSStore.getState().head[headKey('s2', 'main.go')]).toBeUndefined()
    expect(lineDiff(head ?? '', 'package main\n\nfunc main() {}\n')).toEqual([])
  })

  it('does not read HEAD when the session is not in a repository', async () => {
    useGoIDEVCSStore.setState({ status: { s1: { ...status([]), available: false } } })
    await useGoIDEVCSStore.getState().loadHead('s1', 'main.go')
    expect(fileAtRevision).not.toHaveBeenCalled()
    expect(headKey('s1', 'main.go') in useGoIDEVCSStore.getState().head).toBe(false)
  })
})

describe('binary detection', () => {
  it('follows Git: a NUL byte in the first 8000 characters', () => {
    expect(isBinaryText('package main\n')).toBe(false)
    expect(isBinaryText('abc\u0000def')).toBe(true)
    expect(isBinaryText(`${'a'.repeat(9000)}\u0000`)).toBe(false)
  })
})
