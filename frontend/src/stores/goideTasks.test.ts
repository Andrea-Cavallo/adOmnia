import { beforeEach, describe, expect, it } from 'vitest'
import { runningGoIDETasks, useGoIDETasksStore, withGoIDETask } from './goideTasks'

beforeEach(() => useGoIDETasksStore.setState({ tasks: {} }))

describe('Go IDE background tasks', () => {
  it('publishes a running task and completes it in the owning session', async () => {
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    const result = withGoIDETask('session-a', 'architecture', 'Analyzing architecture', async () => { await pending; return 42 })
    expect(runningGoIDETasks(useGoIDETasksStore.getState(), 'session-a')).toEqual([{ id: 'architecture', label: 'Analyzing architecture', status: 'running' }])
    expect(runningGoIDETasks(useGoIDETasksStore.getState(), 'session-b')).toEqual([])
    release()
    await expect(result).resolves.toBe(42)
    expect(useGoIDETasksStore.getState().tasks['session-a'][0].status).toBe('completed')
  })

  it('records a failed task and rethrows the original error', async () => {
    const failure = new Error('analysis failed')
    await expect(withGoIDETask('session-a', 'errors', 'Analyzing errors', async () => { throw failure })).rejects.toBe(failure)
    expect(useGoIDETasksStore.getState().tasks['session-a'][0].status).toBe('failed')
  })
})
