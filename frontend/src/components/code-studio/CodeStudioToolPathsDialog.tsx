import { useEffect, useState } from 'react'
import { AlertCircle, Wrench } from 'lucide-react'
import { configureGopls, configureLinter } from '@/lib/code-studio-lsp-api'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { configureGoIDEDelve } from '@/lib/code-studio-debug-api'
import { configureGoIDEMake, detectGoIDEMake } from '@/lib/code-studio-api'
import { useCodeStudioDebugStore } from '@/stores/codeStudioDebug'
import { CodeStudioAlert, CodeStudioButton, CodeStudioField, CodeStudioModal } from './CodeStudioModal'

interface CodeStudioToolPathsDialogProps {
  open: boolean
  sessionId: string
  onClose: () => void
}

/** Binari personalizzati per gopls, linter e Delve della sessione; vuoto ripristina la ricerca automatica. */
export function CodeStudioToolPathsDialog(props: CodeStudioToolPathsDialogProps) {
  // The form is mounted only while open, so its fields start from the stored values every time.
  return props.open ? <ToolPathsForm {...props} /> : null
}

function ToolPathsForm({ open, sessionId, onClose }: CodeStudioToolPathsDialogProps) {
  const gopls = useCodeStudioLspStore((state) => state.gopls[sessionId] ?? null)
  const linter = useCodeStudioLspStore((state) => state.linter[sessionId] ?? null)
  const delve = useCodeStudioDebugStore((state) => state.delve[sessionId] ?? null)
  const [goplsBinary, setGoplsBinary] = useState(() => (gopls?.source === 'custom' ? gopls.binary ?? '' : ''))
  const [linterBinary, setLinterBinary] = useState(() => (linter?.source === 'custom' ? linter.binary ?? '' : ''))
  const [delveBinary, setDelveBinary] = useState(() => (delve?.source === 'custom' ? delve.binary ?? '' : ''))
  const [makeBinary, setMakeBinary] = useState('')
  const [makeInfo, setMakeInfo] = useState<Awaited<ReturnType<typeof detectGoIDEMake>> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void useCodeStudioDebugStore.getState().detectDelve(sessionId)
    void detectGoIDEMake(sessionId).then((info) => {
      setMakeInfo(info)
      setMakeBinary(info.source === 'custom' ? info.binary ?? '' : '')
    }).catch(() => setMakeInfo(null))
  }, [sessionId])

  const apply = async () => {
    setBusy(true)
    setError(null)
    try {
      await configureGopls(sessionId, goplsBinary)
      await configureLinter(sessionId, linterBinary)
      await configureGoIDEDelve(sessionId, delveBinary)
      await configureGoIDEMake(sessionId, makeBinary)
      void useCodeStudioDebugStore.getState().detectDelve(sessionId)
      const lsp = useCodeStudioLspStore.getState()
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
    <CodeStudioModal
      open={open}
      onClose={onClose}
      size="md"
      icon={Wrench}
      title="Tool paths"
      subtitle="Custom binaries for this project. Leave a field empty for automatic detection."
      footerStart="Project linter config files are used, never created."
      footer={<>
        <CodeStudioButton variant="ghost" onClick={onClose}>Cancel</CodeStudioButton>
        <CodeStudioButton variant="primary" loading={busy} onClick={() => void apply()}>Validate & apply</CodeStudioButton>
      </>}
    >
      {error && <CodeStudioAlert icon={AlertCircle}>{error}</CodeStudioAlert>}
      <CodeStudioField label="gopls" hint={<span className="gs-mono block truncate">{detected(gopls)}</span>}>
        <input value={goplsBinary} onChange={(event) => setGoplsBinary(event.target.value)} placeholder="Automatic: adOmnia tools, GOPATH/bin, PATH" className="gs-input gs-mono" />
      </CodeStudioField>
      <CodeStudioField label="Linter (golangci-lint, staticcheck or any go vet-style analyzer)" hint={<span className="gs-mono block truncate">{detected(linter)}{linter?.configPath ? ` · config ${linter.configPath}` : ''}</span>}>
        <input value={linterBinary} onChange={(event) => setLinterBinary(event.target.value)} placeholder="Automatic: golangci-lint, then staticcheck" className="gs-input gs-mono" />
      </CodeStudioField>
      <CodeStudioField label="Delve (dlv)" hint={<span className="gs-mono block truncate">{detected(delve)}</span>}>
        <input value={delveBinary} onChange={(event) => setDelveBinary(event.target.value)} placeholder="Automatic: adOmnia tools, GOPATH/bin, PATH" className="gs-input gs-mono" />
      </CodeStudioField>
      <CodeStudioField label="make (Makefile targets)" hint={<span className="gs-mono block truncate" title={makeInfo?.error}>{makeInfo?.available ? `${makeInfo.binary} (${makeInfo.source})` : makeInfo?.error ?? 'Not detected yet'}</span>}>
        <input value={makeBinary} onChange={(event) => setMakeBinary(event.target.value)} placeholder="Automatic: make, gmake, mingw32-make, GnuWin32" className="gs-input gs-mono" />
      </CodeStudioField>
    </CodeStudioModal>
  )
}
