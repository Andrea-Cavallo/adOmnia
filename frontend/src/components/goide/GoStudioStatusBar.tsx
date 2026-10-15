import { goModules, goProjectLayout } from '@/lib/goide/goProject'
import { isLowResource, watchBattery } from './goStudioResourceMode'
import { useEffect, useMemo, useState } from 'react'
import { recordLintSample } from './goStudioQualityHistory'
import { Activity, AlertCircle, AlertTriangle, BatteryLow, EyeOff, Flame, Gauge, GitBranch, Loader2, LockKeyhole, Moon, ScanSearch, ShieldAlert, ShieldCheck, Sun } from 'lucide-react'
import { getGoIDEWatcherStatus, type GoIDEExecution, type GoIDESession, type GoIDEToolchainInfo, type GoIDEWatcherStatus } from '@/lib/goide-api'
import { useShallow } from 'zustand/react/shallow'
import { useGoStudioCursorStore } from './goStudioCursor'
import { GoStudioToolchainSwitcher } from './GoStudioToolchainSwitcher'
import { GoStudioBreadcrumb } from './GoStudioBreadcrumb'
import { BrandIcon } from './GoStudioFileIcon'
import { IDE_LANGUAGES, ideLanguageForEditor } from '@/components/ide/languages'
import { GoStudioStatusMenu } from './GoStudioStatusMenu'
import { GoStudioCopilotStatus } from './GoStudioCopilotStatus'
import { diagnosticCounts, mergedReports, useGoIDELspStore } from '@/stores/goideLsp'
import { useThemesStore } from '@/stores/themes'
import { useThemeContext } from '@/components/themes/ThemeProvider'
import { inferThemeMode } from '@/lib/themeCatalog'
import { useGoIDETasksStore } from '@/stores/goideTasks'

interface GoStudioStatusBarProps {
  session: GoIDESession
  toolchain: GoIDEToolchainInfo | null
  /** File attivo: percorso per il breadcrumb, linguaggio, sola lettura e separatore di riga; null senza file aperti. */
  documentInfo: { id: string; relativePath: string; language: string; readOnly: boolean; lineEnding: 'LF' | 'CRLF' } | null
  execution: GoIDEExecution | null
  onLanguageServer: () => void
  onLinter: () => void
  onSetAuthorization: (allowed: boolean) => void
  onManageToolchains: () => void
}

const ITEM = 'flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded px-1.5 transition-colors hover:bg-surface-3 hover:text-text-1'
const LABEL = 'shrink-0 whitespace-nowrap px-1.5'

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

/** `server` comes from the language contribution (e.g. "gopls"), never hardcoded here. */
export function languageServerLabel(state: string, server: string, version?: string): string {
  switch (state) {
    case 'ready': return `${server} ${version ?? ''}`.trim()
    case 'starting': return `${server} starting…`
    case 'crashed': return `${server} crashed`
    default: return `${server} off`
  }
}

export function GoStudioStatusBar({ session, toolchain, documentInfo, execution, onLanguageServer, onLinter, onSetAuthorization, onManageToolchains }: GoStudioStatusBarProps) {
  const cursor = useGoStudioCursorStore(useShallow((state) => ({ line: state.line, column: state.column })))
  const status = useGoIDELspStore((state) => state.status[session.id])
  const progress = useGoIDELspStore((state) => state.progress[session.id] ?? null)
  const reports = useGoIDELspStore((state) => state.diagnostics[session.id])
  const linter = useGoIDELspStore((state) => state.linter[session.id] ?? null)
  const lint = useGoIDELspStore((state) => state.lint[session.id])
  const lintResult = lint?.result
  useEffect(() => {
    // Solo le run complete: un lint dei soli file modificati non misura il debito del progetto.
    if (lintResult && !lintResult.changedOnly) recordLintSample(session.project.rootPath, { at: new Date().toISOString(), linter: lintResult.linter, issues: lintResult.issueCount, baselined: lintResult.baselined ?? 0 })
  }, [lintResult, session.project.rootPath])
  const showToolWindow = useGoIDELspStore((state) => state.showToolWindow)
  const counts = diagnosticCounts(mergedReports(reports, lint?.reports))
  const watcher = useWatcherStatus(session.id)
  const lspState = status?.state ?? 'stopped'
  const serverName = (documentInfo && ideLanguageForEditor(documentInfo.language)?.languageServer) || IDE_LANGUAGES.find((language) => language.languageServer)?.languageServer || 'Language server'
  const lspTone = lspState === 'ready' ? 'text-success' : lspState === 'crashed' ? 'text-danger' : lspState === 'starting' ? 'text-accent' : 'text-text-4'

  const resourceMode = useGoIDELspStore((state) => state.preferences.resourceMode)
  const onBattery = useGoIDELspStore((state) => state.onBattery)
  const lowResource = isLowResource(resourceMode, onBattery)
  // La batteria si segue solo in modalità auto: nelle altre modalità non serve.
  useEffect(() => {
    if (resourceMode !== 'auto') return
    return watchBattery((value) => useGoIDELspStore.setState({ onBattery: value }))
  }, [resourceMode])
  const authorized = session.project.authorization === 'tooling-permitted'
  const running = execution?.status === 'running'
  // Seleziona l'array stabile per sessione: un `.filter` dentro il selettore
  // restituirebbe un nuovo array a ogni render (Zustand 5 / useSyncExternalStore
  // lo vede come snapshot diverso) e causerebbe un loop infinito (React #185).
  const sessionTasks = useGoIDETasksStore((state) => state.tasks[session.id])
  const tasks = useMemo(() => (sessionTasks ?? []).filter((task) => task.status === 'running'), [sessionTasks])
  const themes = useThemesStore((state) => state.themes)
  const activeThemeId = useThemesStore((state) => state.activeThemeId)
  const { applyTheme } = useThemeContext()
  const activeTheme = themes.find((theme) => theme.id === activeThemeId)
  const themeMode = inferThemeMode(activeTheme)
  const applyThemeMode = (mode: 'light' | 'dark') => {
    const preferredId = mode === 'light' ? 'builtin-light' : 'builtin-dark'
    const next = themes.find((theme) => theme.id === preferredId)
      ?? themes.find((theme) => inferThemeMode(theme) === mode)
    if (next) applyTheme(next)
  }

  return (
    <div className="flex h-7 min-w-0 shrink-0 items-center gap-1 overflow-hidden px-2 text-[11.5px] text-text-3">
      {/* Sinistra: dove sei nel codice. Si accorcia per primo, così i widget a destra non escono mai dal bordo. */}
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {documentInfo && <GoStudioBreadcrumb documentId={documentInfo.id} relativePath={documentInfo.relativePath} readOnly={documentInfo.readOnly} cursor={cursor} />}
        {execution && (
          <span className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap px-1.5 ${running ? 'text-success' : ''}`} title={execution.command}>
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${running ? 'animate-pulse bg-success' : execution.status === 'failed' ? 'bg-danger' : 'bg-text-4'}`} aria-hidden="true" />
            {execution.kind} · {execution.status}
          </span>
        )}
        {tasks.slice(0, 2).map((task) => (
          <span key={task.id} role="status" className="flex shrink-0 items-center gap-1 whitespace-nowrap px-1.5 text-accent" title={task.label}>
            <Loader2 size={11} className="animate-spin" aria-hidden="true" />
            <span className="max-w-40 truncate">{task.label}</span>
          </span>
        ))}
        {tasks.length > 2 && <span className="shrink-0 text-text-4">+{tasks.length - 2}</span>}
        {watcher?.limited && (
          <span role="status" title={`This project has more than ${watcher.limit} folders: only the first ${watcher.directories} are watched, so changes made outside Go Studio in the others are not detected automatically. Reopen files to see their disk version.`} className="flex shrink-0 items-center gap-1 whitespace-nowrap px-1.5 text-warning">
            <EyeOff size={12} /> Partially watched
          </span>
        )}
        {lowResource && (
          <button
            type="button"
            onClick={() => useGoIDELspStore.getState().updatePreferences({ resourceMode: 'normal' })}
            title={`Low-resource mode${resourceMode === 'auto' ? ' (on battery)' : ''}: semantic colors, inlay hints, sticky scroll and lint on save are paused. Click to turn it off.`}
            className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-1.5 text-warning hover:bg-surface-3"
          >
            {resourceMode === 'auto' ? <BatteryLow size={12} /> : <Gauge size={12} />} Low-resource
          </button>
        )}
      </div>
      {/* Centro: può scorrere in orizzontale su finestre strette; tema e fiducia restano sempre visibili a destra. */}
      <div className="flex min-w-0 shrink items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <button type="button" onClick={onLanguageServer} title={status?.error || 'Language server: click for start, restart or log'} className={`${ITEM} ${lspTone}`}>
        {lspState === 'starting' || progress ? <Loader2 size={12} className="animate-spin" /> : <span className={`h-1.5 w-1.5 rounded-full ${lspState === 'ready' ? 'bg-success' : lspState === 'crashed' ? 'bg-danger' : 'bg-text-4'}`} aria-hidden="true" />}
        <span className="max-w-56 truncate">{progress ? `${progress.title ?? 'gopls'}${progress.message ? `: ${progress.message}` : ''}${progress.percentage !== undefined ? ` ${progress.percentage}%` : ''}` : languageServerLabel(lspState, serverName, status?.version)}</span>
      </button>
      <button type="button" onClick={onLinter} title={lint?.error || linter?.error || (linter?.available ? `Run ${linter.kind}${linter.configPath ? ` with ${linter.configPath}` : ''} · Ctrl/Cmd+Alt+Shift+L` : 'Install a linter from the Go menu')} className={`${ITEM} ${lint?.error ? 'text-danger' : linter?.available ? '' : 'text-text-4'}`}>
        {lint?.running ? <Loader2 size={12} className="animate-spin" /> : <ScanSearch size={12} />}
        {lint?.running ? `${linter?.kind ?? 'lint'}…` : linter?.available ? `${linter.kind}${lint?.result ? ` · ${lint.result.issueCount}${lint.result.changedOnly ? ' in changed files' : ''}${lint.result.baselined ? ` (+${lint.result.baselined} in baseline)` : ''}` : ''}` : 'No linter'}
      </button>
      <button type="button" aria-label={`Problems: ${counts.errors} errors, ${counts.warnings} warnings`} onClick={() => showToolWindow('problems')} title="Problems · Alt+6" className={`${ITEM} gap-2`}>
        <span className={`flex items-center gap-1 ${counts.errors ? 'text-danger' : ''}`}><AlertCircle size={12} />{counts.errors}</span>
        <span className={`flex items-center gap-1 ${counts.warnings ? 'text-warning' : ''}`}><AlertTriangle size={12} />{counts.warnings}</span>
      </button>
      <button type="button" aria-label="Git" onClick={() => showToolWindow('git')} title="Git" className={`${ITEM} gap-1`}>
        <GitBranch size={12} />Git
      </button>
      {goModules(session.project).length > 0 && (
        <button type="button" aria-label="Go optimization" onClick={() => showToolWindow('go')} title="Go optimization · profiling, escape analysis, struct layout and tools · Alt+0" className={`${ITEM} gap-1`}>
          <Flame size={12} />Go
        </button>
      )}
      <GoStudioStatusMenu
        label="Tools"
        title="Trace, SonarQube and security scans"
        className={`${ITEM} gap-1`}
        items={[
          { id: 'trace', label: 'Trace', title: 'Go trace (trace.out)', icon: <Activity size={12} />, onSelect: () => showToolWindow('trace') },
          { id: 'sonar', label: 'Sonar', title: 'SonarQube (optional)', icon: <ShieldCheck size={12} />, onSelect: () => showToolWindow('sonar') },
          { id: 'vulns', label: 'Security', title: 'Security: code scan and known vulnerabilities', icon: <ShieldAlert size={12} />, onSelect: () => showToolWindow('vulns') },
        ]}
      />
      {documentInfo && <span className={`${LABEL} tabular-nums`} title="Line:Column">{cursor.line}:{cursor.column}</span>}
      {documentInfo && <span className={LABEL} title={documentInfo.lineEnding === 'CRLF' ? 'Line separator: Windows (\\r\\n)' : 'Line separator: Unix (\\n)'}>{documentInfo.lineEnding}</span>}
      <span className={`${LABEL} flex items-center gap-1`}>{documentInfo && ideLanguageForEditor(documentInfo.language) && <BrandIcon slug={ideLanguageForEditor(documentInfo.language)!.icon} size={12} />}{documentInfo?.language || (goProjectLayout(session.project).goWorkPath ? 'go.work' : goProjectLayout(session.project).goModPath ? 'go.mod' : 'Go folder')}{documentInfo?.readOnly ? ' · read-only' : ''}</span>
      <GoStudioToolchainSwitcher sessionId={session.id} toolchain={toolchain} className={ITEM} onManage={onManageToolchains} />
      <GoStudioCopilotStatus className={ITEM} />
      </div>
      <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-border-1 bg-surface-1 p-0.5" role="group" aria-label="Go Studio appearance">
        <button type="button" onClick={() => applyThemeMode('light')} aria-label="Light theme" aria-pressed={themeMode === 'light'} title="Light theme" className={`${ITEM} h-5 px-1 ${themeMode === 'light' ? 'bg-surface-3 text-accent' : ''}`}><Sun size={11} /></button>
        <button type="button" onClick={() => applyThemeMode('dark')} aria-label="Dark theme" aria-pressed={themeMode === 'dark'} title="Dark theme" className={`${ITEM} h-5 px-1 ${themeMode === 'dark' ? 'bg-surface-3 text-accent' : ''}`}><Moon size={11} /></button>
      </div>
      <button type="button" onClick={() => onSetAuthorization(!authorized)} aria-pressed={authorized} title={authorized ? 'Local Go tools are permitted. Click to revoke.' : 'Permit local Go tools; nothing starts automatically'} className={`${ITEM} ${authorized ? 'text-success' : 'text-warning'}`}>
        {authorized ? <ShieldCheck size={12} /> : <LockKeyhole size={12} />}{authorized ? 'Trusted' : 'Restricted'}
      </button>
    </div>
  )
}
