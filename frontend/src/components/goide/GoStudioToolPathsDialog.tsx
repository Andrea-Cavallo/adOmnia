import { useEffect, useRef, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { configureGopls, configureLinter } from '@/lib/goide-lsp-api'
import { useModalFocusTrap } from '@/lib/accessibility'
import { useGoIDELspStore } from '@/stores/goideLsp'

interface GoStudioToolPathsDialogProps {
  open: boolean
  sessionId: string
  onClose: () => void
}

/** Binari personalizzati per gopls e linter della sessione; vuoto ripristina la ricerca automatica. */
export function GoStudioToolPathsDialog({ open, sessionId, onClose }: GoStudioToolPathsDialogProps) {
  const gopls = useGoIDELspStore((state) => state.gopls[sessionId] ?? null)
  const linter = useGoIDELspStore((state) => state.linter[sessionId] ?? null)
  const [goplsBinary, setGoplsBinary] = useState('')
  const [linterBinary, setLinterBinary] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalFocusTrap(open, onClose, dialogRef)

  useEffect(() => {
    if (!open) return
    setGoplsBinary(gopls?.source === 'custom' ? gopls.binary ?? '' : '')
    setLinterBinary(linter?.source === 'custom' ? linter.binary ?? '' : '')
    setError(null)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  const apply = async () => {
    setBusy(true)
    setError(null)
    try {
      await configureGopls(sessionId, goplsBinary)
      await configureLinter(sessionId, linterBinary)
      const lsp = useGoIDELspStore.getState()
      const [goplsInfo] = await Promise.all([lsp.detectGopls(sessionId), lsp.detectLinter(sessionId)])
      if (goplsInfo?.available && lsp.status[sessionId]?.state === 'ready') await lsp.restart(sessionId)
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const detected = (info: { available: boolean; binary?: string; version?: string; source?: string; error?: string } | null) =>
    info?.available ? `${info.binary} · ${info.version} (${info.source})` : info?.error ?? 'Not detected yet'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-[2px]" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Tool paths" tabIndex={-1} className="w-[560px] overflow-hidden rounded-xl border border-border-2 bg-surface-1 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-10 items-center border-b border-border-1 px-4"><h2 className="text-xs font-semibold text-text-1">Tool paths</h2><button type="button" onClick={onClose} title="Close" className="ml-auto grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3"><X size={12} /></button></div>
        <div className="space-y-4 p-4">
          {error && <div role="alert" className="rounded border border-danger/30 bg-danger/10 p-2 text-[10px] text-danger">{error}</div>}
          <label className="block text-[10px] font-medium text-text-3">gopls binary
            <input value={goplsBinary} onChange={(event) => setGoplsBinary(event.target.value)} placeholder="Automatic: adOmnia tools, GOPATH/bin, PATH" className="mt-1 h-8 w-full rounded border border-border-1 bg-surface-0 px-2 font-mono text-[11px] text-text-1 outline-none focus:border-accent" />
            <span className="mt-1 block truncate font-mono text-[9px] text-text-4">{detected(gopls)}</span>
          </label>
          <label className="block text-[10px] font-medium text-text-3">Linter binary (golangci-lint or staticcheck)
            <input value={linterBinary} onChange={(event) => setLinterBinary(event.target.value)} placeholder="Automatic: golangci-lint, then staticcheck" className="mt-1 h-8 w-full rounded border border-border-1 bg-surface-0 px-2 font-mono text-[11px] text-text-1 outline-none focus:border-accent" />
            <span className="mt-1 block truncate font-mono text-[9px] text-text-4">{detected(linter)}{linter?.configPath ? ` · config ${linter.configPath}` : ''}</span>
          </label>
          <p className="text-[9px] leading-4 text-text-4">Paths apply to this project session only. Project linter configuration files are used when present and never created by adOmnia.</p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border-1 bg-surface-0 px-4 py-3"><button type="button" onClick={onClose} className="h-7 rounded px-3 text-xs text-text-3 hover:bg-surface-2">Cancel</button><button type="button" disabled={busy} onClick={() => void apply()} className="flex h-7 items-center gap-1.5 rounded bg-accent px-3 text-xs font-semibold text-white disabled:opacity-40">{busy && <Loader2 size={11} className="animate-spin" />} Validate & apply</button></div>
      </div>
    </div>
  )
}
