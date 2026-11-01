import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContextReceipt, Intent, Status, Task } from '@/lib/agent-task-api'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  export: vi.fn(),
  createWorkspace: vi.fn(),
  removeWorkspace: vi.fn(),
  reconcile: vi.fn(),
  addVerification: vi.fn(),
  removeVerification: vi.fn(),
  startVerifications: vi.fn(),
  startCorrection: vi.fn(),
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
    createAgentTaskWorkspace: mocks.createWorkspace,
    removeAgentTaskWorkspace: mocks.removeWorkspace,
    reconcileAgentTaskWorkspaces: mocks.reconcile,
    addAgentTaskVerification: mocks.addVerification,
    removeAgentTaskVerification: mocks.removeVerification,
    startAgentTaskVerifications: mocks.startVerifications,
    startAgentTaskCorrection: mocks.startCorrection,
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
  it('runs workspace and verification actions against the task root and reports failures', async () => {
    const existing = task('one', '2026-01-01T00:00:00Z')
    useAgentTaskStore.setState({ tasksByRoot: { '/project': [existing] }, selectedByRoot: { '/project': 'one' }, busyById: {}, errorByRoot: {} })
    const withWorkspace = new Task({ ...existing, workspace: { repository: '/project', path: '/worktrees/one', branch: 'adomnia/one', baseRef: 'HEAD', state: 'ready', createdAt: '2026-01-01T00:00:00Z' } as never })
    mocks.createWorkspace.mockResolvedValue(withWorkspace)
    const created = await useAgentTaskStore.getState().createWorkspace('one', 'HEAD')
    expect(mocks.createWorkspace).toHaveBeenCalledWith('one', 'HEAD', false)
    expect(created.workspace?.path).toBe('/worktrees/one')
    expect(useAgentTaskStore.getState().tasksByRoot['/project'][0].workspace?.path).toBe('/worktrees/one')

    mocks.startCorrection.mockRejectedValue(new Error('the task is already active'))
    await expect(useAgentTaskStore.getState().askCorrection('one', ['evidence-1'], 'fix it')).rejects.toThrow('the task is already active')
    expect(useAgentTaskStore.getState().errorByRoot['/project']).toBe('the task is already active')
    expect(useAgentTaskStore.getState().busyById['one']).toBe(false)
  })
  it('applies reconciled workspaces to the matching project only', async () => {
    const existing = task('one', '2026-01-01T00:00:00Z')
    useAgentTaskStore.setState({ tasksByRoot: { '/project': [existing] }, selectedByRoot: {}, busyById: {}, errorByRoot: {} })
    const missing = new Task({ ...existing, updatedAt: '2026-01-02T00:00:00Z', workspace: { repository: '/project', path: '/worktrees/one', branch: 'adomnia/one', baseRef: 'HEAD', state: 'missing', notice: 'gone', createdAt: '2026-01-01T00:00:00Z' } as never })
    mocks.reconcile.mockResolvedValue([missing, { ...missing, id: 'other', root: '/elsewhere' }])
    await useAgentTaskStore.getState().reconcile('/project')
    expect(useAgentTaskStore.getState().tasksByRoot['/project'][0].workspace?.state).toBe('missing')
    expect(useAgentTaskStore.getState().tasksByRoot['/elsewhere']).toBeUndefined()
  })
})
