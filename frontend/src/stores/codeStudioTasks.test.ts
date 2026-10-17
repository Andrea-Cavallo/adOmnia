import { beforeEach, describe, expect, it } from 'vitest'
import { runningGoIDETasks, useCodeStudioTasksStore, withGoIDETask } from './codeStudioTasks'

beforeEach(() => useCodeStudioTasksStore.setState({ tasks: {} }))

describe('Code Studio background tasks', () => {
  it('publishes a running task and completes it in the owning session', async () => {
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    const result = withGoIDETask('session-a', 'architecture', 'Analyzing architecture', async () => { await pending; return 42 })
    expect(runningGoIDETasks(useCodeStudioTasksStore.getState(), 'session-a')).toEqual([{ id: 'architecture', label: 'Analyzing architecture', status: 'running' }])
    expect(runningGoIDETasks(useCodeStudioTasksStore.getState(), 'session-b')).toEqual([])
    release()
    await expect(result).resolves.toBe(42)
    expect(useCodeStudioTasksStore.getState().tasks['session-a'][0].status).toBe('completed')
  })

  it('records a failed task and rethrows the original error', async () => {
    const failure = new Error('analysis failed')
    await expect(withGoIDETask('session-a', 'errors', 'Analyzing errors', async () => { throw failure })).rejects.toBe(failure)
    expect(useCodeStudioTasksStore.getState().tasks['session-a'][0].status).toBe('failed')
  })

  // Il selettore della status bar legge `state.tasks[sessionId]` così com'è:
  // il riferimento deve restare stabile finché quella sessione non cambia,
  // altrimenti Zustand 5 / useSyncExternalStore ri-renderizza all'infinito (React #185).
  it('keeps a session task array referentially stable across unrelated updates', () => {
    useCodeStudioTasksStore.getState().begin('session-a', { id: 'architecture', label: 'Analyzing architecture' })
    const first = useCodeStudioTasksStore.getState().tasks['session-a']
    useCodeStudioTasksStore.getState().begin('session-b', { id: 'errors', label: 'Analyzing errors' })
    expect(useCodeStudioTasksStore.getState().tasks['session-a']).toBe(first)
    useCodeStudioTasksStore.getState().finish('session-b', 'errors', 'completed')
    expect(useCodeStudioTasksStore.getState().tasks['session-a']).toBe(first)
  })
})
