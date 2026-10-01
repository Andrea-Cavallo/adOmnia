import { useEffect, useState } from 'react'
import { CheckCircle2, CircleAlert, Stethoscope, Wrench } from 'lucide-react'
import { GoStudioButton } from './GoStudioModal'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { useGoIDEDebugStore } from '@/stores/goideDebug'
import type { GoStudioCommandId } from './goStudioCommands'
import { GoStudioExtraTools } from './GoStudioExtraTools'
import { useGoIDEStore } from '@/stores/goide'

interface ToolStatus { available: boolean; binary?: string; version?: string; source?: string; error?: string }

interface Props {
  sessionId: string
  goAvailable: boolean
  onRunCommand: (id: GoStudioCommandId) => void
}

/** Stato di gopls, linter e Delve: health check su richiesta, installazione e aggiornamento a @latest con conferma. */
export function ToolchainToolsSection({ sessionId, goAvailable, onRunCommand }: Props) {
  const gopls = useGoIDELspStore((state) => state.gopls[sessionId] ?? null)
  const linter = useGoIDELspStore((state) => state.linter[sessionId] ?? null)
  const delve = useGoIDEDebugStore((state) => state.delve[sessionId] ?? null)
  const [checking, setChecking] = useState(false)
  const trusted = useGoIDEStore((state) => state.sessions.find((item) => item.id === sessionId)?.project.authorization === 'tooling-permitted')

  const check = async () => {
    setChecking(true)
    const lsp = useGoIDELspStore.getState()
    await Promise.allSettled([lsp.detectGopls(sessionId), lsp.detectLinter(sessionId), useGoIDEDebugStore.getState().detectDelve(sessionId)])
    setChecking(false)
  }
  useEffect(() => { void check() }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  const linterKind = linter?.kind === 'staticcheck' ? 'staticcheck' : 'golangci-lint'
  const rows: { name: string; purpose: string; status: ToolStatus | null; install: GoStudioCommandId }[] = [
    { name: 'gopls', purpose: 'Language server', status: gopls, install: 'go.lspInstall' },
    { name: linterKind, purpose: 'Linter', status: linter, install: linterKind === 'staticcheck' ? 'go.installStaticcheck' : 'go.installGolangci' },
    { name: 'dlv', purpose: 'Debugger', status: delve, install: 'go.installDelve' },
  ]

  return (
    <section className="flex flex-col gap-2 border-t border-border-1 pt-4">
      <div className="flex items-center">
        <h3 className="gs-section-title flex items-center gap-1.5"><Wrench size={12} /> Go tools</h3>
        <GoStudioButton small variant="secondary" className="ml-auto" icon={Stethoscope} loading={checking} onClick={() => void check()}>Health check</GoStudioButton>
      </div>
      <div className="gs-list">
        {rows.map(({ name, purpose, status, install }) => {
          const healthy = status?.available === true
          return (
            <div key={name} className="gs-list-row">
              {healthy ? <CheckCircle2 size={15} className="shrink-0 text-success" /> : <CircleAlert size={15} className="shrink-0 text-warning" />}
              <div className="min-w-0 flex-1">
                <div className="font-medium text-text-1">{name} <span className="font-normal text-text-4">· {purpose}{healthy && status?.version ? ` · ${status.version}` : ''}{healthy && status?.source ? ` (${status.source})` : ''}</span></div>
                <div className="gs-mono truncate text-[11px] text-text-4" title={healthy ? status?.binary : status?.error}>{healthy ? status?.binary : status?.error ?? 'Not checked yet'}</div>
              </div>
              <GoStudioButton small variant="secondary" disabled={!goAvailable} title={goAvailable ? `go install ${name}@latest with the project SDK` : 'Needs a Go SDK'} onClick={() => onRunCommand(install)}>{healthy ? 'Update' : 'Install'}</GoStudioButton>
            </div>
          )
        })}
      </div>
      <p className="gs-hint">Install and update run in the Run console. Run the health check again when they finish.</p>
      <GoStudioExtraTools sessionId={sessionId} goAvailable={goAvailable} trusted={trusted} />
    </section>
  )
}
