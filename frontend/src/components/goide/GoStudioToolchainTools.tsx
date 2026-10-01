import { useEffect, useState } from 'react'
import { CheckCircle2, CircleAlert, Loader2, Stethoscope, Wrench } from 'lucide-react'
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
    <section className="mt-4 border-t border-border-1 pt-4">
      <div className="mb-2 flex items-center">
        <h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-3"><Wrench size={11} /> Go tools</h3>
        <button type="button" disabled={checking} onClick={() => void check()} className="ml-auto flex h-6 items-center gap-1 rounded border border-border-1 px-2 text-[9px] text-text-3 hover:border-accent disabled:opacity-40">{checking ? <Loader2 size={10} className="animate-spin" /> : <Stethoscope size={10} />} Health check</button>
      </div>
      <div className="divide-y divide-border-1 rounded border border-border-1 bg-surface-0">
        {rows.map(({ name, purpose, status, install }) => {
          const healthy = status?.available === true
          return (
            <div key={name} className="flex items-center gap-3 p-2">
              {healthy ? <CheckCircle2 size={12} className="shrink-0 text-success" /> : <CircleAlert size={12} className="shrink-0 text-warning" />}
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-medium text-text-2">{name} <span className="font-normal text-text-4">· {purpose}{healthy && status?.version ? ` · ${status.version}` : ''}{healthy && status?.source ? ` (${status.source})` : ''}</span></div>
                <div className="truncate font-mono text-[9px] text-text-4" title={healthy ? status?.binary : status?.error}>{healthy ? status?.binary : status?.error ?? 'Not checked yet'}</div>
              </div>
              <button type="button" disabled={!goAvailable} title={goAvailable ? `go install ${name}@latest with the project SDK` : 'Needs a Go SDK'} onClick={() => onRunCommand(install)} className="h-6 rounded px-2 text-[10px] text-accent hover:bg-accent/10 disabled:text-text-4">{healthy ? 'Update…' : 'Install…'}</button>
            </div>
          )
        })}
      </div>
      <p className="mt-1 text-[9px] text-text-4">Install and update run in the Run console; run the health check again when they finish.</p>
      <GoStudioExtraTools sessionId={sessionId} goAvailable={goAvailable} trusted={trusted} />
    </section>
  )
}
