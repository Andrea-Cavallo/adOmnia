import { create } from 'zustand'

export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'default'
}

interface ConfirmState extends ConfirmOptions {
  open: boolean
  resolve: ((ok: boolean) => void) | null
  request: (opts: ConfirmOptions) => Promise<boolean>
  settle: (ok: boolean) => void
}

/**
 * App-native, promise-based confirmation dialog. Replaces window.confirm so
 * destructive actions use a dialog consistent with the rest of the UI.
 *
 * Usage:
 *   if (await confirm({ title: 'Delete?', message: '...', variant: 'danger' })) { ... }
 */
export const useConfirmStore = create<ConfirmState>((set, get) => ({
  open: false,
  title: '',
  message: '',
  confirmLabel: 'Confirm',
  cancelLabel: 'Cancel',
  variant: 'default',
  resolve: null,
  request: (opts) =>
    new Promise<boolean>((resolve) => {
      // If a dialog is already open, reject the previous request as cancelled.
      const prev = get().resolve
      if (prev) prev(false)
      set({
        open: true,
        title: opts.title,
        message: opts.message,
        confirmLabel: opts.confirmLabel ?? 'Confirm',
        cancelLabel: opts.cancelLabel ?? 'Cancel',
        variant: opts.variant ?? 'default',
        resolve,
      })
    }),
  settle: (ok) => {
    const resolve = get().resolve
    set({ open: false, resolve: null })
    if (resolve) resolve(ok)
  },
}))

export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return useConfirmStore.getState().request(opts)
}
