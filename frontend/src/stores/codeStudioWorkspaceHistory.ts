import { create } from 'zustand'
import { emptyWorkspaceHistory, moveWorkspaceHistory, recordWorkspaceChange, type WorkspaceHistory, type WorkspaceHistoryEntry } from '@/lib/code-studio/workspaceHistory'

interface WorkspaceHistoryState {
  sessions: Record<string, WorkspaceHistory>
  record: (sessionId: string, entry: WorkspaceHistoryEntry) => void
  move: (sessionId: string, redo: boolean) => void
  clear: (sessionId: string) => void
}

export const useWorkspaceHistory = create<WorkspaceHistoryState>((set) => ({
  sessions: {},
  record: (sessionId, entry) => set(state => ({ sessions: { ...state.sessions, [sessionId]: recordWorkspaceChange(state.sessions[sessionId] ?? emptyWorkspaceHistory(), entry) } })),
  move: (sessionId, redo) => set(state => ({ sessions: { ...state.sessions, [sessionId]: moveWorkspaceHistory(state.sessions[sessionId] ?? emptyWorkspaceHistory(), redo) } })),
  clear: (sessionId) => set(state => {
    const sessions = { ...state.sessions }
    delete sessions[sessionId]
    return { sessions }
  }),
}))
