import { useCodeStudioLowResources } from '@/stores/codeStudioLowResources'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { logBackgroundError } from '@/lib/code-studio/backgroundError'
import { goModules, goProjectLayout } from '@/lib/code-studio/goProject'
import { isLowResource, watchBattery } from './codeStudioResourceMode'
import { useEffect, useMemo, useState } from 'react'
import { recordLintSample } from './codeStudioQualityHistory'
import { Activity, AlertCircle, AlertTriangle, BatteryLow, EyeOff, Flame, Gauge, GitBranch, Loader2, LockKeyhole, Moon, MoreHorizontal, ScanSearch, ShieldAlert, ShieldCheck, Sun } from 'lucide-react'
import { getGoIDEWatcherStatus, type GoIDEExecution, type GoIDESession, type GoIDEToolchainInfo, type GoIDEWatcherStatus } from '@/lib/code-studio-api'
import { useShallow } from 'zustand/react/shallow'
import { useCodeStudioCursorStore } from './codeStudioCursor'
import { CodeStudioToolchainSwitcher } from './CodeStudioToolchainSwitcher'
import { CodeStudioBreadcrumb } from './CodeStudioBreadcrumb'
import { CodeStudioDocumentStatus } from './CodeStudioDocumentStatus'
import { CodeStudioChromeDisclosure } from './CodeStudioChromeDisclosure'
import { IDE_LANGUAGES, IDE_LANGUAGE_NAMES, ideLanguage, ideLanguageForEditor } from '@/components/ide/languages'
import { WEB_LANGUAGE_IDS } from '@/components/ide/languages/web'
import { projectProfile } from '@/lib/code-studio/projectProfile'
import { CodeStudioStatusPopover } from './CodeStudioStatusPopover'
import { CodeStudioCopilotStatus } from './CodeStudioCopilotStatus'
import { diagnosticCounts, mergedReports, useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { useThemesStore } from '@/stores/themes'
import { useThemeContext } from '@/components/themes/ThemeProvider'
import { inferThemeMode } from '@/lib/themeCatalog'
import { useCodeStudioTasksStore } from '@/stores/codeStudioTasks'
import { CodeStudioPreviewStatus } from './CodeStudioPreviewStatus'
import { useIdeLanguageServersStore, serverLanguageForEditor, serverEntry } from '@/stores/ideLanguageServers'

interface CodeStudioStatusBarProps {
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
  const [statusSession, setStatusSession] = useState(sessionId)
  if (statusSession !== sessionId) {
    setStatusSession(sessionId)
    setStatus(null)
  }
  useEffect(() => {
    const timers = WATCHER_STATUS_DELAYS_MS.map((delay) => window.setTimeout(() => {
      getGoIDEWatcherStatus(sessionId).then(setStatus).catch(logBackgroundError('watcher status'))
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
    case 'unavailable': return `${server} not installed`
    default: return `${server} off`
  }
}

/**
 * Con il server Java non pronto l'editor serve completamento e Structure dall'analisi locale del
 * buffer (JS-14): la fonte è esplicita invece di sembrare un tooling semplicemente spento.
 */
export function localAnalysisLabel(language: string | undefined, state: string, label: string): string {
  return language === 'java' && state !== 'ready' ? `Local Java analysis (${label})` : label
}

export function CodeStudioStatusBar({ session, toolchain, documentInfo, execution, onLanguageServer, onLinter, onSetAuthorization, onManageToolchains }: CodeStudioStatusBarProps) {
  const cursor = useCodeStudioCursorStore(useShallow((state) => ({ line: state.line, column: state.column })))
  const status = useCodeStudioLspStore((state) => state.status[session.id])
  const progress = useCodeStudioLspStore((state) => state.progress[session.id] ?? null)
  const reports = useCodeStudioLspStore((state) => state.diagnostics[session.id])
  const linter = useCodeStudioLspStore((state) => state.linter[session.id] ?? null)
  const lint = useCodeStudioLspStore((state) => state.lint[session.id])
  const lintResult = lint?.result
  useEffect(() => {
    // Solo le run complete: un lint dei soli file modificati non misura il debito del progetto.
    if (lintResult && !lintResult.changedOnly) recordLintSample(session.project.rootPath, { at: new Date().toISOString(), linter: lintResult.linter, issues: lintResult.issueCount, baselined: lintResult.baselined ?? 0 })
  }, [lintResult, session.project.rootPath])
  const showToolWindow = useCodeStudioLspStore((state) => state.showToolWindow)
  const counts = diagnosticCounts(mergedReports(reports, lint?.reports))
  const watcher = useWatcherStatus(session.id)
  // Per un file web la voce parla del suo language server, non di gopls.
  // Senza un file aperto la voce segue il linguaggio del progetto: un'app Node non deve parlare di gopls.
  const profile = useMemo(() => projectProfile(session.project, IDE_LANGUAGE_NAMES), [session.project])
  const projectWebLanguage = !profile.hasGo && profile.primaryLanguage && WEB_LANGUAGE_IDS.includes(profile.primaryLanguage) ? profile.primaryLanguage : undefined
  const webLanguage = documentInfo ? serverLanguageForEditor(documentInfo.language) : projectWebLanguage
  // Il pulsante del language server c'è solo se qualcuno lo serve: Go, un server web o il server del linguaggio del file.
  const showLsp = profile.hasGo || !!webLanguage || (!!documentInfo && !!ideLanguageForEditor(documentInfo.language)?.languageServer)
  const showGo = profile.hasGo || (!!documentInfo && ideLanguageForEditor(documentInfo.language)?.id === 'go')
  const webServer = useIdeLanguageServersStore((state) => webLanguage ? serverEntry(state, session.id, webLanguage) : null)
  const lspState = webServer ? (webServer.state === 'missing' ? 'unavailable' : webServer.state) : status?.state ?? 'stopped'
  const serverName = (documentInfo ? ideLanguageForEditor(documentInfo.language)?.languageServer : profile.primaryLanguage ? ideLanguage(profile.primaryLanguage)?.languageServer : undefined) || IDE_LANGUAGES.find((language) => language.languageServer)?.languageServer || 'Language server'
  const lspTone = lspState === 'ready' ? 'text-success' : lspState === 'crashed' ? 'text-danger' : lspState === 'starting' ? 'text-accent' : 'text-text-4'

  const resourceMode = useCodeStudioLspStore((state) => state.preferences.resourceMode)
  const onBattery = useCodeStudioLspStore((state) => state.onBattery)
  const lowResource = isLowResource(resourceMode, onBattery)
  // La batteria si segue solo in modalità auto: nelle altre modalità non serve.
  useEffect(() => {
    if (resourceMode !== 'auto') return
    return watchBattery((value) => useCodeStudioLspStore.setState({ onBattery: value }))
  }, [resourceMode])
  const authorized = session.project.authorization === 'tooling-permitted'
  const running = execution?.status === 'running'
  // Seleziona l'array stabile per sessione: un `.filter` dentro il selettore
  // restituirebbe un nuovo array a ogni render (Zustand 5 / useSyncExternalStore
  // lo vede come snapshot diverso) e causerebbe un loop infinito (React #185).
  const sessionTasks = useCodeStudioTasksStore((state) => state.tasks[session.id])
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
        {documentInfo && <CodeStudioBreadcrumb documentId={documentInfo.id} relativePath={documentInfo.relativePath} readOnly={documentInfo.readOnly} cursor={cursor} />}
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
          <button type="button" onClick={() => void useCodeStudioStore.getState().refreshProject()} title={`Watching ${watcher.directories} of ${watcher.limit}+ folders: changes made outside Code Studio in the others are not detected automatically. Click to re-read the project from disk.`} className="flex shrink-0 items-center gap-1 whitespace-nowrap px-1.5 text-warning hover:underline">
            <EyeOff size={12} /> Partially watched · {watcher.directories}/{watcher.limit} · Refresh
          </button>
        )}
        {lowResource && (
          <button
            type="button"
            onClick={() => void useCodeStudioLowResources.getState().deactivate('normal')}
            title={`Low-resource mode${resourceMode === 'auto' ? ' (on battery)' : ''}: optional editor features are paused; language servers stay available. Click to restore services.`}
            className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-1.5 text-warning hover:bg-surface-3"
          >
            {resourceMode === 'auto' ? <BatteryLow size={12} /> : <Gauge size={12} />} Low-resource
          </button>
        )}
      </div>
      <CodeStudioChromeDisclosure className="code-studio-status-details" label="Editor status and tools" title="Language servers, problems, tools, appearance and project trust" icon={<MoreHorizontal size={14}/> }>
      <CodeStudioStatusPopover>
      <section className="code-studio-status-section" aria-label="Language">
      <h4>Language</h4>
      {showLsp && <div data-status-item data-search="language server lsp restart log"><button type="button" onClick={webLanguage ? () => void useIdeLanguageServersStore.getState().restart(session.id, webLanguage) : onLanguageServer} title={webServer ? (webServer.error || 'Language server: click to restart') : status?.error || 'Language server: click for start, restart or log'} className={`${ITEM} ${lspTone}`}>
        {lspState === 'starting' || progress ? <Loader2 size={12} className="animate-spin" /> : <span className={`h-1.5 w-1.5 rounded-full ${lspState === 'ready' ? 'bg-success' : lspState === 'crashed' ? 'bg-danger' : 'bg-text-4'}`} aria-hidden="true" />}
        <span className="max-w-56 truncate">{progress ? `${progress.title ?? serverName}${progress.message ? `: ${progress.message}` : ''}${progress.percentage !== undefined ? ` ${progress.percentage}%` : ''}` : localAnalysisLabel(webLanguage, lspState, languageServerLabel(lspState, serverName, webServer ? webServer.version : status?.version))}</span>
      </button></div>}
      {showGo && <div data-status-item data-search="lint linter golangci"><button type="button" onClick={onLinter} title={lint?.error || linter?.error || (linter?.available ? `Run ${linter.kind}${linter.configPath ? ` with ${linter.configPath}` : ''} · Ctrl/Cmd+Alt+Shift+L` : 'Install a linter from the Go menu')} className={`${ITEM} ${lint?.error ? 'text-danger' : linter?.available ? '' : 'text-text-4'}`}>
        {lint?.running ? <Loader2 size={12} className="animate-spin" /> : <ScanSearch size={12} />}
        {lint?.running ? `${linter?.kind ?? 'lint'}…` : linter?.available ? `${linter.kind}${lint?.result ? ` · ${lint.result.issueCount}${lint.result.changedOnly ? ' in changed files' : ''}${lint.result.baselined ? ` (+${lint.result.baselined} in baseline)` : ''}` : ''}` : 'No linter'}
      </button></div>}
      <div data-status-item data-search="problems errors warnings diagnostics"><button type="button" aria-label={`Problems: ${counts.errors} errors, ${counts.warnings} warnings`} onClick={() => showToolWindow('problems')} title="Problems · Alt+6" className={`${ITEM} gap-2`}>
        <span className={`flex items-center gap-1 ${counts.errors ? 'text-danger' : ''}`}><AlertCircle size={12} />{counts.errors}</span>
        <span className={`flex items-center gap-1 ${counts.warnings ? 'text-warning' : ''}`}><AlertTriangle size={12} />{counts.warnings}</span>
        <span className="text-text-3">Problems</span>
      </button></div>
      {showGo && <div data-status-item data-search="go version toolchain sdk"><CodeStudioToolchainSwitcher sessionId={session.id} toolchain={toolchain} className={ITEM} onManage={onManageToolchains} /></div>}
      </section>
      <section className="code-studio-status-section" aria-label="Tools">
      <h4>Tools</h4>
      <div data-status-item data-search="live preview server"><CodeStudioPreviewStatus sessionId={session.id} className={`${ITEM} gap-1`} /></div>
      <div data-status-item data-search="git version control"><button type="button" aria-label="Git" onClick={() => showToolWindow('git')} title="Git" className={`${ITEM} gap-1`}><GitBranch size={12} />Git</button></div>
      {goModules(session.project).length > 0 && (
        <div data-status-item data-search="go optimization profiling escape analysis struct layout"><button type="button" aria-label="Go optimization" onClick={() => showToolWindow('go')} title="Go optimization · profiling, escape analysis, struct layout and tools · Alt+0" className={`${ITEM} gap-1`}>
          <Flame size={12} />Go optimization
        </button></div>
      )}
      <div data-status-item data-search="trace go trace.out"><button type="button" onClick={() => showToolWindow('trace')} title="Go trace (trace.out)" className={`${ITEM} gap-1`}><Activity size={12} />Trace</button></div>
      <div data-status-item data-search="sonar sonarqube quality"><button type="button" onClick={() => showToolWindow('sonar')} title="SonarQube (optional)" className={`${ITEM} gap-1`}><ShieldCheck size={12} />SonarQube</button></div>
      <div data-status-item data-search="security vulnerabilities scan govulncheck"><button type="button" onClick={() => showToolWindow('vulns')} title="Security: code scan and known vulnerabilities" className={`${ITEM} gap-1`}><ShieldAlert size={12} />Security</button></div>
      <div data-status-item data-search="copilot ai"><CodeStudioCopilotStatus className={ITEM} /></div>
      </section>
      <section className="code-studio-status-section" aria-label="Project">
      <h4>Project</h4>
      <div data-status-item data-search="theme appearance light dark"><div className="flex items-center gap-1" role="group" aria-label="Code Studio appearance">
        <span className="mr-auto text-text-3">Theme</span>
        <button type="button" onClick={() => applyThemeMode('light')} aria-label="Light theme" aria-pressed={themeMode === 'light'} title="Light theme" className={`${ITEM} h-6 px-1.5 ${themeMode === 'light' ? 'bg-surface-3 text-accent' : ''}`}><Sun size={12} /></button>
        <button type="button" onClick={() => applyThemeMode('dark')} aria-label="Dark theme" aria-pressed={themeMode === 'dark'} title="Dark theme" className={`${ITEM} h-6 px-1.5 ${themeMode === 'dark' ? 'bg-surface-3 text-accent' : ''}`}><Moon size={12} /></button>
      </div></div>
      <div data-status-item data-search="trust trusted restricted authorization permit tools"><button type="button" onClick={() => onSetAuthorization(!authorized)} aria-pressed={authorized} title={authorized ? 'Local Go tools are permitted. Click to revoke.' : 'Permit local Go tools; nothing starts automatically'} className={`${ITEM} ${authorized ? 'text-success' : 'text-warning'}`}>
        {authorized ? <ShieldCheck size={12} /> : <LockKeyhole size={12} />}{authorized ? 'Trusted' : 'Restricted'}
      </button></div>
      </section>
      </CodeStudioStatusPopover>
      </CodeStudioChromeDisclosure>
      {!authorized && <span title="Project tools are restricted; open Editor status and tools to manage trust" className="text-warning"><LockKeyhole size={12} aria-label="Restricted project"/></span>}
      <CodeStudioDocumentStatus />
      {!documentInfo && <span className={LABEL}>{!profile.hasGo ? (profile.primaryLanguage ? IDE_LANGUAGE_NAMES[profile.primaryLanguage] ?? profile.primaryLanguage : 'Folder') : goProjectLayout(session.project).goWorkPath ? 'go.work' : goProjectLayout(session.project).goModPath ? 'go.mod' : 'Go folder'}</span>}
    </div>
  )
}
