import { useEffect, useState } from 'react'
import { Clipboard as WailsClipboard } from '@wailsio/runtime'
import { AlertCircle, Copy, RefreshCw, ScrollText } from 'lucide-react'
import { getLanguageServerLog } from '@/lib/goide-lsp-api'
import { GoStudioAlert, GoStudioButton, GoStudioModal } from './GoStudioModal'
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

  const refresh = () => {
    if (!sessionId) return
    void getLanguageServerLog(sessionId).then(setLines).catch((error: unknown) => setLines([String(error)]))
  }
  useEffect(() => { if (open) refresh() }, [open, sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  const meta = status && [status.state, status.version, status.pid ? `PID ${status.pid}` : '', status.restarts ? `${status.restarts} restart${status.restarts === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')
  return (
    <GoStudioModal
      open={open}
      onClose={onClose}
      size="xl"
      tall
      divided
      flush
      icon={ScrollText}
      title="gopls log"
      subtitle={meta || 'Language server output for this project'}
      actions={<>
        <GoStudioButton small variant="ghost" className="gs-btn-icon" onClick={refresh} aria-label="Refresh log" title="Refresh"><RefreshCw size={14} /></GoStudioButton>
        <GoStudioButton small variant="ghost" className="gs-btn-icon" onClick={() => void WailsClipboard.SetText(lines.join('\n'))} aria-label="Copy log" title="Copy log"><Copy size={14} /></GoStudioButton>
      </>}
    >
      {status?.error && <div className="border-b border-border-1 p-3"><GoStudioAlert icon={AlertCircle}>{status.error}</GoStudioAlert></div>}
      <pre className="gs-mono min-h-0 flex-1 overflow-auto bg-surface-0 px-5 py-4 text-[11.5px] leading-5 text-text-2">{lines.length ? lines.join('\n') : 'No log lines yet. gopls writes here while it loads packages and reports problems.'}</pre>
    </GoStudioModal>
  )
}
