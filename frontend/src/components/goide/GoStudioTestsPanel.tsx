import { memo, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronRight, CircleDashed, Clock3, Filter, Gauge, Loader2, MinusCircle, Play, RotateCcw, ShieldCheck, Square, XCircle, Bug } from 'lucide-react'
import type { GoIDESession } from '@/lib/goide-api'
import { getGoIDETestOutput, type GoIDECoverageReport, type GoIDETestResult, type GoIDETestRun } from '@/lib/goide-tests-api'
import { requestWorkspaceSymbols } from '@/lib/goide-lsp-api'
import { useGoIDEStore } from '@/stores/goide'
import { selectedTestRun, useGoIDETestsStore } from '@/stores/goideTests'
import { buildTestTree, debugRequestForNode, formatDuration, isFailed, onlyFailed, type GoStudioTestNode } from './goStudioTestTree'
import { useGoIDEDebugStore } from '@/stores/goideDebug'
import { navigateToLocation } from './goStudioLanguageFeatures'

interface GoStudioTestsPanelProps {
  session: GoIDESession
}

const OUTPUT_LOCATION = /^(\s+)([\w.\-/]+\.go):(\d+)(:.*)$/

function StatusIcon({ status }: { status: string }) {
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

function packageDirectory(run: GoIDETestRun, pkg: string): string {
  return run.results.find((result) => result.package === pkg && !result.name)?.directory ?? run.request.workingDirectory
}

/** Apre il fallimento se noto, altrimenti cerca la funzione di test tramite gopls. */
async function openTest(sessionId: string, run: GoIDETestRun, result: GoIDETestResult): Promise<void> {
  const store = useGoIDEStore.getState()
  if (result.failure?.relativePath) return void store.openLocation(result.failure.relativePath, result.failure.line, 1)
  const name = (result.name ?? '').split('/')[0]
  if (!name) return
  const symbols = await requestWorkspaceSymbols(sessionId, name).catch(() => [])
  const directory = packageDirectory(run, result.package)
  const match = symbols.find((symbol) => symbol.name === name && (symbol.location.relativePath ?? '').startsWith(directory ? `${directory}/` : ''))
  if (match) navigateToLocation(match.location)
}

function TestRow({ node, depth, selected, run, sessionId, entry = false }: { node: GoStudioTestNode; depth: number; selected: string | null; run: GoIDETestRun; sessionId: string; entry?: boolean }) {
  const [open, setOpen] = useState(depth === 0 || node.children.some((child) => isFailed(child.result)))
  const selectNode = useGoIDETestsStore((state) => state.selectNode)
  const rerunNode = useGoIDETestsStore((state) => state.rerunNode)
  const { result } = node
  const active = selected === result.id
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
        className={`group flex h-6 cursor-default items-center gap-1.5 pr-2 text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-accent ${active ? 'bg-accent/15 text-text-1' : 'text-text-2 hover:bg-surface-3'}`}
        style={{ paddingLeft: 6 + depth * 14 }}
      >
        {node.children.length > 0
          ? <button type="button" aria-label={open ? 'Collapse' : 'Expand'} onClick={(event) => { event.stopPropagation(); setOpen((value) => !value) }} className="grid h-4 w-4 place-items-center text-text-4">{open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</button>
          : <span className="w-4" />}
        <StatusIcon status={result.status} />
        <span className={`truncate ${result.name ? 'font-mono' : 'font-medium'}`}>{node.label}</span>
        {result.buildFailed && <span className="shrink-0 rounded bg-danger/15 px-1 text-[9px] text-danger">build failed</span>}
        {result.benchmark && <span className="truncate font-mono text-[10px] text-accent">{result.benchmark}</span>}
        <span className="ml-auto shrink-0 text-[9px] text-text-4">{result.status !== 'running' && result.elapsedMillis > 0 ? formatDuration(result.elapsedMillis) : ''}</span>
        {run.status !== 'running' && (
          <button type="button" title={result.name ? `Rerun ${result.name}` : `Rerun ${result.package}`} onClick={(event) => { event.stopPropagation(); void rerunNode(sessionId, result) }} className="grid h-5 w-5 shrink-0 place-items-center rounded text-success opacity-0 hover:bg-success/10 group-hover:opacity-100">
            <Play size={10} fill="currentColor" aria-hidden="true" />
          </button>
        )}
        {run.status !== 'running' && result.name && (
          <button type="button" title={`Debug ${result.name}`} onClick={(event) => { event.stopPropagation(); const request = debugRequestForNode(run, result); if (request) void useGoIDEDebugStore.getState().start(request) }} className="grid h-5 w-5 shrink-0 place-items-center rounded text-warning opacity-0 hover:bg-warning/10 group-hover:opacity-100">
            <Bug size={10} aria-hidden="true" />
          </button>
        )}
      </div>
      {open && node.children.map((child) => <TestRow key={child.result.id} node={child} depth={depth + 1} selected={selected} run={run} sessionId={sessionId} />)}
    </>
  )
}

function OutputLine({ line, baseDirectory }: { line: string; baseDirectory: string }) {
  const openLocation = useGoIDEStore((state) => state.openLocation)
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

function CoverageSummary({ report }: { report: GoIDECoverageReport }) {
  const openDocument = useGoIDEStore((state) => state.openDocument)
  const bar = (value: number) => (
    <span className="h-1.5 w-20 shrink-0 overflow-hidden rounded bg-danger/25"><span className="block h-full bg-success" style={{ width: `${value}%` }} /></span>
  )
  return (
    <div className="p-2 text-[11px]">
      <div className="mb-2 flex items-center gap-2 text-text-2"><ShieldCheck size={12} className="text-success" aria-hidden="true" /> Coverage {report.percent.toFixed(1)}% <span className="text-text-4">· {report.covered}/{report.statements} statements · mode {report.mode}</span></div>
      {report.packages.map((pkg) => (
        <div key={pkg.importPath} className="mb-1">
          <div className="flex h-6 items-center gap-2 font-medium text-text-2">{bar(pkg.percent)}<span className="w-12 shrink-0 text-right text-[10px]">{pkg.percent.toFixed(1)}%</span><span className="truncate">{pkg.relativePath || pkg.importPath}</span></div>
          {report.files.filter((file) => file.relativePath.startsWith(`${pkg.relativePath}/`) && !file.relativePath.slice(pkg.relativePath.length + 1).includes('/')).map((file) => (
            <button key={file.relativePath} type="button" onClick={() => void openDocument(file.relativePath)} className="flex h-6 w-full items-center gap-2 pl-4 text-left text-text-3 hover:bg-surface-3 hover:text-text-1">
              {bar(file.percent)}<span className="w-12 shrink-0 text-right text-[10px]">{file.percent.toFixed(1)}%</span><span className="truncate font-mono text-[10px]">{file.relativePath.slice(pkg.relativePath.length + 1)}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

function TestDetail({ run, result }: { run: GoIDETestRun; result: GoIDETestResult }) {
  const [output, setOutput] = useState<string | null>(null)
  const openLocation = useGoIDEStore((state) => state.openLocation)
  useEffect(() => {
    let cancelled = false
    setOutput(null)
    void getGoIDETestOutput(run.runId, result.id).then((text) => { if (!cancelled) setOutput(text) }).catch(() => { if (!cancelled) setOutput('') })
    return () => { cancelled = true }
  }, [run.runId, result.id, result.status])
  const baseDirectory = result.buildFailed ? run.request.workingDirectory : packageDirectory(run, result.package)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border-1 px-3 py-1.5 text-[11px]">
        <StatusIcon status={result.status} />
        <span className="truncate font-mono text-text-1">{result.name || result.package}</span>
        {result.failure?.relativePath && (
          <button type="button" onClick={() => void openLocation(result.failure!.relativePath!, result.failure!.line, 1)} className="shrink-0 font-mono text-[10px] text-danger underline decoration-danger/40 underline-offset-2">{result.failure.relativePath}:{result.failure.line}</button>
        )}
        <span className="ml-auto shrink-0 text-[10px] text-text-4">{result.elapsedMillis > 0 ? formatDuration(result.elapsedMillis) : ''}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-surface-0 px-3 py-2 font-mono text-[10px] leading-4 text-text-2">
        {output === null ? <Loader2 size={12} className="animate-spin text-text-4" /> : output ? output.split('\n').map((line, index) => <OutputLine key={index} line={line} baseDirectory={baseDirectory} />) : <span className="text-text-4">No output.</span>}
        {result.truncated && <div className="mt-1 text-text-4">Output truncated at 64 KB.</div>}
      </div>
    </div>
  )
}

/** Tool window Tests: albero strutturato da go test -json, rerun mirati, output e coverage. */
export const GoStudioTestsPanel = memo(function GoStudioTestsPanel({ session }: GoStudioTestsPanelProps) {
  const sessionId = session.id
  const run = useGoIDETestsStore((state) => selectedTestRun(state, sessionId))
  const runs = useGoIDETestsStore((state) => state.runs[sessionId])
  const selectedId = useGoIDETestsStore((state) => state.selectedNode[sessionId] ?? null)
  const showOnlyFailed = useGoIDETestsStore((state) => state.onlyFailed)
  const coverageVisible = useGoIDETestsStore((state) => state.coverageVisible)
  const { rerunAll, rerunFailed, selectRun, toggleOnlyFailed, toggleCoverage, loadRuns, start } = useGoIDETestsStore.getState()
  const stopRun = useGoIDEStore((state) => state.stopRun)
  useEffect(() => { void loadRuns(sessionId) }, [loadRuns, sessionId])
  const tree = useMemo(() => {
    const nodes = buildTestTree(run?.results ?? [])
    return showOnlyFailed ? onlyFailed(nodes) : nodes
  }, [run?.results, showOnlyFailed])
  const selected = run?.results.find((result) => result.id === selectedId) ?? null

  if (!run) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-surface-0 text-[11px] text-text-4">
        <p>Run tests from the ▶ next to a test, the “▶ Test” lens on a package, or Run → Test All.</p>
        <button type="button" onClick={() => void start({ sessionId, workingDirectory: '', packages: ['./...'] })} className="flex items-center gap-1.5 rounded bg-accent px-3 py-1 text-[11px] font-semibold text-white"><Play size={11} fill="currentColor" aria-hidden="true" /> Run all tests</button>
      </div>
    )
  }
  const running = run.status === 'running'
  const summary = run.summary
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-0">
      <div role="toolbar" aria-label="Tests toolbar" className="flex h-8 shrink-0 items-center gap-1 border-b border-border-1 bg-surface-1 px-2 text-[10px]">
        <button type="button" disabled={running} onClick={() => void rerunAll(sessionId)} title="Rerun" className="grid h-6 w-6 place-items-center rounded text-success hover:bg-success/10 disabled:opacity-30"><Play size={11} fill="currentColor" aria-hidden="true" /></button>
        <button type="button" disabled={running || summary.failed === 0} onClick={() => void rerunFailed(sessionId)} title="Rerun failed tests" className="flex h-6 items-center gap-1 rounded px-1.5 text-danger hover:bg-danger/10 disabled:opacity-30"><RotateCcw size={11} aria-hidden="true" /> Failed</button>
        <button type="button" disabled={!running} onClick={() => void stopRun(run.runId)} title="Stop tests" className="grid h-6 w-6 place-items-center rounded text-danger hover:bg-danger/10 disabled:opacity-30"><Square size={10} fill="currentColor" aria-hidden="true" /></button>
        <button type="button" aria-pressed={showOnlyFailed} onClick={toggleOnlyFailed} title="Show only failed" className={`grid h-6 w-6 place-items-center rounded ${showOnlyFailed ? 'bg-accent/15 text-accent' : 'text-text-3 hover:bg-surface-3'}`}><Filter size={11} aria-hidden="true" /></button>
        {run.coverage && (
          <button type="button" aria-pressed={coverageVisible} onClick={toggleCoverage} title={coverageVisible ? 'Hide coverage in the editor' : 'Show coverage in the editor'} className={`flex h-6 items-center gap-1 rounded px-1.5 ${coverageVisible ? 'bg-success/15 text-success' : 'text-text-3 hover:bg-surface-3'}`}><ShieldCheck size={11} aria-hidden="true" /> {run.coverage.percent.toFixed(1)}%</button>
        )}
        <span className="ml-2 flex items-center gap-2 text-text-3">
          {running && <Loader2 size={11} className="animate-spin text-accent" aria-hidden="true" />}
          <span className="text-success">✓ {summary.passed}</span>
          <span className={summary.failed ? 'text-danger' : ''}>✗ {summary.failed}</span>
          <span>⊘ {summary.skipped}</span>
          {running && <span>… {summary.running}</span>}
          <span className="text-text-4">{run.status === 'stopped' ? 'stopped' : ''}</span>
        </span>
        <select aria-label="Test run" value={run.runId} onChange={(event) => selectRun(sessionId, event.target.value)} className="ml-auto h-6 max-w-72 rounded border border-border-1 bg-surface-2 px-1.5 text-[10px] text-text-2">
          {(runs ?? []).map((item) => <option key={item.runId} value={item.runId}>{new Date(item.startedAt).toLocaleTimeString()} · {item.request.run || item.request.bench || (item.request.packages ?? []).join(' ')} · {item.summary.failed ? `${item.summary.failed} failed` : item.status}</option>)}
        </select>
      </div>
      <div className="flex min-h-0 flex-1">
        <div role="tree" aria-label="Test results" className="min-h-0 w-[46%] shrink-0 overflow-auto border-r border-border-1 py-1">
          {tree.map((node, index) => <TestRow key={node.result.id} node={node} depth={0} selected={selectedId} run={run} sessionId={sessionId} entry={index === 0} />)}
          {tree.length === 0 && <p className="p-3 text-[11px] text-text-4">{running ? 'Building and starting tests…' : showOnlyFailed ? 'No failed tests.' : 'No tests found.'}</p>}
          {run.overflow && <p className="p-2 text-[10px] text-warning">Too many tests: only the first 5,000 are shown.</p>}
        </div>
        {selected ? <TestDetail run={run} result={selected} /> : run.coverage ? <div className="min-h-0 flex-1 overflow-auto"><CoverageSummary report={run.coverage} /></div> : <p className="p-3 text-[11px] text-text-4">Select a test to see its output. Double-click opens the failure or the test function.</p>}
      </div>
    </div>
  )
})
