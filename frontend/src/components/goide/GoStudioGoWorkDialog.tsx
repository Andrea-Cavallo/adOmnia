import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Boxes, Loader2, X } from 'lucide-react'
import * as GoIDEBindings from '../../../bindings/adomnia/goide'
import type { GoWorkState } from '../../../bindings/adomnia/internal/goide/models'
import { useModalFocusTrap } from '@/lib/accessibility'

interface GoStudioGoWorkDialogProps {
  open: boolean
  sessionId: string
  onClose: () => void
}

/** Go Workspace (go.work): quali moduli del progetto lavorano insieme; applica con i comandi `go work` ufficiali. */
export function GoStudioGoWorkDialog({ open, sessionId, onClose }: GoStudioGoWorkDialogProps) {
  const [state, setState] = useState<GoWorkState | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalFocusTrap(open, onClose, dialogRef)

  useEffect(() => {
    if (!open) return
    setError(null)
    setState(null)
    GoIDEBindings.GoWorkState(sessionId)
      .then((value) => {
        setState(value)
        // Senza go.work si propone di includere tutti i moduli: è il caso d'uso più comune.
        setSelected(new Set(value.modules.filter((module) => module.inWorkspace || !value.exists).map((module) => module.directory)))
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
  }, [open, sessionId])

  if (!open) return null
  const toggle = (directory: string) => setSelected((current) => {
    const next = new Set(current)
    if (next.has(directory)) next.delete(directory)
    else next.add(directory)
    return next
  })
  const apply = async () => {
    setBusy(true)
    setError(null)
    try {
      await GoIDEBindings.UpdateGoWork(sessionId, [...selected])
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }
  const unchanged = !!state && state.exists && state.modules.every((module) => module.inWorkspace === selected.has(module.directory))

  return (
    <div className="ad-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Go workspace" tabIndex={-1} onClick={(event) => event.stopPropagation()} className="flex max-h-[80vh] w-[min(560px,100%)] flex-col overflow-hidden rounded-2xl border border-border-2 bg-surface-1">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-1 px-4">
          <Boxes size={14} className="text-accent" />
          <h2 className="text-[13px] font-semibold text-text-1">Go Workspace (go.work)</h2>
          {state?.exists && state.goVersion && <span className="font-mono text-[11px] text-text-4">go {state.goVersion}</span>}
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto grid h-7 w-7 place-items-center rounded text-text-3 hover:bg-surface-3"><X size={14} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <p className="mb-3 text-[12px] leading-relaxed text-text-3">
            {state?.exists ? 'Modules checked here are in go.work: gopls, build and tests resolve them from the local folders instead of their published versions.' : 'This project has no go.work. Check the modules that should build together, and Go Studio runs go work init.'}
          </p>
          {!state && !error && <p className="flex items-center gap-2 text-[12px] text-text-4"><Loader2 size={12} className="animate-spin" /> Reading go.work…</p>}
          {state?.modules.length === 0 && <p className="text-[12px] text-text-4">No go.mod found in this project.</p>}
          <ul className="space-y-1">
            {state?.modules.map((module) => (
              <li key={module.directory}>
                <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-2">
                  <input type="checkbox" checked={selected.has(module.directory)} onChange={() => toggle(module.directory)} className="accent-accent" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[12px] text-text-1">{module.modulePath || module.directory}</span>
                    <span className="block truncate font-mono text-[10.5px] text-text-4">./{module.directory === '.' ? '' : module.directory}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {state?.missing && state.missing.length > 0 && (
            <p className="mt-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-2 text-[11px] text-warning">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" /> go.work uses folders without a go.mod: {state.missing.join(', ')}. Remove them from go.work by hand.
            </p>
          )}
          {error && <p role="alert" className="mt-3 rounded-lg border border-danger/30 bg-danger/10 p-2 text-[11px] text-danger">{error}</p>}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border-1 bg-surface-0/60 px-4 py-3">
          <button type="button" onClick={onClose} className="h-8 rounded-lg px-3.5 text-xs text-text-2 hover:bg-surface-3">Cancel</button>
          <button type="button" onClick={() => void apply()} disabled={busy || !state || unchanged || (!state.exists && selected.size === 0)} className="flex h-8 items-center gap-1.5 rounded-lg bg-accent px-4 text-xs font-semibold text-white hover:bg-accent-light disabled:opacity-40">
            {busy && <Loader2 size={12} className="animate-spin" />} {state?.exists ? 'Update go.work' : 'Create go.work'}
          </button>
        </div>
      </div>
    </div>
  )
}
