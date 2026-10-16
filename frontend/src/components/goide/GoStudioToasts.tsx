import { CheckCircle2, Info, X } from 'lucide-react'
import { useStudioToastStore } from '@/stores/goideToast'

export function GoStudioToasts() {
  const toasts = useStudioToastStore((state) => state.toasts)
  const dismiss = useStudioToastStore((state) => state.dismiss)
  if (toasts.length === 0) return null
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-8 right-4 z-[9000] flex max-w-[420px] flex-col gap-2">
      {toasts.map((toast) => {
        const Icon = toast.kind === 'success' ? CheckCircle2 : Info
        return (
          <div key={toast.id} className="toast-enter pointer-events-auto flex items-center gap-2 rounded-lg border border-border-2 bg-surface-1/95 px-3 py-2 text-xs text-text-2 shadow-2xl shadow-black/40 backdrop-blur-md">
            <Icon size={14} className={toast.kind === 'success' ? 'shrink-0 text-success' : 'shrink-0 text-accent'} />
            <span className="min-w-0 flex-1 truncate" title={toast.message}>{toast.message}</span>
            <button type="button" aria-label="Dismiss" onClick={() => dismiss(toast.id)} className="grid h-5 w-5 shrink-0 place-items-center rounded text-text-4 hover:bg-surface-2 hover:text-text-1"><X size={11} /></button>
          </div>
        )
      })}
    </div>
  )
}
