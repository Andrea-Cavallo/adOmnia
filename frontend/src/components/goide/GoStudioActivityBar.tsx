import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2, RefreshCw, ScrollText, X } from 'lucide-react'
import type { GoIDESession } from '@/lib/goide-api'
import { useGoIDELspStore } from '@/stores/goideLsp'

const STATE_LABELS: Record<string, string> = {
  stopped: 'gopls stopped',
  starting: 'Starting gopls…',
  ready: 'gopls ready',
  crashed: 'gopls crashed',
  unavailable: 'gopls unavailable',
}

/**
 * Attività in basso a destra: mostra sempre che gopls sta partendo, indicizzando o è caduto,
 * con la possibilità di forzare il riavvio. Senza questo, un reload lento sembra non fare nulla.
 */
export function GoStudioActivityBar({ session, onOpenLog }: { session: GoIDESession; onOpenLog: () => void }) {
  const status = useGoIDELspStore((state) => state.status[session.id])
  const progress = useGoIDELspStore((state) => state.progress[session.id] ?? null)
  const activity = useGoIDELspStore((state) => state.activity[session.id] ?? null)
  const dismiss = useGoIDELspStore((state) => state.dismissActivity)
  const restart = useGoIDELspStore((state) => state.restart)
  const [now, setNow] = useState(() => Date.now())

  const state = status?.state ?? 'stopped'
  const busy = state === 'starting' || !!progress
  const visible = !!activity || busy
  const startedAt = activity?.startedAt ?? 0

  useEffect(() => {
    if (!visible) return
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [visible])

  if (!visible) return null

  const isError = activity?.error === true || state === 'crashed'
  const label = activity?.label ?? progress?.title ?? STATE_LABELS[state] ?? 'gopls'
  const detail = activity?.detail || progress?.message || (isError ? status?.error : '')
  const percent = progress?.percentage
  const seconds = startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0

  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-auto fixed bottom-9 right-4 z-40 w-80 max-w-[calc(100vw-2rem)] rounded-lg border bg-surface-1/95 px-3 py-2 text-[11.5px] shadow-2xl shadow-black/30 backdrop-blur-md toast-enter ${isError ? 'border-danger/40' : 'border-border-1'}`}
    >
      <div className="flex items-start gap-2">
        {isError ? <AlertTriangle size={14} className="mt-0.5 shrink-0 text-danger" /> : <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin text-accent" />}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-text-1" title={label}>{label}{!isError && seconds >= 2 ? ` · ${seconds}s` : ''}</p>
          {detail && <p className="mt-0.5 line-clamp-2 text-text-3" title={detail}>{detail}</p>}
          {typeof percent === 'number' && (
            <span className="mt-1 block h-1 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
              <span className="block h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.max(2, Math.min(100, percent))}%` }} />
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button type="button" onClick={onOpenLog} title="Language server log" aria-label="Language server log" className="grid h-6 w-6 place-items-center rounded text-text-4 hover:bg-surface-3 hover:text-text-1"><ScrollText size={12} /></button>
          <button type="button" onClick={() => void restart(session.id)} title="Force reload gopls" aria-label="Force reload gopls" className="grid h-6 w-6 place-items-center rounded text-text-4 hover:bg-surface-3 hover:text-accent"><RefreshCw size={12} /></button>
          <button type="button" onClick={() => dismiss(session.id)} title="Dismiss" aria-label="Dismiss" className="grid h-6 w-6 place-items-center rounded text-text-4 hover:bg-surface-3 hover:text-text-1"><X size={12} /></button>
        </div>
      </div>
    </div>
  )
}
