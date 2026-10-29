import { create } from 'zustand'
import {
  createAgentTask,
  exportAgentTask,
  listAgentTasks,
  startAgentTask,
  stopAgentTask,
  subscribeAgentTaskChanges,
  updateAgentTask,
  type AgentTask,
  type AgentTaskDraft,
  type ContextReceipt,
} from '@/lib/agent-task-api'

interface AgentTaskState {
  tasksByRoot: Record<string, AgentTask[]>
  selectedByRoot: Record<string, string>
  loadingByRoot: Record<string, boolean>
  errorByRoot: Record<string, string>
  busyById: Record<string, boolean>
  load: (root: string) => Promise<void>
  select: (root: string, id: string) => void
  create: (draft: AgentTaskDraft) => Promise<AgentTask>
  update: (id: string, draft: AgentTaskDraft) => Promise<AgentTask>
  start: (id: string, message: string, receipt: ContextReceipt) => Promise<AgentTask>
  stop: (id: string) => Promise<AgentTask>
  export: (id: string) => Promise<string>
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)
let unsubscribe: (() => void) | null = null

/** Stable empty list: returning a fresh `[]` from a selector makes React loop (error #185). */
export const noAgentTasks: AgentTask[] = []

export function upsertAgentTask(tasks: AgentTask[], task: AgentTask): AgentTask[] {
  return [...tasks.filter((item) => item.id !== task.id), task]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export function selectedAgentTask(tasks: AgentTask[], selectedId: string | undefined): AgentTask | null {
  return tasks.find((task) => task.id === selectedId) ?? tasks[0] ?? null
}

export const useAgentTaskStore = create<AgentTaskState>((set, get) => {
  const upsert = (task: AgentTask) => set((state) => {
    const tasks = upsertAgentTask(state.tasksByRoot[task.root] ?? [], task)
    return {
      tasksByRoot: { ...state.tasksByRoot, [task.root]: tasks },
      selectedByRoot: { ...state.selectedByRoot, [task.root]: state.selectedByRoot[task.root] || task.id },
    }
  })

  const run = async (id: string, root: string, action: () => Promise<AgentTask>): Promise<AgentTask> => {
    set((state) => ({ busyById: { ...state.busyById, [id]: true }, errorByRoot: { ...state.errorByRoot, [root]: '' } }))
    try {
      const task = await action()
      upsert(task)
      return task
    } catch (error) {
      set((state) => ({ errorByRoot: { ...state.errorByRoot, [root]: errorMessage(error) } }))
      throw error
    } finally {
      set((state) => ({ busyById: { ...state.busyById, [id]: false } }))
    }
  }

  return {
    tasksByRoot: {},
    selectedByRoot: {},
    loadingByRoot: {},
    errorByRoot: {},
    busyById: {},
    load: async (root) => {
      if (!root) return
      if (!unsubscribe) unsubscribe = subscribeAgentTaskChanges(upsert)
      set((state) => ({ loadingByRoot: { ...state.loadingByRoot, [root]: true }, errorByRoot: { ...state.errorByRoot, [root]: '' } }))
      try {
        const tasks = await listAgentTasks(root)
        set((state) => ({
          tasksByRoot: { ...state.tasksByRoot, [root]: tasks },
          selectedByRoot: { ...state.selectedByRoot, [root]: tasks.some((task) => task.id === state.selectedByRoot[root]) ? state.selectedByRoot[root] : tasks[0]?.id ?? '' },
        }))
      } catch (error) {
        set((state) => ({ errorByRoot: { ...state.errorByRoot, [root]: errorMessage(error) } }))
      } finally {
        set((state) => ({ loadingByRoot: { ...state.loadingByRoot, [root]: false } }))
      }
    },
    select: (root, id) => set((state) => ({ selectedByRoot: { ...state.selectedByRoot, [root]: id } })),
    create: async (draft) => {
      const task = await run('new', draft.root, () => createAgentTask(draft))
      set((state) => ({ selectedByRoot: { ...state.selectedByRoot, [draft.root]: task.id } }))
      return task
    },
    update: (id, draft) => run(id, draft.root, () => updateAgentTask(id, draft)),
    start: (id, message, receipt) => {
      const task = Object.values(get().tasksByRoot).flat().find((item) => item.id === id)
      return run(id, task?.root ?? '', () => startAgentTask(id, message, receipt))
    },
    stop: (id) => {
      const task = Object.values(get().tasksByRoot).flat().find((item) => item.id === id)
      return run(id, task?.root ?? '', () => stopAgentTask(id))
    },
    export: async (id) => {
      const task = Object.values(get().tasksByRoot).flat().find((item) => item.id === id)
      const root = task?.root ?? ''
      set((state) => ({ busyById: { ...state.busyById, [id]: true }, errorByRoot: { ...state.errorByRoot, [root]: '' } }))
      try {
        return await exportAgentTask(id)
      } catch (error) {
        set((state) => ({ errorByRoot: { ...state.errorByRoot, [root]: errorMessage(error) } }))
        throw error
      } finally {
        set((state) => ({ busyById: { ...state.busyById, [id]: false } }))
      }
    },
  }
})
