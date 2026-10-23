import { useMemo, useState, type ReactNode } from 'react'
import { Clipboard as WailsClipboard } from '@wailsio/runtime'
import { Copy, Gauge, Repeat, ShieldCheck, Shuffle, Trash2 } from 'lucide-react'
import type { GoIDESession } from '@/lib/code-studio-api'
import type { GoIDETestResult, GoIDETestRun } from '@/lib/code-studio-tests-api'
import { buildTestTree, filterTestTree, isFailed, isFlaky, isSlow, onlyFailed } from '@/lib/code-studio/codeStudioTestTree'
import { emptyRunMessage } from '@/lib/code-studio/testRunMessages'
import type { TestSuite } from '@/lib/code-studio/testSuites'
import { useCodeStudioTestsStore } from '@/stores/codeStudioTests'
import { benchmarkHistoryCsv } from './codeStudioBenchmarkHistory'
import { runCodeStudioBenchmarks } from './codeStudioQuickActions'
import { CoverageSummary, TestDetail, TestRow } from './CodeStudioTestParts'
import { REPEAT_OPTIONS, type TestActions } from './CodeStudioTestsActions'
import type { TestHistories } from './CodeStudioTestsHistory'
import { OutputLines, type RunOutput } from './CodeStudioTestsOutput'

const chip = (active: boolean, tone = 'bg-accent/15 text-accent') => `flex h-7 items-center gap-1 rounded-md px-2 text-[12px] ${active ? tone : 'text-text-3 hover:bg-surface-3 hover:text-text-1'}`

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed border-border-2 px-2 py-8 text-center text-[12px] text-text-4">{children}</p>
}

interface TestsTabProps {
  suite: TestSuite
  session: GoIDESession
  histories: TestHistories
}

/** Albero dei test della suite con i filtri di sempre (falliti, instabili, lenti) e il dettaglio del test selezionato. */
export function TestsTab({ suite, session, histories }: TestsTabProps) {
  const sessionId = session.id
  const runs = useCodeStudioTestsStore((state) => state.runs[sessionId])
  const selectedId = useCodeStudioTestsStore((state) => state.selectedNode[sessionId] ?? null)
  const [runId, setRunId] = useState<string | null>(null)
  const [failedOnly, setFailedOnly] = useState(false)
  const [flakyOnly, setFlakyOnly] = useState(false)
  const [slowOnly, setSlowOnly] = useState(false)
  const history = useMemo(() => (runs ?? []).filter((item) => (item.request.language || 'go') === suite.language && (item.request.workingDirectory ?? '') === suite.target.workingDirectory), [runs, suite.language, suite.target.workingDirectory])
  const run: GoIDETestRun | null = history.find((item) => item.runId === runId) ?? suite.run
  const { records } = histories
  const knownFlaky = (result: GoIDETestResult) => isFlaky(result) || (!!result.name && records.has(`${result.package}\u0000${result.name}`))
  const tree = useMemo(() => {
    const nodes = buildTestTree(run?.results ?? [])
    const base = flakyOnly ? filterTestTree(nodes, knownFlaky) : failedOnly ? onlyFailed(nodes) : nodes
    return slowOnly ? filterTestTree(base, isSlow) : base
    // knownFlaky depende solo da records
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.results, failedOnly, flakyOnly, slowOnly, records])
  if (!run) return <Empty>This suite has not run yet. Press Run to see its tests.</Empty>
  const selected = run.results.find((result) => result.id === selectedId) ?? null
  const failedCount = run.results.filter((result) => result.name && isFailed(result)).length
  return (
    <div className="flex h-[min(620px,70vh)] min-h-72 flex-col overflow-hidden rounded-md border border-border-1">
      <div role="toolbar" aria-label="Test filters" className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border-1 bg-surface-2/50 px-2 py-1.5">
        <button type="button" aria-pressed={failedOnly} onClick={() => setFailedOnly((value) => !value)} className={chip(failedOnly, 'bg-danger/15 text-danger')}>Failed {failedCount}</button>
        <button type="button" aria-pressed={flakyOnly} onClick={() => setFlakyOnly((value) => !value)} className={chip(flakyOnly, 'bg-warning/15 text-warning')}><Shuffle size={12} aria-hidden="true" /> Flaky</button>
        <button type="button" aria-pressed={slowOnly} onClick={() => setSlowOnly((value) => !value)} title="Tests slower than one second" className={chip(slowOnly, 'bg-warning/15 text-warning')}>Slow</button>
        {history.length > 1 && (
          <select aria-label="Run of this suite" value={run.runId} onChange={(event) => setRunId(event.target.value)} className="ml-auto h-7 max-w-56 rounded-md border border-border-1 bg-surface-2 px-1.5 text-[12px] text-text-2">
            {history.map((item) => <option key={item.runId} value={item.runId}>{new Date(item.startedAt).toLocaleTimeString()} · {item.summary.failed ? `${item.summary.failed} failed` : item.status}{(item.request.repeat ?? 0) > 1 ? ` ×${item.request.repeat}` : ''}</option>)}
          </select>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <div role="tree" aria-label="Test results" className="max-h-[45%] min-h-24 shrink-0 overflow-auto border-b border-border-1 py-1">
          {tree.map((node, index) => <TestRow key={node.result.id} node={node} depth={0} selected={selectedId} run={run} sessionId={sessionId} records={records} entry={index === 0} />)}
          {tree.length === 0 && <p className="p-3 text-[12px] text-text-4">{emptyRunMessage(run)}</p>}
          {run.overflow && <p className="p-2 text-[12px] text-warning">Too many tests: only the first 5,000 are shown.</p>}
        </div>
        {selected ? <TestDetail key={`${run.runId}:${selected.id}`} run={run} result={selected} runs={history} benchmark={histories.benchmarkContext} /> : <p className="p-3 text-[12px] text-text-4">Select a test to see its output. Double-click opens the failure or the test function.</p>}
      </div>
    </div>
  )
}

export function OutputTab({ suite, output }: { suite: TestSuite; output: RunOutput }) {
  if (!suite.run) return <Empty>No output yet: this suite has not run.</Empty>
  return (
    <section aria-label="Full output" className="overflow-hidden rounded-md border border-border-1 bg-surface-2/40">
      <div className="flex items-center gap-2 border-b border-border-1 px-2 py-2 font-mono text-[12px] text-text-3">
        <span className="truncate">{suite.run.command || `Ran ${suite.name}`}</span>
        <button type="button" aria-label="Copy output" onClick={() => void WailsClipboard.SetText(output.text)} className="ml-auto grid h-6 w-6 shrink-0 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1"><Copy size={13} /></button>
      </div>
      <div className="max-h-[60vh] overflow-auto px-2 py-2 font-mono text-[12px] leading-5">
        {output.text ? <OutputLines text={output.text} baseDirectory={suite.target.workingDirectory} /> : <span className="text-text-4">{output.loading ? 'Loading output…' : 'No output.'}</span>}
      </div>
    </section>
  )
}

export function CoverageTab({ suite, sessionId, actions }: { suite: TestSuite; sessionId: string; actions: TestActions }) {
  const report = suite.run?.coverage
  if (report) return <div className="overflow-hidden rounded-md border border-border-1"><CoverageSummary report={report} sessionId={sessionId} /></div>
  const supported = suite.language === 'go' || suite.language === 'java' || suite.language === 'python' || suite.language === 'rust'
  return (
    <Empty>
      <span className="block">{supported ? 'The last run has no coverage.' : 'Coverage is available for Go, Java, Python and Rust suites.'}</span>
      {supported && <button type="button" onClick={() => actions.runSuite(suite, { coverage: true })} className="mt-3 inline-flex h-9 items-center gap-2 rounded bg-accent px-2 text-[12px] font-semibold text-on-accent hover:bg-accent-hover"><ShieldCheck size={14} aria-hidden="true" /> Run with coverage</button>}
    </Empty>
  )
}

function ToolRow({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-border-1 bg-surface-2/40 px-2 py-2">
      <div className="min-w-0 flex-1"><div className="text-[12px] font-medium text-text-1">{title}</div><div className="text-[12px] text-text-3">{hint}</div></div>
      {children}
    </div>
  )
}

const toolButton = 'flex h-9 items-center gap-2 rounded border border-border-2 bg-surface-2 px-3 text-[12px] font-medium text-text-1 transition-colors hover:border-accent hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40'

/** Strumenti meno frequenti: ripetizioni per i test instabili, benchmark, overlay di coverage e storico locale. */
export function MoreTab({ suite, actions, histories }: { suite: TestSuite; actions: TestActions; histories: TestHistories }) {
  const [repeat, setRepeat] = useState(20)
  const coverageVisible = useCodeStudioTestsStore((state) => state.coverageVisible)
  const go = suite.language === 'go'
  const busy = suite.status === 'running'
  return (
    <div className="flex flex-col gap-3">
      <ToolRow title="Find flaky tests" hint="Run the suite several times in random order and compare the outcomes.">
        <select aria-label="Repetitions" value={repeat} onChange={(event) => setRepeat(Number(event.target.value))} disabled={!go} className="h-9 rounded border border-border-1 bg-surface-2 px-2 text-[12px] text-text-2 disabled:opacity-40">{REPEAT_OPTIONS.map((value) => <option key={value} value={value}>×{value}</option>)}</select>
        <button type="button" disabled={!go || busy} onClick={() => actions.runSuite(suite, { repeat, shuffle: 'on', bench: '', coverage: false })} className={toolButton}><Repeat size={14} aria-hidden="true" /> Repeat</button>
      </ToolRow>
      <ToolRow title="Benchmarks" hint="Run the benchmarks of the package open in the editor, with memory statistics.">
        <button type="button" disabled={!go || busy} onClick={() => void runCodeStudioBenchmarks('package')} className={toolButton}><Gauge size={14} aria-hidden="true" /> Run benchmarks</button>
        <button type="button" disabled={histories.benchmarkHistory.length === 0} onClick={() => void WailsClipboard.SetText(benchmarkHistoryCsv(histories.benchmarkHistory))} title="Copy the saved benchmark metrics as CSV" className={toolButton}><Copy size={14} aria-hidden="true" /> CSV</button>
        <button type="button" disabled={histories.benchmarkHistory.length === 0} onClick={histories.clearBenchmarks} title="Forget the saved benchmark measurements" className={toolButton}><Trash2 size={14} aria-hidden="true" /> {histories.benchmarkHistory.length}</button>
      </ToolRow>
      <ToolRow title="Coverage in the editor" hint="Show the covered and uncovered lines of the last coverage run.">
        <button type="button" aria-pressed={coverageVisible} onClick={() => useCodeStudioTestsStore.getState().toggleCoverage()} className={`${toolButton} ${coverageVisible ? 'border-success/50 text-success' : ''}`}><ShieldCheck size={14} aria-hidden="true" /> {coverageVisible ? 'Shown' : 'Hidden'}</button>
      </ToolRow>
      <ToolRow title="Flaky history" hint={`${histories.records.size} test${histories.records.size === 1 ? '' : 's'} seen unstable in earlier repeated runs.`}>
        <button type="button" disabled={histories.flakyHistory.length === 0} onClick={histories.clearFlaky} className={toolButton}><Trash2 size={14} aria-hidden="true" /> Forget</button>
      </ToolRow>
    </div>
  )
}
