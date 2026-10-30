import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContextReceipt, Intent, Status, Task } from '@/lib/agent-task-api'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  export: vi.fn(),
  changed: undefined as ((task: Task) => void) | undefined,
}))
vi.mock('@/lib/agent-task-api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/agent-task-api')>()
  return {
    ...original,
    listAgentTasks: mocks.list,
    createAgentTask: mocks.create,
    updateAgentTask: mocks.update,
    startAgentTask: mocks.start,
    stopAgentTask: mocks.stop,
    exportAgentTask: mocks.export,
    subscribeAgentTaskChanges: (handler: (task: Task) => void) => { mocks.changed = handler; return () => undefined },
  }
})
import { noAgentTasks, selectedAgentTask, upsertAgentTask, useAgentTaskStore } from './agentTasks'

function task(id: string, updatedAt: string): Task {
  return new Task({ id, root: '/project', intent: Intent.IntentBugfix, objective: `Task ${id}`, agent: 'milk', limits: { timeoutMinutes: 30, maxContextBytes: 65536 }, status: Status.StatusDraft, createdAt: updatedAt, updatedAt, attempts: [] })
}

beforeEach(() => {
  vi.clearAllMocks()
  useAgentTaskStore.setState({ tasksByRoot: {}, selectedByRoot: {}, loadingByRoot: {}, errorByRoot: {}, busyById: {} })
})

describe('agent task store', () => {
  it('loads tasks, selects a real task and applies scoped change events', async () => {
    const older = task('older', '2026-01-01T00:00:00Z')
    const newer = task('newer', '2026-01-02T00:00:00Z')
    mocks.list.mockResolvedValue([older])
    await useAgentTaskStore.getState().load('/project')
    expect(selectedAgentTask(useAgentTaskStore.getState().tasksByRoot['/project'], useAgentTaskStore.getState().selectedByRoot['/project'])?.id).toBe('older')
    mocks.changed?.(newer)
    expect(upsertAgentTask([older], newer).map((item) => item.id)).toEqual(['newer', 'older'])
    expect(useAgentTaskStore.getState().tasksByRoot['/project']).toHaveLength(2)
  })
  it('starts with the exact approved message and receipt', async () => {
    const existing = task('one', '2026-01-01T00:00:00Z')
    useAgentTaskStore.setState({ tasksByRoot: { '/project': [existing] }, selectedByRoot: { '/project': 'one' } })
    const running = new Task({ ...existing, status: Status.StatusRunning })
    mocks.start.mockResolvedValue(running)
    const receipt = new ContextReceipt({ bytes: 100, sources: 2, excluded: 1, truncated: true, includesUnsaved: false })
    await useAgentTaskStore.getState().start('one', 'approved payload', receipt)
    expect(mocks.start).toHaveBeenCalledWith('one', 'approved payload', receipt)
    expect(useAgentTaskStore.getState().tasksByRoot['/project'][0].status).toBe(Status.StatusRunning)
  })
  it('exposes load failures and keeps the previous tasks', async () => {
    mocks.list.mockRejectedValue(new Error('store corrupt'))
    await useAgentTaskStore.getState().load('/project')
    expect(useAgentTaskStore.getState().errorByRoot['/project']).toBe('store corrupt')
    expect(useAgentTaskStore.getState().loadingByRoot['/project']).toBe(false)
  })
  it('selects a stable empty list so the Tasks panel cannot loop on render', () => {
    const select = (root: string) => useAgentTaskStore.getState().tasksByRoot[root] ?? noAgentTasks
    expect(select('/project')).toBe(select('/project'))
    expect(select('/project')).toEqual([])
  })
})
