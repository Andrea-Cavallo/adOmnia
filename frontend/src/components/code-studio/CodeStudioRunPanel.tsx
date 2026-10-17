import { useEffect, useMemo, useRef, useState, memo } from 'react'
import type { CodeStudioCommandId } from './codeStudioCommands'
import { Copy, Minus, RefreshCw, Search, Square } from 'lucide-react'
import { Clipboard as WailsClipboard } from '@wailsio/runtime'
import { useCodeStudioStore, type GoIDEConsoleChunk } from '@/stores/codeStudio'
import { selectedTestRun, useCodeStudioTestsStore } from '@/stores/codeStudioTests'
import { CodeStudioTestsPanel } from './CodeStudioTestsPanel'
import { CodeStudioDebugPanel } from './CodeStudioDebugPanel'
import { CodeStudioTodoPanel } from './CodeStudioTodoPanel'
import { CodeStudioLivePreview } from './CodeStudioLivePreview'
import { selectDebugState } from './codeStudioDebugCommands'
import { useCodeStudioDebugStore } from '@/stores/codeStudioDebug'
import type { GoIDEExecution, GoIDESession } from '@/lib/code-studio-api'
import { CodeStudioTerminalPanel } from './CodeStudioTerminalPanel'
import { resolveConsolePath } from './codeStudioConsolePaths'
import { CONSOLE_WINDOW, CONSOLE_WINDOW_STEP, MAX_RENDERED_LINES, consoleVisibleStart } from './codeStudioConsoleWindow'
import { consoleLogLevel, consoleSegments, type ConsoleLogLevel } from './codeStudioLogLevels'
import { CodeStudioProblems, type CodeStudioBuildProblem } from './CodeStudioProblems'
import { CodeStudioContextPanel } from './CodeStudioContextPanel'
import { CodeStudioProfilePanel } from './CodeStudioProfilePanel'
import { CodeStudioTracePanel } from './CodeStudioTracePanel'
import { CodeStudioFuzzPanel } from './CodeStudioFuzzPanel'
import { CodeStudioErrorsPanel } from './CodeStudioErrorsPanel'
import { CodeStudioArchitecturePanel } from './CodeStudioArchitecturePanel'
import { CodeStudioImpactPanel } from './CodeStudioImpactPanel'
import { CodeStudioConfigPanel } from './CodeStudioConfigPanel'
import { CodeStudioDocsPanel } from './CodeStudioDocsPanel'
import { CodeStudioSonarPanel } from './CodeStudioSonarPanel'
import { CodeStudioSecurityPanel } from './CodeStudioSecurityPanel'
import { CodeStudioGitPanel } from './CodeStudioGitPanel'
import { CodeStudioGoPanel } from './CodeStudioGoPanel'
import { CodeStudioReferences } from './CodeStudioReferences'
import { CodeStudioFindInFiles } from './CodeStudioFindInFiles'
import { diagnosticCounts, mergedReports, useCodeStudioLspStore, type GoIDEToolWindow } from '@/stores/codeStudioLsp'
import { StudioToolControls } from './StudioToolControls'
import { toolKey, useStudioTools, useToolView } from './studioToolState'
import { selectToolRun } from './studioToolBridge'
import { buildKitProgress } from '@/lib/code-studio/buildKitProgress'

interface CodeStudioRunPanelProps {
  session: GoIDESession
  fixedView?: 'run' | 'terminal'
  logsOnly?: boolean
  standalone?: boolean
  visible?: boolean
  onCommand?: (id: CodeStudioCommandId) => void
}

interface ParsedLine {
  text: string
  raw: string
  path?: string
  line?: number
  column?: number
  stream: GoIDEConsoleChunk['stream']
  sequence: number
}

const ansiPattern = /\x1b\[[0-?]*[ -/]*[@-~]/g
const locationPattern = /((?:[A-Za-z]:[\\/])?[^\s:]+\.go):(\d+)(?::(\d+))?/

function parseLines(chunks: GoIDEConsoleChunk[]): ParsedLine[] {
  const lines: ParsedLine[] = []
  for (const chunk of chunks) {
    for (const raw of chunk.text.split(/\r?\n/)) {
      if (!raw && chunk.text.endsWith('\n')) continue
      const text = raw.replace(ansiPattern, '')
      const match = text.match(locationPattern)
      lines.push({
        text,
        raw,
        stream: chunk.stream,
        sequence: chunk.sequence,
        path: match?.[1]?.replace(/\\/g, '/'),
        line: match ? Number(match[2]) : undefined,
        column: match?.[3] ? Number(match[3]) : 1,
      })
    }
  }
  return lines
}

function renderAnsi(raw: string) {
  const segments: Array<{ text: string; className: string }> = []
  const expression = /\x1b\[([0-9;]*)m/g
  let index = 0
  let className = ''
  for (const match of raw.matchAll(expression)) {
    const offset = match.index ?? 0
    if (offset > index) segments.push({ text: raw.slice(index, offset), className })
    for (const code of (match[1] || '0').split(';').map(Number)) {
      if (code === 0 || code === 39) className = ''
      else if (code === 1) className = `${className} font-semibold`.trim()
      else if (code === 31 || code === 91) className = 'text-danger'
      else if (code === 32 || code === 92) className = 'text-success'
      else if (code === 33 || code === 93) className = 'text-warning'
      else if ([34, 35, 36, 94, 95, 96].includes(code)) className = 'text-accent'
      else if (code === 90) className = 'text-text-4'
      else if (code === 37 || code === 97) className = 'text-text-1'
    }
    index = offset + match[0].length
  }
  if (index < raw.length) segments.push({ text: raw.slice(index), className })
  return segments.map((segment, segmentIndex) => <span key={segmentIndex} className={segment.className}>{segment.text}</span>)
}

const LEVEL_TEXT: Record<ConsoleLogLevel, string> = {
  error: 'text-danger',
  warn: 'text-warning',
  info: 'text-text-1',
  debug: 'text-text-4',
  success: 'text-success',
}

const LEVEL_TOKEN: Record<ConsoleLogLevel, string> = {
  error: 'rounded-[3px] bg-danger/15 px-1 font-semibold text-danger',
  warn: 'rounded-[3px] bg-warning/15 px-1 font-semibold text-warning',
  info: 'rounded-[3px] bg-accent/12 px-1 font-semibold text-accent',
  debug: 'rounded-[3px] bg-surface-3 px-1 font-semibold text-text-3',
  success: 'font-semibold text-success',
}

/**
 * Una riga senza ANSI viene colorata dal suo livello di log (timestamp attenuato, livello in evidenza);
 * con ANSI vince il colore scelto dal programma. Lo stderr non è rosso di default: il pacchetto log
 * di Go ci scrive tutto. Restano rossi gli errori di compilazione (riga con file:linea).
 */
function consoleLineClass(line: ParsedLine, level: ConsoleLogLevel | null): string {
  if (level) return LEVEL_TEXT[level]
  if (line.stream === 'system') return 'text-text-4'
  return line.stream === 'stderr' && line.path ? 'text-danger' : 'text-text-2'
}

function renderConsoleLine(line: ParsedLine, level: ConsoleLogLevel | null) {
  if (line.raw !== line.text || !level) return renderAnsi(line.raw)
  return consoleSegments(line.text).map((segment, index) => (
    <span key={index} className={segment.kind === 'timestamp' ? 'text-text-4' : segment.kind === 'level' ? LEVEL_TOKEN[level] : undefined}>{segment.text}</span>
  ))
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${milliseconds} ms`
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(1)} s`
  return `${Math.floor(milliseconds / 60_000)}m ${Math.round((milliseconds % 60_000) / 1000)}s`
}

function executionDetails(execution: GoIDEExecution): string {
  const parts = [execution.status]
  if (execution.pid) parts.push(`PID ${execution.pid}`)
  if (execution.status !== 'running') {
    if (execution.exitCode !== undefined && execution.exitCode !== null) parts.push(`exit ${execution.exitCode}`)
    parts.push(formatDuration(execution.durationMillis))
  }
  return parts.join(' · ')
}

/** Nome breve di un'esecuzione nella barra dei servizi: l'ultima cartella di lavoro, altrimenti il tipo. */
function executionLabel(execution: GoIDEExecution): string {
  const folder = execution.workingDirectory.replace(/\\/g, '/').split('/').filter(Boolean).pop()
  return folder ? `${folder} · ${execution.kind}` : execution.kind
}

const TOOL_WINDOW_TITLES: Record<GoIDEToolWindow, string> = {
  run: 'Run',
  problems: 'Problems',
  references: 'Usages',
  find: 'Find in Files',
  tests: 'Tests',
  debug: 'Debug',
  todo: 'TODO',
  terminal: 'Terminal',
  context: 'Context',
  profile: 'Performance',
  trace: 'Trace',
  sonar: 'SonarQube',
  vulns: 'Security',
  fuzz: 'Fuzzing',
  errors: 'Error Handling',
  architecture: 'Architecture',
  impact: 'Impact',
  interfaces: 'Interfaces',
  goroutines: 'Goroutines',
  docs: 'Documentation',
  config: 'Config & Environment',
  git: 'Git',
  go: 'Go',
  preview: 'Live Preview',
}

const STATUS_DOT: Record<string, string> = {
  running: 'bg-success animate-pulse',
  exited: 'bg-success',
  failed: 'bg-danger',
  stopped: 'bg-warning',
}

function statusClass(status: string): string {
  if (status === 'running') return 'text-success'
  if (status === 'failed') return 'text-danger'
  if (status === 'stopped') return 'text-warning'
  return 'text-text-3'
}

/** Memoizzato: il pannello genitore si ridisegna a ogni tasto, questo solo quando cambia la sessione. */
/** Righe disegnate nella Run console; le precedenti restano nel buffer e si aprono a richiesta (REFACTOR.md voce 7). */
export const CodeStudioRunPanel = memo(function CodeStudioRunPanel({ session, fixedView, logsOnly = false, standalone = false, visible = true, onCommand }: CodeStudioRunPanelProps) {
  const sessionId = session.id
  const selectedView = useCodeStudioLspStore((state) => state.toolWindow)
  const view = fixedView ?? selectedView
  const tool = view === 'terminal' ? 'terminal' : logsOnly ? 'logs' : 'run'
  const detached = useStudioTools((state) => state.detached.includes(toolKey(sessionId, tool))) && !standalone
  const terminalDetached = useStudioTools((state) => state.detached.includes(toolKey(sessionId, 'terminal'))) && !standalone
  const showToolWindow = useCodeStudioLspStore((state) => state.showToolWindow)
  const reports = useCodeStudioLspStore((state) => state.diagnostics[sessionId])
  const lintReports = useCodeStudioLspStore((state) => state.lint[sessionId]?.reports)
  const [search, setSearch] = useToolView(sessionId, tool, 'filter', '')
  const [input, setInput] = useToolView(sessionId, tool, 'stdin', '')
  const allExecutions = useCodeStudioStore((state) => state.executions)
  const executions = useMemo(() => allExecutions.filter((execution) => execution.sessionId === sessionId), [allExecutions, sessionId])
  const activeRunId = useCodeStudioStore((state) => state.activeRunBySession[sessionId] ?? null)
  const consoleByRun = useCodeStudioStore((state) => state.consoleByRun)
  const stopRun = useCodeStudioStore((state) => state.stopRun)
  const restartRun = useCodeStudioStore((state) => state.restartRun)
  const sendRunInput = useCodeStudioStore((state) => state.sendRunInput)
  const openLocation = useCodeStudioStore((state) => state.openLocation)
  const active = executions.find((execution) => execution.id === activeRunId) ?? executions[executions.length - 1] ?? null
  // Una nuova esecuzione porta in primo piano la finestra Run, come in GoLand; i test hanno la loro finestra.
  const seenRunId = useRef(activeRunId)
  useEffect(() => {
    if (standalone || fixedView || !activeRunId || activeRunId === seenRunId.current) return
    seenRunId.current = activeRunId
    const started = executions.find((execution) => execution.id === activeRunId)
    if (started?.status === 'running' && started.kind !== 'tests' && started.kind !== 'devserver') showToolWindow('run')
  }, [activeRunId, executions, showToolWindow, standalone, fixedView])
  const chunks = active ? consoleByRun[active.id] ?? [] : []
  const lines = useMemo(() => parseLines(chunks), [chunks])
  const buildSteps = useMemo(() => active?.kind === 'docker-build' ? buildKitProgress(chunks.map(chunk=>chunk.text).join('')) : [], [active?.kind, chunks])
  const buildProblems = useMemo<CodeStudioBuildProblem[]>(() => lines
    .filter((line) => line.path && line.line)
    .map((line) => ({ path: resolveConsolePath(line.path!, active?.workingDirectory ?? ''), line: line.line!, column: line.column ?? 1, text: line.text })), [active?.workingDirectory, lines])
  const counts = diagnosticCounts(mergedReports(reports, lintReports))
  const debugState = useCodeStudioDebugStore(selectDebugState(sessionId))
  const failedTests = useCodeStudioTestsStore((state) => selectedTestRun(state, sessionId)?.summary.failed ?? 0)
  const problemCount = counts.errors + counts.warnings + buildProblems.length
  // "Service logs" vive dentro Run: la barra in alto sceglie il servizio e può nascondere le righe di sistema.
  const [serviceLogs, setServiceLogs] = useToolView(sessionId, tool, 'serviceLogs', false)
  const onlyLogs = logsOnly || serviceLogs
  const matchingLines = lines.filter((line) => (!onlyLogs || line.stream !== 'system') && (!search || line.text.toLowerCase().includes(search.toLowerCase())))
  // Output intenso: si disegna solo la coda, con "mostra precedenti" a richiesta; Copy e la
  // ricerca lavorano comunque su tutto il buffer (4 MB). Con la ricerca attiva la finestra
  // si apre al cap per non nascondere i match vecchi.
  const [consoleWindow, setConsoleWindow] = useState(CONSOLE_WINDOW)
  const windowStart = consoleVisibleStart(matchingLines.length, consoleWindow, Boolean(search))
  const hiddenLines = windowStart.hidden
  const visibleLines = matchingLines.slice(windowStart.start)

  const submitInput = async () => {
    if (!active || !input) return
    await sendRunInput(active.id, `${input}\n`)
    setInput('')
  }

  const hide = () => logsOnly ? useStudioTools.setState((state) => ({ views: { ...state.views, [toolKey(sessionId, 'logs')]: { ...state.views[toolKey(sessionId, 'logs')], open: false } } })) : useCodeStudioStore.getState().updateLayout({ bottomOpen: false })

  return (
    <section aria-label="Code Studio tool window" className="flex h-full min-h-0 flex-col">
      <div className="code-studio-tool-header">
        <span className="code-studio-tool-title pr-2">{logsOnly ? 'Service logs' : TOOL_WINDOW_TITLES[view]}</span>
        {view === 'problems' && <span className={`rounded-full px-1.5 text-[10.5px] font-semibold ${counts.errors || buildProblems.length ? 'bg-danger/15 text-danger' : counts.warnings ? 'bg-warning/15 text-warning' : 'bg-surface-3 text-text-3'}`}>{problemCount}</span>}
        {view === 'tests' && failedTests > 0 && <span className="rounded-full bg-danger/15 px-1.5 text-[10.5px] font-semibold text-danger">{failedTests} failed</span>}
        {view === 'debug' && debugState !== 'none' && <span className={`flex items-center gap-1.5 text-[11px] ${debugState === 'stopped' ? 'text-warning' : 'text-success'}`}><span className={`h-1.5 w-1.5 rounded-full ${debugState === 'stopped' ? 'bg-warning' : 'bg-success'}`} />{debugState === 'stopped' ? 'Paused' : 'Debugging'}</span>}
        {view === 'run' && active && <>
          <select
            aria-label="Active run"
            value={active.id}
            onChange={(event) => void selectToolRun(sessionId, tool, event.target.value)}
            className="h-7 max-w-60 rounded-lg border-0 bg-[var(--gs-raised)] px-2.5 font-mono text-[11.5px] text-text-1 outline-none focus:ring-1 focus:ring-accent"
          >
            {executions.map((execution) => <option key={execution.id} value={execution.id}>{execution.kind} · {execution.id.slice(-6)} · {execution.status}</option>)}
          </select>
          <span className={`ml-2 flex min-w-0 items-center gap-1.5 truncate font-mono text-[11px] ${statusClass(active.status)}`} title={`${active.command}\n${active.workingDirectory}`}>
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[active.status] ?? 'bg-text-4'}`} aria-hidden="true" />
            <span className="truncate">{executionDetails(active)}</span>
          </span>
        </>}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {view === 'run' && (
            <label className="mr-1 flex h-7 w-52 items-center gap-2 rounded-lg bg-[var(--gs-ground)] px-2.5 text-text-4 focus-within:ring-1 focus-within:ring-accent">
              <Search size={12} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find in output" aria-label="Filter console output" className="min-w-0 flex-1 bg-transparent text-[11.5px] text-text-2 outline-none" />
            </label>
          )}
          {(view === 'run' || view === 'terminal') && !standalone && <StudioToolControls session={sessionId} tool={tool} />}
          {!standalone && <button type="button" onClick={hide} aria-label="Hide tool window" title="Hide · Alt+4" className="code-studio-icon-button h-7 w-7"><Minus size={14} /></button>}
        </div>
      </div>
      {view === 'run' && !detached && <div className="flex min-h-0 flex-1">
        <div className="flex w-11 shrink-0 flex-col items-center gap-0.5 pt-0.5" role="toolbar" aria-label="Run actions" aria-orientation="vertical">
          <button type="button" onClick={() => active && void restartRun(active.id)} disabled={!active || active.kind === 'dependency' || active.kind === 'install'} aria-label="Rerun" title="Rerun" className="code-studio-icon-button h-7 w-7 text-success"><RefreshCw size={14} /></button>
          <button type="button" onClick={() => active && void stopRun(active.id)} disabled={active?.status !== 'running'} aria-label="Stop" title="Stop process tree" className="code-studio-icon-button h-7 w-7 text-danger"><Square size={11} fill="currentColor" /></button>
          <span className="my-1 h-px w-4 bg-border-1" aria-hidden="true" />
          <button type="button" disabled={!chunks.length} onClick={() => void WailsClipboard.SetText(chunks.map((chunk) => chunk.text).join(''))} aria-label="Copy console" title="Copy console" className="code-studio-icon-button h-7 w-7"><Copy size={13} /></button>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
        {executions.length > 1 && (
          <div role="tablist" aria-label="Service logs" className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b border-border-1 px-2">
            {executions.map((execution) => (
              <button key={execution.id} type="button" role="tab" aria-selected={execution.id === active?.id} onClick={() => void selectToolRun(sessionId, tool, execution.id)} title={`${execution.command}\n${execution.workingDirectory}`}
                className={`flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px] ${execution.id === active?.id ? 'bg-[var(--gs-raised)] text-text-1' : 'text-text-3 hover:bg-surface-3'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[execution.status] ?? 'bg-text-4'}`} aria-hidden="true" />
                <span className="max-w-40 truncate">{executionLabel(execution)}</span>
              </button>
            ))}
            <button type="button" aria-pressed={serviceLogs} onClick={() => setServiceLogs(!serviceLogs)} title="Show only the service's own output, without adOmnia's system lines"
              className={`ml-auto h-6 shrink-0 rounded-md px-2 text-[10.5px] font-semibold ${serviceLogs ? 'bg-accent/15 text-text-1' : 'text-text-3 hover:bg-surface-3'}`}>Logs only</button>
          </div>
        )}
        {buildSteps.length > 0 && <details className="max-h-40 shrink-0 overflow-auto border-b border-border-1 px-3 py-2 text-[11px]">
          <summary className="cursor-pointer text-accent">BuildKit · {buildSteps.filter(step=>step.state==='done'||step.state==='cached').length}/{buildSteps.length} steps · {buildSteps.filter(step=>step.state==='cached').length} cached</summary>
          {buildSteps.map(step=><p key={step.id} className={step.state==='error'?'text-danger':'text-text-3'}>#{step.id} · {step.state} · {step.title} {step.duration ?? ''}</p>)}
        </details>}
        <div className="min-h-0 flex-1 overflow-auto px-3.5 pb-2 pt-1 text-[12.5px] leading-[21px]" style={{ fontFamily: 'var(--skin-font-mono, var(--font-mono))', fontVariantLigatures: 'none' }}>
          {!active && <p className="font-sans text-text-4">Build or run the project, or press ▶ next to func main or a test, to open a real console.</p>}
          {active && visibleLines.length === 0 && <p className="text-text-4">Waiting for output…</p>}
          {hiddenLines > 0 && (
            <button
              type="button"
              onClick={() => setConsoleWindow((value) => Math.min(value + CONSOLE_WINDOW_STEP, MAX_RENDERED_LINES))}
              className="font-sans text-[11px] text-text-4 underline decoration-dotted underline-offset-2 hover:text-text-2"
            >
              {Math.min(hiddenLines, CONSOLE_WINDOW_STEP).toLocaleString()} earlier lines not shown · show more (search and Copy console use the full output)
            </button>
          )}
          {visibleLines.map((line, index) => {
            const level = line.stream === 'system' ? null : consoleLogLevel(line.text)
            return (
            <div key={`${line.sequence}-${index}`} className={`code-studio-console-line min-h-5 whitespace-pre-wrap break-all ${consoleLineClass(line, level)}`}>
              {line.path && line.line ? (
                <button type="button" onClick={() => void openLocation(resolveConsolePath(line.path!, active?.workingDirectory ?? ''), line.line!, line.column)} className="text-left underline decoration-accent/40 underline-offset-2 hover:text-accent">{renderConsoleLine(line, level)}</button>
              ) : renderConsoleLine(line, level)}
            </div>
            )
          })}
        </div>
        {active?.status === 'running' && active.kind === 'run' && (
          <form onSubmit={(event) => { event.preventDefault(); void submitInput() }} className="flex h-9 shrink-0 items-center border-t border-border-1 px-3">
            <span className="mr-2 font-mono text-[11px] text-accent">stdin ›</span>
            <input value={input} onChange={(event) => setInput(event.target.value)} aria-label="Program input" className="min-w-0 flex-1 bg-transparent font-mono text-[11.5px] text-text-1 outline-none" placeholder="Type input and press Enter" />
          </form>
        )}
        </div>
      </div>}
      {view === 'problems' && <div className="min-h-0 flex-1 overflow-auto"><CodeStudioProblems sessionId={sessionId} buildProblems={buildProblems} onOpenBuildProblem={(problem) => void openLocation(problem.path, problem.line, problem.column)} /></div>}
      {view === 'references' && <div className="min-h-0 flex-1 overflow-auto"><CodeStudioReferences sessionId={sessionId} /></div>}
      {view === 'find' && <div className="min-h-0 flex-1"><CodeStudioFindInFiles sessionId={sessionId} /></div>}
      {view === 'tests' && <div className="min-h-0 flex-1"><CodeStudioTestsPanel session={session} /></div>}
      {view === 'debug' && <div className="min-h-0 flex-1"><CodeStudioDebugPanel session={session} /></div>}
      {view === 'todo' && <div className="min-h-0 flex-1"><CodeStudioTodoPanel sessionId={sessionId} /></div>}
      {view === 'preview' && <div className="min-h-0 flex-1"><CodeStudioLivePreview session={session} embedded /></div>}
      {view === 'context' && <div className="min-h-0 flex-1"><CodeStudioContextPanel sessionId={sessionId} /></div>}
      {view === 'profile' && <div className="min-h-0 flex-1"><CodeStudioProfilePanel session={session} /></div>}
      {view === 'trace' && <div className="min-h-0 flex-1"><CodeStudioTracePanel session={session} /></div>}
      {view === 'sonar' && <div className="min-h-0 flex-1"><CodeStudioSonarPanel session={session} /></div>}
      {view === 'docs' && <div className="min-h-0 flex-1"><CodeStudioDocsPanel session={session} /></div>}
      {view === 'architecture' && <div className="min-h-0 flex-1"><CodeStudioArchitecturePanel session={session} /></div>}
      {view === 'impact' && <div className="min-h-0 flex-1"><CodeStudioImpactPanel session={session} /></div>}
      {view === 'config' && <div className="flex min-h-0 flex-1 flex-col"><CodeStudioConfigPanel session={session} /></div>}
      {view === 'interfaces' && <div className="min-h-0 flex-1"><CodeStudioArchitecturePanel session={session} initialTab="interfaces" /></div>}
      {view === 'goroutines' && <div className="min-h-0 flex-1"><CodeStudioArchitecturePanel session={session} initialTab="goroutines" /></div>}
      {view === 'errors' && <div className="min-h-0 flex-1"><CodeStudioErrorsPanel session={session} /></div>}
      {view === 'fuzz' && <div className="min-h-0 flex-1"><CodeStudioFuzzPanel session={session} /></div>}
      {view === 'vulns' && <div className="min-h-0 flex-1"><CodeStudioSecurityPanel session={session} /></div>}
      {view === 'git' && <div className="min-h-0 flex-1"><CodeStudioGitPanel session={session} onCommand={onCommand} /></div>}
      {view === 'go' && <div className="min-h-0 flex-1"><CodeStudioGoPanel session={session} /></div>}
      {/* Il terminale resta montato quando si cambia scheda: una shell interattiva non si distrugge. */}
      {!terminalDetached && !logsOnly && <div className="min-h-0 flex-1" style={{ display: view === 'terminal' ? 'block' : 'none' }}><CodeStudioTerminalPanel session={session} visible={view === 'terminal' && visible} /></div>}
    </section>
  )
})
