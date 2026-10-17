import { useEffect, useState } from 'react'
import { CheckCircle2, CircleAlert, RefreshCw, Stethoscope, Wrench } from 'lucide-react'
import { CodeStudioButton } from './CodeStudioModal'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { useCodeStudioDebugStore } from '@/stores/codeStudioDebug'
import type { CodeStudioCommandId } from './codeStudioCommands'
import { CodeStudioExtraTools } from './CodeStudioExtraTools'
import { useCodeStudioStore } from '@/stores/codeStudio'

interface ToolStatus { available: boolean; binary?: string; version?: string; source?: string; error?: string }

interface Props {
  sessionId: string
  goAvailable: boolean
  onRunCommand: (id: CodeStudioCommandId) => void
}

/** Stato di gopls, linter e Delve: health check su richiesta, installazione e aggiornamento a @latest con conferma. */
export function ToolchainToolsSection({ sessionId, goAvailable, onRunCommand }: Props) {
  const gopls = useCodeStudioLspStore((state) => state.gopls[sessionId] ?? null)
  const linter = useCodeStudioLspStore((state) => state.linter[sessionId] ?? null)
  const delve = useCodeStudioDebugStore((state) => state.delve[sessionId] ?? null)
  const [checking, setChecking] = useState(false)
  const trusted = useCodeStudioStore((state) => state.sessions.find((item) => item.id === sessionId)?.project.authorization === 'tooling-permitted')

  const check = async () => {
    setChecking(true)
    const lsp = useCodeStudioLspStore.getState()
    await Promise.allSettled([lsp.detectGopls(sessionId), lsp.detectLinter(sessionId), useCodeStudioDebugStore.getState().detectDelve(sessionId)])
    setChecking(false)
  }
  const reloadGopls = async () => {
    setChecking(true)
    try {
      const lsp = useCodeStudioLspStore.getState()
      const info = await lsp.detectGopls(sessionId)
      if (info?.available) await lsp.restart(sessionId)
    } finally { setChecking(false) }
  }
  useEffect(() => { void check() }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  const linterKind = linter?.kind === 'staticcheck' ? 'staticcheck' : 'golangci-lint'
  const rows: { name: string; purpose: string; status: ToolStatus | null; install: CodeStudioCommandId }[] = [
    { name: 'gopls', purpose: 'Language server', status: gopls, install: 'go.lspInstall' },
    { name: linterKind, purpose: 'Linter', status: linter, install: linterKind === 'staticcheck' ? 'go.installStaticcheck' : 'go.installGolangci' },
    { name: 'dlv', purpose: 'Debugger', status: delve, install: 'go.installDelve' },
  ]

  return (
    <section className="flex flex-col gap-2 border-t border-border-1 pt-4">
      <div className="flex items-center">
        <h3 className="gs-section-title flex items-center gap-1.5"><Wrench size={12} /> Go tools</h3>
        <CodeStudioButton small variant="secondary" className="ml-auto" icon={Stethoscope} loading={checking} onClick={() => void check()}>Health check</CodeStudioButton>
      </div>
      <div className="gs-list">
        {rows.map(({ name, purpose, status, install }) => {
          const healthy = status?.available === true
          return (
            <div key={name} className="gs-list-row flex-wrap">
              {healthy ? <CheckCircle2 size={15} className="shrink-0 text-success" /> : <CircleAlert size={15} className="shrink-0 text-warning" />}
              <div className="min-w-0 flex-1">
                <div className="font-medium text-text-1">{name} <span className="font-normal text-text-4">· {purpose}{healthy && status?.version ? ` · ${status.version}` : ''}{healthy && status?.source ? ` (${status.source})` : ''}</span></div>
                <div className="gs-mono truncate text-[11px] text-text-4" title={healthy ? status?.binary : status?.error}>{healthy ? status?.binary : status?.error ?? 'Not checked yet'}</div>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <CodeStudioButton small variant="secondary" disabled={!goAvailable || !trusted} title={goAvailable ? `go install ${name}@latest with the project SDK` : 'Needs a Go SDK'} onClick={() => onRunCommand(install)}>{healthy ? 'Update' : 'Install'}</CodeStudioButton>
                {name === 'gopls' && <>
                  <CodeStudioButton small variant="ghost" icon={RefreshCw} disabled={!healthy || !trusted || checking} title="Restart gopls and reload code intelligence" onClick={() => void reloadGopls()}>Reload</CodeStudioButton>
                  <CodeStudioButton small variant="ghost" disabled={!trusted} onClick={() => onRunCommand('go.toolPaths')}>Choose binary</CodeStudioButton>
                </>}
              </div>
            </div>
          )
        })}
      </div>
      <CodeStudioExtraTools sessionId={sessionId} goAvailable={goAvailable} trusted={trusted} />
    </section>
  )
}
