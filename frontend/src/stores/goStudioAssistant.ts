import { create } from 'zustand'

export type GoStudioAssistantPane = 'copilot' | 'a0' | null

interface GoStudioAssistantState {
  pane: GoStudioAssistantPane
  open: (pane: Exclude<GoStudioAssistantPane, null>) => void
  close: () => void
  toggle: (pane: Exclude<GoStudioAssistantPane, null>) => void
}

export const useGoStudioAssistantStore = create<GoStudioAssistantState>((set) => ({
  pane: null,
  open: (pane) => set({ pane }),
  close: () => set({ pane: null }),
  toggle: (pane) => set((state) => ({ pane: state.pane === pane ? null : pane })),
}))
