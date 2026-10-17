import { create } from 'zustand'

export type GoIDETaskStatus = 'running' | 'completed' | 'failed'

export interface GoIDETask {
  id: string
  label: string
  status: GoIDETaskStatus
}

interface GoIDETasksState {
  tasks: Record<string, GoIDETask[]>
  begin: (sessionId: string, task: Omit<GoIDETask, 'status'>) => void
  finish: (sessionId: string, id: string, status: Exclude<GoIDETaskStatus, 'running'>) => void
  clear: (sessionId: string) => void
}

const MAX_TASKS_PER_SESSION = 12

export const useCodeStudioTasksStore = create<GoIDETasksState>((set) => ({
  tasks: {},
  begin: (sessionId, task) => set((state) => ({
    tasks: {
      ...state.tasks,
      [sessionId]: [{ ...task, status: 'running' as const }, ...(state.tasks[sessionId] ?? []).filter((item) => item.id !== task.id)].slice(0, MAX_TASKS_PER_SESSION),
    },
  })),
  finish: (sessionId, id, status) => set((state) => ({
    tasks: {
      ...state.tasks,
      [sessionId]: (state.tasks[sessionId] ?? []).map((task) => task.id === id ? { ...task, status } : task),
    },
  })),
  clear: (sessionId) => set((state) => {
    const tasks = { ...state.tasks }
    delete tasks[sessionId]
    return { tasks }
  }),
}))

export function runningGoIDETasks(state: Pick<GoIDETasksState, 'tasks'>, sessionId: string): GoIDETask[] {
  return (state.tasks[sessionId] ?? []).filter((task) => task.status === 'running')
}

export async function withGoIDETask<T>(sessionId: string, id: string, label: string, action: () => Promise<T>): Promise<T> {
  const tasks = useCodeStudioTasksStore.getState()
  tasks.begin(sessionId, { id, label })
  try {
    const result = await action()
    useCodeStudioTasksStore.getState().finish(sessionId, id, 'completed')
    return result
  } catch (error) {
    useCodeStudioTasksStore.getState().finish(sessionId, id, 'failed')
    throw error
  }
}
