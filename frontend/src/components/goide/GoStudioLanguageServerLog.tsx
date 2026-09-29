import { useEffect, useRef, useState } from 'react'
import { Clipboard as WailsClipboard } from '@wailsio/runtime'
import { Copy, RefreshCw, X } from 'lucide-react'
import { getLanguageServerLog } from '@/lib/goide-lsp-api'
import { useModalFocusTrap } from '@/lib/accessibility'
import { useGoIDELspStore } from '@/stores/goideLsp'

interface GoStudioLanguageServerLogProps {
  open: boolean
  sessionId: string | null
  onClose: () => void
}

/** Log locale di gopls per la sessione, utile quando il language server non si avvia o si blocca. */
export function GoStudioLanguageServerLog({ open, sessionId, onClose }: GoStudioLanguageServerLogProps) {
  const status = useGoIDELspStore((state) => (sessionId ? state.status[sessionId] : undefined))
  const [lines, setLines] = useState<string[]>([])
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalFocusTrap(open, onClose, dialogRef)

  const refresh = () => {
    if (!sessionId) return
    void getLanguageServerLog(sessionId).then(setLines).catch((error: unknown) => setLines([String(error)]))
  }
  useEffect(() => { if (open) refresh() }, [open, sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center ad-modal-backdrop" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Language server log" tabIndex={-1} className="flex h-[min(520px,80vh)] w-[min(820px,90vw)] flex-col overflow-hidden rounded-xl border border-border-2 bg-surface-1 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-1 px-4">
          <h2 className="text-xs font-semibold text-text-1">gopls log</h2>
          {status && <span className="font-mono text-[10px] text-text-4">{status.state}{status.version ? ` · ${status.version}` : ''}{status.pid ? ` · PID ${status.pid}` : ''}{status.restarts ? ` · ${status.restarts} restart${status.restarts === 1 ? '' : 's'}` : ''}</span>}
          <button type="button" onClick={refresh} title="Refresh" className="ml-auto grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3"><RefreshCw size={11} /></button>
          <button type="button" onClick={() => void WailsClipboard.SetText(lines.join('\n'))} title="Copy log" className="grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3"><Copy size={11} /></button>
          <button type="button" onClick={onClose} title="Close" className="grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3"><X size={12} /></button>
        </div>
        {status?.error && <div className="shrink-0 border-b border-danger/30 bg-danger/10 px-4 py-1.5 text-[10px] text-danger">{status.error}</div>}
        <pre className="min-h-0 flex-1 overflow-auto bg-surface-0 p-3 font-mono text-[10px] leading-4 text-text-2">{lines.length ? lines.join('\n') : 'No log lines yet. gopls writes here while it loads packages and reports problems.'}</pre>
      </div>
    </div>
  )
}
