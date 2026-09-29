import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Loader2, Play, X } from 'lucide-react'
import { useModalFocusTrap } from '@/lib/accessibility'
import { previewGoIDETool, startGoIDETool, type GoIDEGoTool, type GoIDEGoToolPreview } from '@/lib/goide-api'
import { useGoIDEStore } from '@/stores/goide'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { GO_STUDIO_GO_TOOLS } from './goStudioGoTools'

const PREVIEW_DEBOUNCE_MS = 200

export interface GoStudioGoToolDialogState {
  tool: GoIDEGoTool
  target: string
  workingDirectory: string
}

interface GoStudioGoToolDialogProps {
  sessionId: string
  state: GoStudioGoToolDialogState | null
  onClose: () => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Go Tools: mostra il comando esatto prima di eseguirlo; l'output va nella Run console con Stop e cleanup. */
export function GoStudioGoToolDialog({ sessionId, state, onClose }: GoStudioGoToolDialogProps) {
  const [target, setTarget] = useState('')
  const [preview, setPreview] = useState<GoIDEGoToolPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const open = !!state
  useModalFocusTrap(open, onClose, dialogRef)

  useEffect(() => {
    if (!state) return
    setTarget(state.target)
    setRunning(false)
    const timer = window.setTimeout(() => inputRef.current?.select(), 30)
    return () => window.clearTimeout(timer)
  }, [state])

  useEffect(() => {
    if (!state) return
    const timer = window.setTimeout(() => {
      previewGoIDETool({ sessionId, tool: state.tool, target, workingDirectory: state.workingDirectory })
        .then((result) => { setPreview(result); setError(null) })
        .catch((reason: unknown) => { setPreview(null); setError(errorMessage(reason)) })
    }, PREVIEW_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [sessionId, state, target])

  if (!state) return null
  const spec = GO_STUDIO_GO_TOOLS[state.tool]

  const run = async () => {
    if (!preview || running) return
    setRunning(true)
    try {
      // Comandi che riscrivono i sorgenti partono dai file salvati, non da buffer diversi dal disco.
      if (preview.modifiesFiles && !await useGoIDEStore.getState().saveAllDocuments(sessionId)) return setRunning(false)
      await startGoIDETool({ sessionId, tool: state.tool, target, workingDirectory: state.workingDirectory })
      useGoIDEStore.getState().updateLayout({ bottomOpen: true })
      useGoIDELspStore.getState().showToolWindow('run')
      onClose()
    } catch (reason) {
      setError(errorMessage(reason))
      setRunning(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh] ad-modal-backdrop" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={spec.label} tabIndex={-1} className="w-[min(560px,90vw)] overflow-hidden rounded-xl border border-border-2 bg-surface-1 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-10 items-center gap-2 border-b border-border-1 px-4"><h2 className="font-mono text-xs font-semibold text-text-1">{spec.label}</h2><span className="truncate text-[10px] text-text-4">{spec.hint}</span><button type="button" onClick={onClose} title="Close" className="ml-auto grid h-6 w-6 shrink-0 place-items-center rounded text-text-3 hover:bg-surface-3"><X size={12} /></button></div>
        <form className="space-y-3 p-4" onSubmit={(event) => { event.preventDefault(); void run() }}>
          {spec.targetLabel && (
            <label className="block text-[10px] font-medium text-text-3">{spec.targetLabel}
              <input ref={inputRef} value={target} onChange={(event) => setTarget(event.target.value)} placeholder={spec.placeholder} spellCheck={false} className="mt-1 h-8 w-full rounded border border-border-1 bg-surface-0 px-2 font-mono text-[11px] text-text-1 outline-none focus:border-accent" />
            </label>
          )}
          <div className="rounded border border-border-1 bg-surface-0 px-2 py-1.5 font-mono text-[10px] leading-4">
            <div className="text-text-4">Command</div>
            <div className="break-all text-text-1">{preview?.command ?? '—'}</div>
            <div className="mt-1 text-text-4">Working directory</div>
            <div className="break-all text-text-2">{preview?.workingDirectory ?? '—'}</div>
          </div>
          {preview?.modifiesFiles && <p className="flex items-center gap-1.5 text-[10px] text-warning"><AlertTriangle size={11} /> This command can change files on disk. Unsaved editors are saved first.</p>}
          {error && <p role="alert" className="text-[10px] text-danger">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} className="h-7 rounded px-3 text-xs text-text-3 hover:bg-surface-2">Cancel</button>
            <button type="submit" disabled={!preview || running} className="flex h-7 items-center gap-1.5 rounded bg-accent px-3 text-xs font-semibold text-white disabled:opacity-40">{running ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />} Run</button>
          </div>
        </form>
      </div>
    </div>
  )
}
