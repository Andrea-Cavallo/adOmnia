import { useEffect, useRef, useState } from 'react'
import { AlertCircle, AlertTriangle, Play, Wrench } from 'lucide-react'
import { GoStudioAlert, GoStudioButton, GoStudioCommandPreview, GoStudioField, GoStudioModal } from './GoStudioModal'
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
  const inputRef = useRef<HTMLInputElement>(null)
  const open = !!state

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
    <GoStudioModal
      open={open}
      onClose={onClose}
      top
      size="md"
      icon={Wrench}
      title={<span className="gs-mono text-[14px]">{spec.label}</span>}
      ariaLabel={spec.label}
      subtitle={spec.hint}
      footer={<>
        <GoStudioButton variant="ghost" onClick={onClose}>Cancel</GoStudioButton>
        <GoStudioButton variant="primary" type="submit" form="go-studio-tool-form" icon={Play} loading={running} disabled={!preview}>Run</GoStudioButton>
      </>}
    >
      <form id="go-studio-tool-form" className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void run() }}>
        {spec.targetLabel && (
          <GoStudioField label={spec.targetLabel}>
            <input ref={inputRef} value={target} onChange={(event) => setTarget(event.target.value)} placeholder={spec.placeholder} spellCheck={false} className="gs-input gs-mono" />
          </GoStudioField>
        )}
        <GoStudioCommandPreview command={preview?.command} workingDirectory={preview?.workingDirectory} />
        {preview?.modifiesFiles && <GoStudioAlert tone="warning" icon={AlertTriangle}>This command can change files on disk. Unsaved editors are saved first.</GoStudioAlert>}
        {error && <GoStudioAlert icon={AlertCircle}>{error}</GoStudioAlert>}
      </form>
    </GoStudioModal>
  )
}
