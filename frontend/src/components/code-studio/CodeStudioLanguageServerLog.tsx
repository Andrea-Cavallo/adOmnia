import { useCallback, useEffect, useState } from 'react'
import { Clipboard as WailsClipboard } from '@wailsio/runtime'
import { AlertCircle, Copy, RefreshCw, ScrollText } from 'lucide-react'
import { getLanguageServerLog } from '@/lib/code-studio-lsp-api'
import { CodeStudioAlert, CodeStudioButton, CodeStudioModal } from './CodeStudioModal'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'

interface CodeStudioLanguageServerLogProps {
  open: boolean
  sessionId: string | null
  onClose: () => void
}

/** Log locale di gopls per la sessione, utile quando il language server non si avvia o si blocca. */
export function CodeStudioLanguageServerLog({ open, sessionId, onClose }: CodeStudioLanguageServerLogProps) {
  const status = useCodeStudioLspStore((state) => (sessionId ? state.status[sessionId] : undefined))
  const [lines, setLines] = useState<string[]>([])

  const refresh = useCallback(() => {
    if (!sessionId) return
    void getLanguageServerLog(sessionId).then(setLines).catch((error: unknown) => setLines([String(error)]))
  }, [sessionId])
  useEffect(() => { if (open) refresh() }, [open, refresh])

  const meta = status && [status.state, status.version, status.pid ? `PID ${status.pid}` : '', status.restarts ? `${status.restarts} restart${status.restarts === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')
  return (
    <CodeStudioModal
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
        <CodeStudioButton small variant="ghost" className="gs-btn-icon" onClick={refresh} aria-label="Refresh log" title="Refresh"><RefreshCw size={14} /></CodeStudioButton>
        <CodeStudioButton small variant="ghost" className="gs-btn-icon" onClick={() => void WailsClipboard.SetText(lines.join('\n'))} aria-label="Copy log" title="Copy log"><Copy size={14} /></CodeStudioButton>
      </>}
    >
      {status?.error && <div className="border-b border-border-1 p-3"><CodeStudioAlert icon={AlertCircle}>{status.error}</CodeStudioAlert></div>}
      <pre className="gs-mono min-h-0 flex-1 overflow-auto bg-surface-0 px-5 py-4 text-[11.5px] leading-5 text-text-2">{lines.length ? lines.join('\n') : 'No log lines yet. gopls writes here while it loads packages and reports problems.'}</pre>
    </CodeStudioModal>
  )
}
