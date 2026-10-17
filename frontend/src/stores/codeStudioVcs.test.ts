import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/code-studio-api', () => ({ subscribeGoIDEEvents: vi.fn(() => () => undefined) }))
vi.mock('@/lib/code-studio-vcs-api', () => ({
  checkoutGoIDEBranch: vi.fn(), commitGoIDEFiles: vi.fn(), getGoIDEBlame: vi.fn(),
  getGoIDEFileAtRevision: vi.fn(), getGoIDEVCSStatus: vi.fn(), selectGoIDERepository: vi.fn(),
}))

import { getGoIDEFileAtRevision, getGoIDEVCSStatus, selectGoIDERepository } from '@/lib/code-studio-vcs-api'
import type { GoIDEVCSStatus } from '@/lib/code-studio-vcs-api'
import { isBinaryText, lineDiff } from '@/lib/code-studio/codeStudioLineDiff'
import { headKey, useCodeStudioVCSStore } from './codeStudioVcs'

const fileAtRevision = vi.mocked(getGoIDEFileAtRevision)

function status(changes: Array<{ relativePath: string; untracked?: boolean }>): GoIDEVCSStatus {
  return {
    available: true, branch: 'main', head: 'abc', ahead: 0, behind: 0, branches: ['main'], conflicts: 0,
    changes: changes.map((change) => ({ status: change.untracked ? '??' : ' M', staged: false, conflicted: false, untracked: false, ...change })),
  } as unknown as GoIDEVCSStatus
}

describe('Code Studio VCS gutter baseline', () => {
  beforeEach(() => {
    fileAtRevision.mockReset()
    useCodeStudioVCSStore.setState({ status: {}, head: {}, blame: {}, hunkPopup: null, error: null })
  })

  it('never diffs an untracked file: no HEAD read, no markers', async () => {
    useCodeStudioVCSStore.setState({ status: { s1: status([{ relativePath: 'new.go', untracked: true }]) } })
    await useCodeStudioVCSStore.getState().loadHead('s1', 'new.go')
    expect(fileAtRevision).not.toHaveBeenCalled()
    expect(useCodeStudioVCSStore.getState().head[headKey('s1', 'new.go')]).toBeNull()
  })

  it('keeps a repository selection when an older status request finishes late', async () => {
    let finish!: (value: GoIDEVCSStatus) => void
    vi.mocked(getGoIDEVCSStatus).mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    const refreshing = useCodeStudioVCSStore.getState().refreshStatus('multi-repo')
    vi.mocked(selectGoIDERepository).mockResolvedValueOnce({ ...status([]), repoRoot: '/workspace/worker' } as GoIDEVCSStatus)
    useCodeStudioVCSStore.setState({ head: { [headKey('multi-repo', 'api/main.go')]: 'old baseline' } })
    await useCodeStudioVCSStore.getState().selectRepository('multi-repo', '/workspace/worker')
    finish({ ...status([]), repoRoot: '/workspace/api' } as GoIDEVCSStatus)
    await refreshing
    expect(useCodeStudioVCSStore.getState().status['multi-repo']?.repoRoot).toBe('/workspace/worker')
    expect(useCodeStudioVCSStore.getState().head[headKey('multi-repo', 'api/main.go')]).toBeUndefined()
  })

  it('treats a binary HEAD revision like an unversioned file', async () => {
    useCodeStudioVCSStore.setState({ status: { s1: status([{ relativePath: 'logo.png' }]) } })
    fileAtRevision.mockResolvedValue('\u0089PNG\r\n\u001a\n\u0000\u0000\u0000\rIHDR')
    await useCodeStudioVCSStore.getState().loadHead('s1', 'logo.png')
    expect(useCodeStudioVCSStore.getState().head[headKey('s1', 'logo.png')]).toBeNull()
  })

  it('keeps a text HEAD revision, per session, and diffs it ignoring CRLF', async () => {
    useCodeStudioVCSStore.setState({ status: { s1: status([{ relativePath: 'main.go' }]), s2: status([]) } })
    fileAtRevision.mockResolvedValue('package main\r\n\r\nfunc main() {}\r\n')
    await useCodeStudioVCSStore.getState().loadHead('s1', 'main.go')
    const head = useCodeStudioVCSStore.getState().head[headKey('s1', 'main.go')]
    expect(head).toContain('package main')
    expect(useCodeStudioVCSStore.getState().head[headKey('s2', 'main.go')]).toBeUndefined()
    expect(lineDiff(head ?? '', 'package main\n\nfunc main() {}\n')).toEqual([])
  })

  it('does not read HEAD when the session is not in a repository', async () => {
    useCodeStudioVCSStore.setState({ status: { s1: { ...status([]), available: false } } })
    await useCodeStudioVCSStore.getState().loadHead('s1', 'main.go')
    expect(fileAtRevision).not.toHaveBeenCalled()
    expect(headKey('s1', 'main.go') in useCodeStudioVCSStore.getState().head).toBe(false)
  })
})

describe('binary detection', () => {
  it('follows Git: a NUL byte in the first 8000 characters', () => {
    expect(isBinaryText('package main\n')).toBe(false)
    expect(isBinaryText('abc\u0000def')).toBe(true)
    expect(isBinaryText(`${'a'.repeat(9000)}\u0000`)).toBe(false)
  })
})
