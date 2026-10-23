import { useEffect, useState } from 'react'
import { AlertCircle, AlertTriangle, Boxes, Loader2 } from 'lucide-react'
import * as GoIDEBindings from '../../../bindings/adomnia/goide'
import type { GoWorkState } from '../../../bindings/adomnia/internal/codestudio/models'
import { CodeStudioAlert, CodeStudioButton, CodeStudioModal } from './CodeStudioModal'

interface CodeStudioGoWorkDialogProps {
  open: boolean
  sessionId: string
  onClose: () => void
}

/** Go Workspace (go.work): quali moduli del progetto lavorano insieme; applica con i comandi `go work` ufficiali. */
export function CodeStudioGoWorkDialog({ open, sessionId, onClose }: CodeStudioGoWorkDialogProps) {
  const [state, setState] = useState<GoWorkState | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    <CodeStudioModal
      open={open}
      onClose={onClose}
      size="md"
      divided
      icon={Boxes}
      title="Go workspace (go.work)"
      subtitle={state?.exists ? <>Checked modules build together from their local folders{state.goVersion ? <> · <span className="gs-mono">go {state.goVersion}</span></> : null}.</> : 'No go.work yet. Check the modules that should build together.'}
      footer={<>
        <CodeStudioButton variant="ghost" onClick={onClose}>Cancel</CodeStudioButton>
        <CodeStudioButton variant="primary" loading={busy} disabled={!state || unchanged || (!state.exists && selected.size === 0)} onClick={() => void apply()}>{state?.exists ? 'Update go.work' : 'Create go.work'}</CodeStudioButton>
      </>}
    >
      {!state && !error && <p className="gs-list-empty flex items-center justify-center gap-2"><Loader2 size={13} className="animate-spin" /> Reading go.work…</p>}
      {state?.modules.length === 0 && <p className="gs-surface gs-list-empty">No go.mod found in this project.</p>}
      {state && state.modules.length > 0 && (
        <div className="gs-list">
          {state.modules.map((module) => (
            <label key={module.directory} htmlFor={`gowork-module-${module.directory}`} className="gs-list-row cursor-pointer">
              <input id={`gowork-module-${module.directory}`} type="checkbox" checked={selected.has(module.directory)} onChange={() => toggle(module.directory)} className="h-[15px] w-[15px] accent-[var(--color-accent)]" />
              <span className="min-w-0 flex-1">
                <span className="gs-mono block truncate text-text-1">{module.modulePath || module.directory}</span>
                <span className="gs-mono block truncate text-[11px] text-text-4">./{module.directory === '.' ? '' : module.directory}</span>
              </span>
            </label>
          ))}
        </div>
      )}
      {state?.missing && state.missing.length > 0 && <CodeStudioAlert tone="warning" icon={AlertTriangle}>go.work uses folders without a go.mod: <span className="gs-mono">{state.missing.join(', ')}</span>. Remove them from go.work by hand.</CodeStudioAlert>}
      {error && <CodeStudioAlert icon={AlertCircle}>{error}</CodeStudioAlert>}
    </CodeStudioModal>
  )
}
