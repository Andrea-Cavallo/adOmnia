import { create } from 'zustand'
import {
  acceptAgentFile,
  acceptAgentHunks,
  acceptAllAgentChanges,
  getAgentReview,
  rejectAgentFile,
  rejectAgentHunks,
  rejectAllAgentChanges,
  subscribeAgentReviewChanges,
  type AgentReview,
  type AgentReviewFile,
} from '@/lib/code-studio-api'
import { acceptHunk, rejectHunk } from '@/lib/code-studio/agentReview'
import type { CodeStudioLineHunk } from '@/lib/code-studio/codeStudioLineDiff'

/** Revisione delle modifiche fatte dagli agenti ACP (milk, Claude Code), per cartella di progetto. */
interface AgentReviewState {
  reviews: Record<string, AgentReview>
  /** Progetto la cui review è aperta nel dialog. */
  dialogRoot: string | null
  /** Operazione in corso: i pulsanti si disattivano per non sovrapporre scritture. */
  busy: boolean
  error: string | null
  load: (root: string) => Promise<void>
  open: (root: string) => void
  close: () => void
  acceptFile: (root: string, file: AgentReviewFile) => Promise<void>
  rejectFile: (root: string, file: AgentReviewFile) => Promise<void>
  acceptAll: (root: string) => Promise<void>
  rejectAll: (root: string) => Promise<void>
  acceptHunk: (root: string, file: AgentReviewFile, hunk: CodeStudioLineHunk) => Promise<void>
  rejectHunk: (root: string, file: AgentReviewFile, hunk: CodeStudioLineHunk) => Promise<void>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

let unsubscribe: (() => void) | null = null

export const useAgentReviewStore = create<AgentReviewState>((set, get) => {
  /** Esegue un'operazione e ricarica sempre la review: anche un errore (file cambiato) deve mostrare lo stato vero. */
  const run = async (root: string, operation: () => Promise<void>) => {
    if (get().busy) return
    set({ busy: true, error: null })
    try {
      await operation()
    } catch (error) {
      set({ error: errorMessage(error) })
    } finally {
      await get().load(root)
      set({ busy: false })
    }
  }

  return {
    reviews: {},
    dialogRoot: null,
    busy: false,
    error: null,

    load: async (root) => {
      if (!root) return
      if (!unsubscribe) unsubscribe = subscribeAgentReviewChanges((changedRoot) => void get().load(changedRoot))
      try {
        const review = await getAgentReview(root)
        set((state) => ({ reviews: { ...state.reviews, [root]: review } }))
      } catch (error) {
        set({ error: errorMessage(error) })
      }
    },
    open: (root) => {
      set({ dialogRoot: root, error: null })
      void get().load(root)
    },
    close: () => set({ dialogRoot: null, error: null }),
    acceptFile: (root, file) => run(root, () => acceptAgentFile(root, file.path)),
    rejectFile: (root, file) => run(root, () => rejectAgentFile(root, file.path)),
    acceptAll: (root) => run(root, () => acceptAllAgentChanges(root)),
    rejectAll: (root) => run(root, () => rejectAllAgentChanges(root)),
    acceptHunk: (root, file, hunk) => run(root, () => acceptAgentHunks(root, file.path, acceptHunk(file.baseline, file.current, hunk))),
    rejectHunk: (root, file, hunk) => run(root, () => rejectAgentHunks(root, file.path, rejectHunk(file.baseline, file.current, hunk), file.current)),
  }
})

const NO_FILES: AgentReviewFile[] = []

/** File in attesa di revisione per un progetto (vuoto se non ce ne sono). Stabile per i selettori zustand. */
export function pendingAgentFiles(state: AgentReviewState, root: string): AgentReviewFile[] {
  return state.reviews[root]?.files ?? NO_FILES
}
