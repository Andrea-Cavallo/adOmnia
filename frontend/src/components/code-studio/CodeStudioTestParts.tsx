import { useEffect, useMemo, useState } from 'react'
import { Bug, CheckCircle2, ChevronDown, ChevronRight, CircleDashed, Clock3, Copy, Gauge, Loader2, MinusCircle, Play, Repeat, Shuffle, ShieldCheck, XCircle } from 'lucide-react'
import { Clipboard as WailsClipboard } from '@wailsio/runtime'
import { getGoIDETestOutput, type GoIDECoverageReport, type GoIDETestResult, type GoIDETestRun } from '@/lib/code-studio-tests-api'
import { requestWorkspaceSymbols } from '@/lib/code-studio-lsp-api'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { selectedTestRun, useCodeStudioTestsStore } from '@/stores/codeStudioTests'
import { cpuCorrelationRequestForNode, cpuCorrelationVerdict, debugRequestForNode, isJavaTestRun, javaDebugRequestForNode, failureRateByCPU, flakyCauses, formatDuration, isFailed, isFlaky, isGoTestRun, raceRepeatRequestForNode, reproduceCommandFor, repeatRequestForNode, repetitionStats, reproduceRequest, type CodeStudioTestNode } from '@/lib/code-studio/codeStudioTestTree'
import { useCodeStudioDebugStore } from '@/stores/codeStudioDebug'
import { functionsByCoverage, untakenBranches } from './codeStudioCoverage'
import { CodeStudioPatchCoverage } from './CodeStudioPatchCoverage'
import { type CodeStudioFlakyRecord } from './codeStudioFlakyHistory'
import { navigateToLocation } from './codeStudioLanguageFeatures'
import { benchmarkMeasurementFor } from './codeStudioBenchmarks'
import { type CodeStudioBenchmarkCompareSettings, type CodeStudioBenchmarkHistoryEntry } from './codeStudioBenchmarkHistory'
import { CodeStudioBenchmarkDetail } from './CodeStudioBenchmarkDetail'
import { testFailureDraft } from '@/lib/code-studio/testFailureAI'
import { isChatPane, useCodeStudioAssistantStore } from '@/stores/codeStudioAssistant'

const OUTPUT_LOCATION = /^(\s+)([\w.\-/]+\.go):(\d+)(:.*)$/

export function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'pass': return <CheckCircle2 size={12} className="shrink-0 text-success" aria-label="passed" />
    case 'fail': return <XCircle size={12} className="shrink-0 text-danger" aria-label="failed" />
    case 'timeout': return <Clock3 size={12} className="shrink-0 text-danger" aria-label="timed out" />
    case 'skip': return <MinusCircle size={12} className="shrink-0 text-text-4" aria-label="skipped" />
    case 'bench': return <Gauge size={12} className="shrink-0 text-accent" aria-label="benchmark" />
    case 'running': return <Loader2 size={12} className="shrink-0 animate-spin text-accent" aria-label="running" />
    default: return <CircleDashed size={12} className="shrink-0 text-text-4" aria-label={status} />
  }
}

export function packageDirectory(run: GoIDETestRun, pkg: string): string {
  return run.results.find((result) => result.package === pkg && !result.name)?.directory ?? run.request.workingDirectory
}

/** Apre il fallimento se noto, altrimenti cerca la funzione di test tramite gopls. */
export async function openTest(sessionId: string, run: GoIDETestRun, result: GoIDETestResult): Promise<void> {
  const store = useCodeStudioStore.getState()
  if (result.failure?.relativePath) return void store.openLocation(result.failure.relativePath, result.failure.line, 1)
  const name = (result.name ?? '').split('/')[0]
  if (!name) return
  const symbols = await requestWorkspaceSymbols(sessionId, name).catch(() => [])
  const directory = packageDirectory(run, result.package)
  const match = symbols.find((symbol) => symbol.name === name && (symbol.location.relativePath ?? '').startsWith(directory ? `${directory}/` : ''))
  if (match) navigateToLocation(match.location)
}

export function TestRow({ node, depth, selected, run, sessionId, records, entry = false }: { node: CodeStudioTestNode; depth: number; selected: string | null; run: GoIDETestRun; sessionId: string; records: Map<string, CodeStudioFlakyRecord>; entry?: boolean }) {
  const [open, setOpen] = useState(depth === 0 || node.children.some((child) => isFailed(child.result)))
  const selectNode = useCodeStudioTestsStore((state) => state.selectNode)
  const rerunNode = useCodeStudioTestsStore((state) => state.rerunNode)
  const { result } = node
  const goRun = isGoTestRun(run)
  const active = selected === result.id
  const record = result.name && !isFlaky(result) ? records.get(`${result.package}\u0000${result.name}`) : undefined
  return (
    <>
      <div
        role="treeitem"
        tabIndex={active || (entry && selected === null) ? 0 : -1}
        aria-selected={active}
        aria-expanded={node.children.length ? open : undefined}
        onClick={() => selectNode(sessionId, result.id)}
        onFocus={() => selectNode(sessionId, result.id)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); void openTest(sessionId, run, result) }
          if (event.key === 'ArrowRight' && node.children.length) { event.preventDefault(); setOpen(true) }
          if (event.key === 'ArrowLeft' && node.children.length) { event.preventDefault(); setOpen(false) }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            const rows = [...(event.currentTarget.closest('[role="tree"]')?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])]
            rows[rows.indexOf(event.currentTarget) + (event.key === 'ArrowDown' ? 1 : -1)]?.focus()
          }
        }}
        onDoubleClick={() => void openTest(sessionId, run, result)}
        className={`group flex h-6 cursor-default items-center gap-1.5 pr-2 text-[13px] outline-none focus-visible:ring-1 focus-visible:ring-accent ${active ? 'bg-accent/15 text-text-1' : 'text-text-2 hover:bg-surface-3'}`}
        style={{ paddingLeft: 6 + depth * 14 }}
      >
        {node.children.length > 0
          ? <button type="button" aria-label={open ? 'Collapse' : 'Expand'} onClick={(event) => { event.stopPropagation(); setOpen((value) => !value) }} className="grid h-4 w-4 place-items-center text-text-4">{open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</button>
          : <span className="w-4" />}
        <StatusIcon status={result.status} />
        <span className={`truncate ${result.name ? 'font-mono' : 'font-medium'}`}>{node.label}</span>
        {result.buildFailed && <span className="shrink-0 rounded bg-danger/15 px-1 text-[11px] text-danger">build failed</span>}
        {isFlaky(result) && <span title={`Failed ${result.failures} of ${result.runs} runs`} className="shrink-0 rounded bg-warning/15 px-1 text-[11px] font-semibold text-warning">flaky {result.failures}/{result.runs}</span>}
        {record && <span title={`Flaky in ${record.occurrences} earlier repeated run${record.occurrences === 1 ? '' : 's'}: failed ${record.failures} of ${record.runs} repetitions, last on ${new Date(record.lastSeen).toLocaleString()}`} className="shrink-0 rounded border border-warning/40 px-1 text-[11px] text-warning">was flaky</span>}
        {result.benchmark && <span className="truncate font-mono text-[12px] text-accent">{result.benchmark}</span>}
        <span className="ml-auto shrink-0 text-[11px] text-text-4">{result.status !== 'running' && result.elapsedMillis > 0 ? formatDuration(result.elapsedMillis) : ''}</span>
        {run.status !== 'running' && (
          <button type="button" title={result.name ? `Rerun ${result.name}` : `Rerun ${result.package}`} onClick={(event) => { event.stopPropagation(); void rerunNode(sessionId, result) }} className="grid h-5 w-5 shrink-0 place-items-center rounded text-success opacity-0 hover:bg-success/10 group-hover:opacity-100">
            <Play size={10} fill="currentColor" aria-hidden="true" />
          </button>
        )}
        {goRun && run.status !== 'running' && result.name && !result.name.startsWith('Benchmark') && (
          <button type="button" title={`Run ${result.name} 20 times in random order`} onClick={(event) => { event.stopPropagation(); void useCodeStudioTestsStore.getState().start(repeatRequestForNode(run, result, 20)) }} className="grid h-5 w-5 shrink-0 place-items-center rounded text-accent opacity-0 hover:bg-accent/10 group-hover:opacity-100">
            <Repeat size={10} aria-hidden="true" />
          </button>
        )}
        {isJavaTestRun(run) && run.status !== 'running' && javaDebugRequestForNode(run, result) && (
          <button type="button" title={`Debug ${result.name}`} onClick={(event) => { event.stopPropagation(); const request = javaDebugRequestForNode(run, result); if (request) void useCodeStudioDebugStore.getState().startJava(request) }} className="grid h-5 w-5 shrink-0 place-items-center rounded text-warning opacity-0 hover:bg-warning/10 group-hover:opacity-100">
            <Bug size={10} aria-hidden="true" />
          </button>
        )}
        {goRun && run.status !== 'running' && result.name && (
          <button type="button" title={`Debug ${result.name}`} onClick={(event) => { event.stopPropagation(); const request = debugRequestForNode(run, result); if (request) void useCodeStudioDebugStore.getState().start(request) }} className="grid h-5 w-5 shrink-0 place-items-center rounded text-warning opacity-0 hover:bg-warning/10 group-hover:opacity-100">
            <Bug size={10} aria-hidden="true" />
          </button>
        )}
      </div>
      {open && node.children.map((child) => <TestRow key={child.result.id} node={child} depth={depth + 1} selected={selected} run={run} sessionId={sessionId} records={records} />)}
    </>
  )
}

export function OutputLine({ line, baseDirectory }: { line: string; baseDirectory: string }) {
  const openLocation = useCodeStudioStore((state) => state.openLocation)
  const match = OUTPUT_LOCATION.exec(line)
  if (!match) return <div className="min-h-4 whitespace-pre-wrap break-all">{line}</div>
  const [, indent, file, lineNumber, rest] = match
  const target = file.includes('/') ? file : `${baseDirectory ? `${baseDirectory}/` : ''}${file}`
  return (
    <div className="min-h-4 whitespace-pre-wrap break-all">
      {indent}
      <button type="button" onClick={() => void openLocation(target, Number(lineNumber), 1)} className="underline decoration-accent/40 underline-offset-2 hover:text-accent">{file}:{lineNumber}</button>
      {rest}
    </div>
  )
}

export type CoverageView = 'files' | 'functions' | 'branches' | 'patch'

export function CoverageSummary({ report, sessionId }: { report: GoIDECoverageReport; sessionId: string }) {
  const openDocument = useCodeStudioStore((state) => state.openDocument)
  const openLocation = useCodeStudioStore((state) => state.openLocation)
  const [view, setView] = useState<CoverageView>('files')
  const byFunction = view === 'functions'
  const functions = useMemo(() => (byFunction ? functionsByCoverage(report) : []), [byFunction, report])
  const branches = useMemo(() => (view === 'branches' ? untakenBranches(report) : null), [report, view])
  const bar = (value: number) => (
    <span className="h-1.5 w-20 shrink-0 overflow-hidden rounded bg-danger/25"><span className="block h-full bg-success" style={{ width: `${value}%` }} /></span>
  )
  const tab = (active: boolean) => `rounded px-1.5 py-0.5 text-[12px] ${active ? 'bg-accent/15 text-accent' : 'text-text-3 hover:bg-surface-3 hover:text-text-1'}`
  return (
    <div className="p-2 text-[13px]">
      <div className="mb-2 flex items-center gap-2 text-text-2">
        <ShieldCheck size={12} className="text-success" aria-hidden="true" /> Coverage {report.percent.toFixed(1)}% <span className="text-text-4">· {report.covered}/{report.statements} statements · mode {report.mode}</span>
        <span role="tablist" aria-label="Coverage view" className="ml-auto flex gap-0.5">
          <button type="button" role="tab" aria-selected={view === 'files'} onClick={() => setView('files')} className={tab(view === 'files')}>Files</button>
          <button type="button" role="tab" aria-selected={byFunction} onClick={() => setView('functions')} title="Functions from the least covered" className={tab(byFunction)}>Functions</button>
          <button type="button" role="tab" aria-selected={view === 'branches'} onClick={() => setView('branches')} title="Branches whose condition ran but whose body never did" className={tab(view === 'branches')}>Branches</button>
          <button type="button" role="tab" aria-selected={view === 'patch'} onClick={() => setView('patch')} title="Coverage of the lines changed since a base branch, as in a pull request" className={tab(view === 'patch')}>Patch</button>
        </span>
      </div>
      {byFunction && functions.map((fn) => (
        <button key={`${fn.relativePath}:${fn.line}`} type="button" onClick={() => void openLocation(fn.relativePath, fn.line, 1)} title={`${fn.covered}/${fn.statements} statements`} className="flex h-6 w-full items-center gap-2 text-left text-text-3 hover:bg-surface-3 hover:text-text-1">
          {bar(fn.percent)}<span className="w-12 shrink-0 text-right text-[12px]">{fn.percent.toFixed(1)}%</span><span className="shrink-0 truncate font-mono text-[12px] text-text-1">{fn.name}</span><span className="truncate font-mono text-[12px] text-text-4">{fn.relativePath}:{fn.line}</span>
        </button>
      ))}
      {byFunction && functions.length === 0 && <p className="text-[12px] text-text-4">No functions with statements.</p>}
      {branches && (
        <div>
          <p className="mb-1 text-[12px] text-text-4">{branches.branches.length} of {branches.evaluated} evaluated branches never taken. Go measures statements, so a branch shows here only when its condition ran.</p>
          {branches.branches.map((branch) => (
            <button key={`${branch.relativePath}:${branch.line}:${branch.label}`} type="button" onClick={() => void openLocation(branch.relativePath, branch.line, 1)} className="flex h-6 w-full items-center gap-2 text-left text-text-3 hover:bg-surface-3 hover:text-text-1">
              <span className="w-36 shrink-0 text-[12px] text-warning">{branch.label}</span><span className="truncate font-mono text-[12px]">{branch.relativePath}:{branch.line}</span>
            </button>
          ))}
        </div>
      )}
      {view === 'patch' && <CodeStudioPatchCoverage sessionId={sessionId} report={report} />}
      {view === 'files' && report.packages.map((pkg) => (
        <div key={pkg.importPath} className="mb-1">
          <div className="flex h-6 items-center gap-2 font-medium text-text-2">{bar(pkg.percent)}<span className="w-12 shrink-0 text-right text-[12px]">{pkg.percent.toFixed(1)}%</span><span className="truncate">{pkg.relativePath || pkg.importPath}</span></div>
          {report.files.filter((file) => file.relativePath.startsWith(`${pkg.relativePath}/`) && !file.relativePath.slice(pkg.relativePath.length + 1).includes('/')).map((file) => (
            <button key={file.relativePath} type="button" onClick={() => void openDocument(file.relativePath)} className="flex h-6 w-full items-center gap-2 pl-4 text-left text-text-3 hover:bg-surface-3 hover:text-text-1">
              {bar(file.percent)}<span className="w-12 shrink-0 text-right text-[12px]">{file.percent.toFixed(1)}%</span><span className="truncate font-mono text-[12px]">{file.relativePath.slice(pkg.relativePath.length + 1)}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

/** Esito delle ripetizioni (-count=N) e seed di -shuffle per riprodurre l'ordine. */
export function RepetitionSummary({ run, result, output }: { run: GoIDETestRun; result: GoIDETestResult; output: string | null }) {
  const stats = repetitionStats(result)
  const reproduce = reproduceRequest(run, result)
  const flaky = isFlaky(result)
  const causes = useMemo(() => (flaky && output ? flakyCauses(output, !!run.request.shuffle) : []), [flaky, output, run.request.shuffle])
  const rates = failureRateByCPU(run, result)
  if (!stats && !reproduce) return null
  const start = useCodeStudioTestsStore.getState().start
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-1 bg-surface-2/50 px-3 py-1.5 text-[12px] text-text-3">
      {stats && (
        <>
          <span className={stats.failures === 0 ? 'text-success' : isFlaky(result) ? 'font-semibold text-warning' : 'text-danger'}>
            {stats.failures === 0 ? `Stable · ${stats.runs} runs` : `${isFlaky(result) ? 'Flaky' : 'Always failing'} · failed ${stats.failures}/${stats.runs} (${Math.round(stats.failureRate * 100)}%)`}
          </span>
          <span title="Duration distribution across runs">min {formatDuration(stats.minMillis)} · avg {formatDuration(stats.avgMillis)} · max {formatDuration(stats.maxMillis)}</span>
        </>
      )}
      {reproduce && (
        <button type="button" disabled={run.status === 'running'} onClick={() => void start(reproduce)} title="Rerun this package with the same -shuffle seed to reproduce the test order" className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-accent hover:bg-accent/10 disabled:opacity-30">
          <Shuffle size={10} aria-hidden="true" /> seed {result.shuffleSeed}
        </button>
      )}
      {flaky && !run.request.race && (
        <button type="button" disabled={run.status === 'running'} onClick={() => void start(raceRepeatRequestForNode(run, result, stats?.runs ?? 20))} title="Repeat with the race detector to confirm or rule out a concurrency cause" className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-accent hover:bg-accent/10 disabled:opacity-30">
          <Repeat size={10} aria-hidden="true" /> ×{stats?.runs ?? 20} with -race
        </button>
      )}
      {flaky && !run.request.cpu?.length && (
        <button type="button" disabled={run.status === 'running'} onClick={() => void start(cpuCorrelationRequestForNode(run, result, 10))} title="Repeat 10 times at GOMAXPROCS 1, 2, 4 and 8 to see whether failures follow parallelism" className="flex items-center gap-1 rounded px-1.5 py-0.5 text-accent hover:bg-accent/10 disabled:opacity-30">
          <Gauge size={10} aria-hidden="true" /> correlate with GOMAXPROCS
        </button>
      )}
      {rates.length > 0 && (
        <div className="w-full">
          <div className="flex flex-wrap gap-x-3 font-mono">
            {rates.map((item) => <span key={item.cpu} className={item.failures ? 'text-warning' : 'text-success'}>GOMAXPROCS {item.cpu}: {item.failures}/{item.runs} failed</span>)}
          </div>
          <div className="text-text-2">{cpuCorrelationVerdict(rates)}</div>
        </div>
      )}
      {causes.length > 0 && (
        <ul className="w-full list-none text-text-2" aria-label="Possible causes">
          {causes.map((cause) => <li key={cause}><span className="text-warning">Possible cause:</span> {cause}</li>)}
        </ul>
      )}
    </div>
  )
}

export interface BenchmarkContext {
  history: CodeStudioBenchmarkHistoryEntry[]
  branch?: string
  settings: CodeStudioBenchmarkCompareSettings
  onSettingsChange: (settings: CodeStudioBenchmarkCompareSettings) => void
}

export function TestDetail({ run, result, runs, benchmark }: { run: GoIDETestRun; result: GoIDETestResult; runs: GoIDETestRun[]; benchmark: BenchmarkContext }) {
  const [output, setOutput] = useState<string | null>(null)
  const [aiBusy, setAIBusy] = useState(false)
  const [aiError, setAIError] = useState<string | null>(null)
  const openLocation = useCodeStudioStore((state) => state.openLocation)
  useEffect(() => {
    let cancelled = false
    setOutput(null)
    setAIError(null)
    void getGoIDETestOutput(run.runId, result.id).then((text) => { if (!cancelled) setOutput(text) }).catch(() => { if (!cancelled) setOutput('') })
    return () => { cancelled = true }
  }, [run.runId, result.id, result.status])
  const baseDirectory = result.buildFailed ? run.request.workingDirectory : packageDirectory(run, result.package)
  const analyzeFailure = async () => {
    setAIBusy(true)
    setAIError(null)
    try {
      const root = useCodeStudioStore.getState().sessions.find((session) => session.id === run.sessionId)?.project.realPath
      if (!root) throw new Error('The project is no longer open.')
      const draft = await testFailureDraft(run, result, output ?? '', root)
      const state = useCodeStudioTestsStore.getState()
      if (useCodeStudioStore.getState().activeSessionId !== run.sessionId || state.selectedNode[run.sessionId] !== result.id || selectedTestRun(state, run.sessionId)?.runId !== run.runId) return
      const assistant = useCodeStudioAssistantStore.getState()
      assistant.openWithDraft(isChatPane(assistant.pane) ? assistant.pane : 'milk', draft)
    } catch (reason) {
      setAIError(reason instanceof Error ? reason.message : String(reason))
    } finally { setAIBusy(false) }
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border-1 px-3 py-1.5 text-[13px]">
        <StatusIcon status={result.status} />
        <span className="truncate font-mono text-text-1">{result.name || result.package}</span>
        {result.failure?.relativePath && (
          <button type="button" onClick={() => void openLocation(result.failure!.relativePath!, result.failure!.line, 1)} className="shrink-0 font-mono text-[12px] text-danger underline decoration-danger/40 underline-offset-2">{result.failure.relativePath}:{result.failure.line}</button>
        )}
        <span className="ml-auto shrink-0 text-[12px] text-text-4">{result.elapsedMillis > 0 ? formatDuration(result.elapsedMillis) : ''}</span>
        {isFailed(result) && <button type="button" onClick={() => void analyzeFailure()} disabled={aiBusy || !output?.trim()} title="Prepare a failure analysis draft in AI chat; review it before sending" className="shrink-0 rounded border border-border-2 px-1.5 py-0.5 text-text-2 hover:border-accent hover:text-accent disabled:opacity-40">{aiBusy ? 'Preparing…' : 'Analyze failure'}</button>}
        <button type="button" onClick={() => void WailsClipboard.SetText(reproduceCommandFor(run, result))} title="Copy the go test command that reproduces this run (filter, repetitions, -shuffle seed, -race, tags)" className="grid h-5 w-5 shrink-0 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1">
          <Copy size={10} aria-hidden="true" />
        </button>
      </div>
      <RepetitionSummary run={run} result={result} output={output} />
      {aiError && <p role="alert" className="shrink-0 px-3 py-1 text-[13px] text-danger">{aiError}</p>}
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[12px] leading-4 text-text-2">
        {benchmarkMeasurementFor(result)
          ? <CodeStudioBenchmarkDetail run={run} result={result} runs={runs} {...benchmark} />
          : output === null ? <Loader2 size={12} className="animate-spin text-text-4" /> : output ? output.split('\n').map((line, index) => <OutputLine key={index} line={line} baseDirectory={baseDirectory} />) : <span className="text-text-4">No output.</span>}
        {result.truncated && <div className="mt-1 text-text-4">Output truncated at 64 KB.</div>}
      </div>
    </div>
  )
}
