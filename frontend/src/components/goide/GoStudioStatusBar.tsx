import { AlertCircle, AlertTriangle, Loader2, ScanSearch, Sparkles } from 'lucide-react'
import type { GoIDEExecution, GoIDESession, GoIDEToolchainInfo } from '@/lib/goide-api'
import { useShallow } from 'zustand/react/shallow'
import { useGoStudioCursorStore } from './goStudioCursor'
import { diagnosticCounts, mergedReports, useGoIDELspStore } from '@/stores/goideLsp'

interface GoStudioStatusBarProps {
  session: GoIDESession
  toolchain: GoIDEToolchainInfo | null
  /** Linguaggio e sola lettura del file attivo; null senza file aperti. */
  documentInfo: { language: string; readOnly: boolean } | null
  execution: GoIDEExecution | null
  onLanguageServer: () => void
  onLinter: () => void
}

function languageServerLabel(state: string, version?: string): string {
  switch (state) {
    case 'ready': return `gopls ${version ?? ''}`.trim()
    case 'starting': return 'gopls starting…'
    case 'crashed': return 'gopls crashed'
    default: return 'gopls off'
  }
}

export function GoStudioStatusBar({ session, toolchain, documentInfo, execution, onLanguageServer, onLinter }: GoStudioStatusBarProps) {
  const cursor = useGoStudioCursorStore(useShallow((state) => ({ line: state.line, column: state.column })))
  const status = useGoIDELspStore((state) => state.status[session.id])
  const progress = useGoIDELspStore((state) => state.progress[session.id] ?? null)
  const reports = useGoIDELspStore((state) => state.diagnostics[session.id])
  const linter = useGoIDELspStore((state) => state.linter[session.id] ?? null)
  const lint = useGoIDELspStore((state) => state.lint[session.id])
  const showToolWindow = useGoIDELspStore((state) => state.showToolWindow)
  const counts = diagnosticCounts(mergedReports(reports, lint?.reports))
  const lspState = status?.state ?? 'stopped'
  const lspTone = lspState === 'ready' ? 'text-success' : lspState === 'crashed' ? 'text-danger' : lspState === 'starting' ? 'text-accent' : 'text-text-4'

  return (
    <div className="flex h-6 shrink-0 items-center gap-3 border-t border-border-1 bg-surface-1 px-3 text-[9px] text-text-4">
      <span title={toolchain?.goBinary}>{toolchain?.available ? (toolchain.version ?? 'Go ready').replace(/^go version\s+/, '') : 'Go not detected'}</span>
      <button type="button" onClick={onLanguageServer} title={status?.error || 'Language server: click for start, restart or log'} className={`flex items-center gap-1 rounded px-1 hover:bg-surface-3 ${lspTone}`}>
        {lspState === 'starting' || progress ? <Loader2 size={9} className="animate-spin" /> : <Sparkles size={9} />}
        {progress ? `${progress.title ?? 'gopls'}${progress.message ? `: ${progress.message}` : ''}${progress.percentage !== undefined ? ` ${progress.percentage}%` : ''}` : languageServerLabel(lspState, status?.version)}
      </button>
      <button type="button" onClick={onLinter} title={lint?.error || linter?.error || (linter?.available ? `Run ${linter.kind}${linter.configPath ? ` with ${linter.configPath}` : ''} · Ctrl/Cmd+Alt+Shift+L` : 'Install a linter from the Go menu')} className={`flex items-center gap-1 rounded px-1 hover:bg-surface-3 ${lint?.error ? 'text-danger' : linter?.available ? '' : 'text-text-4/70'}`}>
        {lint?.running ? <Loader2 size={9} className="animate-spin" /> : <ScanSearch size={9} />}
        {lint?.running ? `${linter?.kind ?? 'lint'}…` : linter?.available ? `${linter.kind}${lint?.result ? ` · ${lint.result.issueCount}` : ''}` : 'no linter'}
      </button>
      <button type="button" onClick={() => showToolWindow('problems')} title="Problems · Alt+6" className="flex items-center gap-2 rounded px-1 hover:bg-surface-3">
        <span className={`flex items-center gap-0.5 ${counts.errors ? 'text-danger' : ''}`}><AlertCircle size={9} />{counts.errors}</span>
        <span className={`flex items-center gap-0.5 ${counts.warnings ? 'text-warning' : ''}`}><AlertTriangle size={9} />{counts.warnings}</span>
      </button>
      <span>{documentInfo?.language || (session.project.goWorkPath ? 'go.work' : session.project.goModPath ? 'go.mod' : 'Go folder')}{documentInfo?.readOnly ? ' · read-only' : ''}</span>
      {documentInfo && <span>Ln {cursor.line}, Col {cursor.column}</span>}
      <span className="ml-auto">{execution ? `${execution.kind}: ${execution.status}` : 'idle'}</span>
    </div>
  )
}
