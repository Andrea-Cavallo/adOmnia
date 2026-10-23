import { beforeEach, describe, expect, it, vi } from 'vitest'

const loadV2 = vi.hoisted(() => vi.fn<(id: string) => Promise<unknown>>())

vi.mock('@/wailsjs/go/main/App', () => ({
  LoadCollectionWorkspaceV2: loadV2,
}))

import {
  invalidatePrefetchedWorkspaces,
  isPrefetchingWorkspace,
  loadWorkspacePayload,
  MAX_PREFETCHED_WORKSPACES,
  peekPrefetchedWorkspace,
  prefetchWorkspace,
  scheduleIdleWorkspacePrefetch,
} from './workspacePrefetch'

const payloadFor = (id: string) => ({
  workspace: { id, name: id.toUpperCase(), tree: [{ id: `${id}-col`, name: 'C', children: [] }] },
  collectionsJson: `[{"id":"${id}-col","name":"C","children":[]}]`,
})

describe('workspace prefetch', () => {
  beforeEach(() => {
    loadV2.mockReset()
    invalidatePrefetchedWorkspaces()
  })

  it('loads one payload and reuses the cache afterwards', async () => {
    loadV2.mockImplementation(async (id) => payloadFor(id))

    const first = await loadWorkspacePayload('ws-a')
    const second = await loadWorkspacePayload('ws-a')

    expect(first.workspace.id).toBe('ws-a')
    expect(second).toBe(first)
    expect(loadV2).toHaveBeenCalledOnce()
    expect(peekPrefetchedWorkspace('ws-a')?.workspace.id).toBe('ws-a')
  })

  it('coalesces concurrent fetches of the same workspace', async () => {
    loadV2.mockImplementation(async (id) => payloadFor(id))
    const [first, second] = await Promise.all([loadWorkspacePayload('ws-a'), loadWorkspacePayload('ws-a')])
    expect(first).toBe(second)
    expect(loadV2).toHaveBeenCalledOnce()
  })

  it('drops cached payloads on invalidation', async () => {
    loadV2.mockImplementation(async (id) => payloadFor(id))
    await loadWorkspacePayload('ws-a')
    invalidatePrefetchedWorkspaces('ws-a')
    expect(peekPrefetchedWorkspace('ws-a')).toBeNull()
    await loadWorkspacePayload('ws-a')
    expect(loadV2).toHaveBeenCalledTimes(2)
  })

  it('bounds the cache to a fixed number of workspaces', async () => {
    loadV2.mockImplementation(async (id) => payloadFor(id))
    for (let index = 0; index < MAX_PREFETCHED_WORKSPACES + 2; index++) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential loads: the cache evicts the oldest entry first
      await loadWorkspacePayload(`ws-${index}`)
    }
    expect(peekPrefetchedWorkspace('ws-0')).toBeNull()
    expect(peekPrefetchedWorkspace(`ws-${MAX_PREFETCHED_WORKSPACES + 1}`)).not.toBeNull()
  })

  it('prefetches without awaiting and reports in-flight work', async () => {
    let release: (value: unknown) => void = () => {}
    loadV2.mockImplementation(() => new Promise((resolve) => { release = resolve }))
    prefetchWorkspace('ws-a')
    expect(isPrefetchingWorkspace('ws-a')).toBe(true)
    release(payloadFor('ws-a'))
    await vi.waitFor(() => expect(peekPrefetchedWorkspace('ws-a')).not.toBeNull())
    expect(isPrefetchingWorkspace('ws-a')).toBe(false)
  })

  it('schedules idle prefetch and survives a failing workspace', async () => {
    loadV2.mockImplementation(async (id) => {
      if (id === 'ws-bad') throw new Error('unavailable')
      return payloadFor(id)
    })
    scheduleIdleWorkspacePrefetch(['ws-a', 'ws-bad'])
    await vi.waitFor(() => expect(peekPrefetchedWorkspace('ws-a')).not.toBeNull())
    expect(peekPrefetchedWorkspace('ws-bad')).toBeNull()
  })
})
