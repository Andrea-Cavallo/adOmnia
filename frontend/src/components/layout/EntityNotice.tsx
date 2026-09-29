import { X } from 'lucide-react'
import { clearEntityNotice, useEntityNotice } from '@/lib/entities/notice'

/** Bottom-centre feedback bar for cross-panel entity actions. */
export function EntityNotice() {
  const notice = useEntityNotice((s) => s.notice)
  if (!notice) return null
  return (
    <div role="status" className="fixed bottom-9 left-1/2 z-[310] flex max-w-[min(640px,calc(100vw-32px))] -translate-x-1/2 items-center gap-3 rounded-md border border-border-2 bg-surface-2 px-3 py-2 text-xs text-text-2 shadow-lg shadow-black/40">
      <span className="min-w-0 flex-1 break-words">{notice.message}</span>
      {notice.action && (
        <button
          type="button"
          onClick={() => { notice.action?.run(); clearEntityNotice() }}
          className="shrink-0 rounded border border-accent/40 bg-accent/12 px-2 py-0.5 text-[11px] font-medium text-accent hover:bg-accent/20 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          {notice.action.label}
        </button>
      )}
      <button type="button" aria-label="Dismiss" onClick={clearEntityNotice} className="shrink-0 text-text-4 hover:text-text-2">
        <X size={12} />
      </button>
    </div>
  )
}
