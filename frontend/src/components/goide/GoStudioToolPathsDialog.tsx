import { useEffect, useState } from 'react'
import { AlertCircle, Wrench } from 'lucide-react'
import { configureGopls, configureLinter } from '@/lib/goide-lsp-api'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { configureGoIDEDelve } from '@/lib/goide-debug-api'
import { configureGoIDEMake, detectGoIDEMake } from '@/lib/goide-api'
import { useGoIDEDebugStore } from '@/stores/goideDebug'
import { GoStudioAlert, GoStudioButton, GoStudioField, GoStudioModal } from './GoStudioModal'

interface GoStudioToolPathsDialogProps {
  open: boolean
  sessionId: string
  onClose: () => void
}

/** Binari personalizzati per gopls, linter e Delve della sessione; vuoto ripristina la ricerca automatica. */
export function GoStudioToolPathsDialog({ open, sessionId, onClose }: GoStudioToolPathsDialogProps) {
  const gopls = useGoIDELspStore((state) => state.gopls[sessionId] ?? null)
  const linter = useGoIDELspStore((state) => state.linter[sessionId] ?? null)
  const [goplsBinary, setGoplsBinary] = useState('')
  const [linterBinary, setLinterBinary] = useState('')
  const delve = useGoIDEDebugStore((state) => state.delve[sessionId] ?? null)
  const [delveBinary, setDelveBinary] = useState('')
  const [makeBinary, setMakeBinary] = useState('')
  const [makeInfo, setMakeInfo] = useState<Awaited<ReturnType<typeof detectGoIDEMake>> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setGoplsBinary(gopls?.source === 'custom' ? gopls.binary ?? '' : '')
    setLinterBinary(linter?.source === 'custom' ? linter.binary ?? '' : '')
    setDelveBinary(delve?.source === 'custom' ? delve.binary ?? '' : '')
    void useGoIDEDebugStore.getState().detectDelve(sessionId)
    void detectGoIDEMake(sessionId).then((info) => {
      setMakeInfo(info)
      setMakeBinary(info.source === 'custom' ? info.binary ?? '' : '')
    }).catch(() => setMakeInfo(null))
    setError(null)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  const apply = async () => {
    setBusy(true)
    setError(null)
    try {
      await configureGopls(sessionId, goplsBinary)
      await configureLinter(sessionId, linterBinary)
      await configureGoIDEDelve(sessionId, delveBinary)
      await configureGoIDEMake(sessionId, makeBinary)
      void useGoIDEDebugStore.getState().detectDelve(sessionId)
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
    <GoStudioModal
      open={open}
      onClose={onClose}
      size="md"
      icon={Wrench}
      title="Tool paths"
      subtitle="Custom binaries for this project. Leave a field empty for automatic detection."
      footerStart="Project linter config files are used, never created."
      footer={<>
        <GoStudioButton variant="ghost" onClick={onClose}>Cancel</GoStudioButton>
        <GoStudioButton variant="primary" loading={busy} onClick={() => void apply()}>Validate & apply</GoStudioButton>
      </>}
    >
      {error && <GoStudioAlert icon={AlertCircle}>{error}</GoStudioAlert>}
      <GoStudioField label="gopls" hint={<span className="gs-mono block truncate">{detected(gopls)}</span>}>
        <input value={goplsBinary} onChange={(event) => setGoplsBinary(event.target.value)} placeholder="Automatic: adOmnia tools, GOPATH/bin, PATH" className="gs-input gs-mono" />
      </GoStudioField>
      <GoStudioField label="Linter (golangci-lint, staticcheck or any go vet-style analyzer)" hint={<span className="gs-mono block truncate">{detected(linter)}{linter?.configPath ? ` · config ${linter.configPath}` : ''}</span>}>
        <input value={linterBinary} onChange={(event) => setLinterBinary(event.target.value)} placeholder="Automatic: golangci-lint, then staticcheck" className="gs-input gs-mono" />
      </GoStudioField>
      <GoStudioField label="Delve (dlv)" hint={<span className="gs-mono block truncate">{detected(delve)}</span>}>
        <input value={delveBinary} onChange={(event) => setDelveBinary(event.target.value)} placeholder="Automatic: adOmnia tools, GOPATH/bin, PATH" className="gs-input gs-mono" />
      </GoStudioField>
      <GoStudioField label="make (Makefile targets)" hint={<span className="gs-mono block truncate" title={makeInfo?.error}>{makeInfo?.available ? `${makeInfo.binary} (${makeInfo.source})` : makeInfo?.error ?? 'Not detected yet'}</span>}>
        <input value={makeBinary} onChange={(event) => setMakeBinary(event.target.value)} placeholder="Automatic: make, gmake, mingw32-make, GnuWin32" className="gs-input gs-mono" />
      </GoStudioField>
    </GoStudioModal>
  )
}
