import { useEffect, useState } from 'react'
import { AlertCircle, AlertTriangle, EyeOff, Loader2, LockKeyhole, ScanSearch, ShieldCheck } from 'lucide-react'
import { getGoIDEWatcherStatus, type GoIDEExecution, type GoIDESession, type GoIDEToolchainInfo, type GoIDEWatcherStatus } from '@/lib/goide-api'
import { useShallow } from 'zustand/react/shallow'
import { useGoStudioCursorStore } from './goStudioCursor'
import { GoStudioToolchainSwitcher } from './GoStudioToolchainSwitcher'
import { diagnosticCounts, mergedReports, useGoIDELspStore } from '@/stores/goideLsp'

interface GoStudioStatusBarProps {
  session: GoIDESession
  toolchain: GoIDEToolchainInfo | null
  /** Linguaggio e sola lettura del file attivo; null senza file aperti. */
  documentInfo: { language: string; readOnly: boolean } | null
  execution: GoIDEExecution | null
  onLanguageServer: () => void
  onLinter: () => void
  onSetAuthorization: (allowed: boolean) => void
  onManageToolchains: () => void
}

const ITEM = 'flex h-5 items-center gap-1.5 rounded px-1.5 transition-colors hover:bg-surface-3 hover:text-text-1'

/** Il watcher parte in background dopo l'apertura: lo stato si rilegge poco dopo e poi di rado. */
const WATCHER_STATUS_DELAYS_MS = [1500, 10_000, 60_000]

function useWatcherStatus(sessionId: string): GoIDEWatcherStatus | null {
  const [status, setStatus] = useState<GoIDEWatcherStatus | null>(null)
  useEffect(() => {
    setStatus(null)
    const timers = WATCHER_STATUS_DELAYS_MS.map((delay) => window.setTimeout(() => {
      getGoIDEWatcherStatus(sessionId).then(setStatus).catch(() => undefined)
    }, delay))
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [sessionId])
  return status
}

function languageServerLabel(state: string, version?: string): string {
  switch (state) {
    case 'ready': return `gopls ${version ?? ''}`.trim()
    case 'starting': return 'gopls starting…'
    case 'crashed': return 'gopls crashed'
    default: return 'gopls off'
  }
}

export function GoStudioStatusBar({ session, toolchain, documentInfo, execution, onLanguageServer, onLinter, onSetAuthorization, onManageToolchains }: GoStudioStatusBarProps) {
  const cursor = useGoStudioCursorStore(useShallow((state) => ({ line: state.line, column: state.column })))
  const status = useGoIDELspStore((state) => state.status[session.id])
  const progress = useGoIDELspStore((state) => state.progress[session.id] ?? null)
  const reports = useGoIDELspStore((state) => state.diagnostics[session.id])
  const linter = useGoIDELspStore((state) => state.linter[session.id] ?? null)
  const lint = useGoIDELspStore((state) => state.lint[session.id])
  const showToolWindow = useGoIDELspStore((state) => state.showToolWindow)
  const counts = diagnosticCounts(mergedReports(reports, lint?.reports))
  const watcher = useWatcherStatus(session.id)
  const lspState = status?.state ?? 'stopped'
  const lspTone = lspState === 'ready' ? 'text-success' : lspState === 'crashed' ? 'text-danger' : lspState === 'starting' ? 'text-accent' : 'text-text-4'

  const authorized = session.project.authorization === 'tooling-permitted'
  const running = execution?.status === 'running'

  return (
    <div className="flex h-7 shrink-0 items-center gap-1 px-2 text-[11.5px] text-text-3">
      <span className={`flex min-w-0 items-center gap-1.5 px-1.5 ${running ? 'text-success' : ''}`} title={execution?.command}>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${running ? 'animate-pulse bg-success' : execution?.status === 'failed' ? 'bg-danger' : 'bg-text-4'}`} aria-hidden="true" />
        <span className="truncate">{execution ? `${execution.kind} · ${execution.status}` : 'Idle'}</span>
      </span>
      {watcher?.limited && (
        <span role="status" title={`This project has more than ${watcher.limit} folders: only the first ${watcher.directories} are watched, so changes made outside Go Studio in the others are not detected automatically. Reopen files to see their disk version.`} className="flex items-center gap-1 px-1.5 text-warning">
          <EyeOff size={12} /> Partially watched
        </span>
      )}
      <span className="flex-1" />
      <button type="button" onClick={onLanguageServer} title={status?.error || 'Language server: click for start, restart or log'} className={`${ITEM} ${lspTone}`}>
        {lspState === 'starting' || progress ? <Loader2 size={12} className="animate-spin" /> : <span className={`h-1.5 w-1.5 rounded-full ${lspState === 'ready' ? 'bg-success' : lspState === 'crashed' ? 'bg-danger' : 'bg-text-4'}`} aria-hidden="true" />}
        <span className="max-w-72 truncate">{progress ? `${progress.title ?? 'gopls'}${progress.message ? `: ${progress.message}` : ''}${progress.percentage !== undefined ? ` ${progress.percentage}%` : ''}` : languageServerLabel(lspState, status?.version)}</span>
      </button>
      <button type="button" onClick={onLinter} title={lint?.error || linter?.error || (linter?.available ? `Run ${linter.kind}${linter.configPath ? ` with ${linter.configPath}` : ''} · Ctrl/Cmd+Alt+Shift+L` : 'Install a linter from the Go menu')} className={`${ITEM} ${lint?.error ? 'text-danger' : linter?.available ? '' : 'text-text-4'}`}>
        {lint?.running ? <Loader2 size={12} className="animate-spin" /> : <ScanSearch size={12} />}
        {lint?.running ? `${linter?.kind ?? 'lint'}…` : linter?.available ? `${linter.kind}${lint?.result ? ` · ${lint.result.issueCount}` : ''}` : 'No linter'}
      </button>
      <button type="button" onClick={() => showToolWindow('problems')} title="Problems · Alt+6" className={`${ITEM} gap-2`}>
        <span className={`flex items-center gap-1 ${counts.errors ? 'text-danger' : ''}`}><AlertCircle size={12} />{counts.errors}</span>
        <span className={`flex items-center gap-1 ${counts.warnings ? 'text-warning' : ''}`}><AlertTriangle size={12} />{counts.warnings}</span>
      </button>
      {documentInfo && <span className="px-1.5 font-mono tabular-nums" title="Line:Column">{cursor.line}:{cursor.column}</span>}
      <span className="px-1.5">{documentInfo?.language || (session.project.goWorkPath ? 'go.work' : session.project.goModPath ? 'go.mod' : 'Go folder')}{documentInfo?.readOnly ? ' · read-only' : ''}</span>
      <GoStudioToolchainSwitcher sessionId={session.id} toolchain={toolchain} className={ITEM} onManage={onManageToolchains} />
      <button type="button" onClick={() => onSetAuthorization(!authorized)} aria-pressed={authorized} title={authorized ? 'Local Go tools are permitted. Click to revoke.' : 'Permit local Go tools; nothing starts automatically'} className={`${ITEM} ${authorized ? 'text-success' : 'text-warning'}`}>
        {authorized ? <ShieldCheck size={12} /> : <LockKeyhole size={12} />}{authorized ? 'Trusted' : 'Restricted'}
      </button>
    </div>
  )
}
