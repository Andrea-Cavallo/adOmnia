import { create } from 'zustand'

export type CodeStudioAssistantPane = 'copilot' | 'milk' | 'claude' | 'local' | 'pi' | 'a0' | null
/** Chat panes: they live in the side pane and can be detached into their own window. */
export type CodeStudioChatPane = 'copilot' | 'milk' | 'claude' | 'local' | 'pi'
export const isChatPane = (pane: string | null): pane is CodeStudioChatPane => pane === 'copilot' || pane === 'milk' || pane === 'claude' || pane === 'local' || pane === 'pi'

/** Ultimo provider aperto dal bottone AI unico: riapre dove si era rimasti, anche dopo il riavvio. */
export const LAST_PROVIDER_KEY = 'adomnia.codestudio.ai.lastProvider.v1'
export const DEFAULT_PROVIDER: CodeStudioChatPane = 'copilot'

function loadLastProvider(): CodeStudioChatPane {
  try {
    const saved = localStorage.getItem(LAST_PROVIDER_KEY)
    return isChatPane(saved) ? saved : DEFAULT_PROVIDER
  } catch {
    return DEFAULT_PROVIDER
  }
}

interface CodeStudioAssistantState {
  pane: CodeStudioAssistantPane
  /** Testo da mettere nel campo della chat all'apertura (per esempio un report Markdown); la chat lo consuma una volta. */
  draft: string | null
  /** Provider mostrato dall'hub AI e riaperto dal bottone unico della stripe. */
  lastProvider: CodeStudioChatPane
  /** La tab Tasks dell'hub AI resta aperta cambiando provider e rimontando il pannello. */
  tasksOpen: boolean
  open: (pane: Exclude<CodeStudioAssistantPane, null>) => void
  /** Sceglie l'agente senza aprire la chat (Security Center): resta lo stesso del bottone AI. */
  choose: (pane: CodeStudioChatPane) => void
  openWithDraft: (pane: Exclude<CodeStudioAssistantPane, null>, draft: string) => void
  showTasks: () => void
  hideTasks: () => void
  takeDraft: () => string | null
  close: () => void
  toggle: (pane: Exclude<CodeStudioAssistantPane, null>) => void
}

export const useCodeStudioAssistantStore = create<CodeStudioAssistantState>((set, get) => ({
  pane: null,
  draft: null,
  lastProvider: loadLastProvider(),
  tasksOpen: false,
  open: (pane) => set(isChatPane(pane) ? { pane, tasksOpen: false, lastProvider: rememberLastProvider(pane) } : { pane, tasksOpen: false }),
  choose: (pane) => set({ lastProvider: rememberLastProvider(pane) }),
  openWithDraft: (pane, draft) => set(isChatPane(pane) ? { pane, draft, tasksOpen: false, lastProvider: rememberLastProvider(pane) } : { pane, draft, tasksOpen: false }),
  showTasks: () => set({ tasksOpen: true }),
  hideTasks: () => set({ tasksOpen: false }),
  takeDraft: () => {
    const draft = get().draft
    if (draft !== null) set({ draft: null })
    return draft
  },
  // close non tocca lastProvider: riaprire il bottone AI torna sull'ultimo provider.
  close: () => set({ pane: null, tasksOpen: false }),
  toggle: (pane) => set((state) => (state.pane === pane ? { pane: null, tasksOpen: false } : isChatPane(pane) ? { pane, tasksOpen: false, lastProvider: rememberLastProvider(pane) } : { pane, tasksOpen: false })),
}))

/** Registra l'ultimo provider scelto, su disco e nello store. */
function rememberLastProvider(pane: CodeStudioChatPane): CodeStudioChatPane {
  try {
    localStorage.setItem(LAST_PROVIDER_KEY, pane)
  } catch { /* La scelta resta valida per la sessione. */ }
  return pane
}
