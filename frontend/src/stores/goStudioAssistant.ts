import { create } from 'zustand'

export type GoStudioAssistantPane = 'copilot' | 'milk' | 'claude' | 'a0' | null
/** Chat panes: they live in the side pane and can be detached into their own window. */
export type GoStudioChatPane = 'copilot' | 'milk' | 'claude'
export const isChatPane = (pane: string | null): pane is GoStudioChatPane => pane === 'copilot' || pane === 'milk' || pane === 'claude'

interface GoStudioAssistantState {
  pane: GoStudioAssistantPane
  /** Testo da mettere nel campo della chat all'apertura (per esempio un report Markdown); la chat lo consuma una volta. */
  draft: string | null
  open: (pane: Exclude<GoStudioAssistantPane, null>) => void
  openWithDraft: (pane: Exclude<GoStudioAssistantPane, null>, draft: string) => void
  takeDraft: () => string | null
  close: () => void
  toggle: (pane: Exclude<GoStudioAssistantPane, null>) => void
}

export const useGoStudioAssistantStore = create<GoStudioAssistantState>((set, get) => ({
  pane: null,
  draft: null,
  open: (pane) => set({ pane }),
  openWithDraft: (pane, draft) => set({ pane, draft }),
  takeDraft: () => {
    const draft = get().draft
    if (draft !== null) set({ draft: null })
    return draft
  },
  close: () => set({ pane: null }),
  toggle: (pane) => set((state) => ({ pane: state.pane === pane ? null : pane })),
}))
