import { create } from 'zustand'

export type GoStudioAssistantPane = 'copilot' | 'milk' | 'claude' | 'opencode' | 'a0' | null
/** Chat panes: they live in the side pane and can be detached into their own window. */
export type GoStudioChatPane = 'copilot' | 'milk' | 'claude' | 'opencode'
export const isChatPane = (pane: string | null): pane is GoStudioChatPane => pane === 'copilot' || pane === 'milk' || pane === 'claude' || pane === 'opencode'

/** Ultimo provider aperto dal bottone AI unico: riapre dove si era rimasti, anche dopo il riavvio. */
export const LAST_PROVIDER_KEY = 'adomnia.goide.ai.lastProvider.v1'
export const DEFAULT_PROVIDER: GoStudioChatPane = 'copilot'

function loadLastProvider(): GoStudioChatPane {
  try {
    const saved = localStorage.getItem(LAST_PROVIDER_KEY)
    return isChatPane(saved) ? saved : DEFAULT_PROVIDER
  } catch {
    return DEFAULT_PROVIDER
  }
}

interface GoStudioAssistantState {
  pane: GoStudioAssistantPane
  /** Testo da mettere nel campo della chat all'apertura (per esempio un report Markdown); la chat lo consuma una volta. */
  draft: string | null
  /** Provider mostrato dall'hub AI e riaperto dal bottone unico della stripe. */
  lastProvider: GoStudioChatPane
  open: (pane: Exclude<GoStudioAssistantPane, null>) => void
  openWithDraft: (pane: Exclude<GoStudioAssistantPane, null>, draft: string) => void
  takeDraft: () => string | null
  close: () => void
  toggle: (pane: Exclude<GoStudioAssistantPane, null>) => void
}

export const useGoStudioAssistantStore = create<GoStudioAssistantState>((set, get) => ({
  pane: null,
  draft: null,
  lastProvider: loadLastProvider(),
  open: (pane) => set(isChatPane(pane) ? { pane, lastProvider: rememberLastProvider(pane) } : { pane }),
  openWithDraft: (pane, draft) => set(isChatPane(pane) ? { pane, draft, lastProvider: rememberLastProvider(pane) } : { pane, draft }),
  takeDraft: () => {
    const draft = get().draft
    if (draft !== null) set({ draft: null })
    return draft
  },
  // close non tocca lastProvider: riaprire il bottone AI torna sull'ultimo provider.
  close: () => set({ pane: null }),
  toggle: (pane) => set((state) => (state.pane === pane ? { pane: null } : isChatPane(pane) ? { pane, lastProvider: rememberLastProvider(pane) } : { pane })),
}))

/** Registra l'ultimo provider scelto, su disco e nello store. */
function rememberLastProvider(pane: GoStudioChatPane): GoStudioChatPane {
  try {
    localStorage.setItem(LAST_PROVIDER_KEY, pane)
  } catch { /* La scelta resta valida per la sessione. */ }
  return pane
}
