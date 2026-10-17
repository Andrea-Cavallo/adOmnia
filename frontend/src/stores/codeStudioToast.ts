import { create } from 'zustand'

export type StudioToastKind = 'success' | 'info'

export interface StudioToast {
  id: number
  kind: StudioToastKind
  message: string
}

interface StudioToastState {
  toasts: StudioToast[]
  push: (message: string, kind?: StudioToastKind) => void
  dismiss: (id: number) => void
}

const MAX_TOASTS = 3
const TOAST_MS = 3500
let nextId = 1

/** Feedback breve per le azioni riuscite (gli errori restano nei banner persistenti). */
export const useStudioToastStore = create<StudioToastState>((set, get) => ({
  toasts: [],
  push: (message, kind = 'success') => {
    const id = nextId++
    set((state) => ({ toasts: [...state.toasts, { id, kind, message }].slice(-MAX_TOASTS) }))
    setTimeout(() => get().dismiss(id), TOAST_MS)
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}))

export function studioToast(message: string, kind: StudioToastKind = 'success') {
  useStudioToastStore.getState().push(message, kind)
}
