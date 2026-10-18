import type { ReactNode } from 'react'
import { Bug, CalendarClock, CheckCircle2, CircleDashed, Clock3, Hourglass, Loader2, MoreHorizontal, Play, ShieldCheck, SquareTerminal, XCircle } from 'lucide-react'
import { formatDuration } from '@/lib/code-studio/codeStudioTestTree'
import { relativeTime, type SuiteStatus, type TestSuite } from '@/lib/code-studio/testSuites'
import type { TestActions } from './CodeStudioTestsActions'
import { OutputLines, type RunOutput } from './CodeStudioTestsOutput'
import { SplitButton } from './CodeStudioTestsUi'

const HEADLINES: Record<SuiteStatus, { title: string; tone: string; icon: ReactNode }> = {
  passed: { title: 'Passed', tone: 'text-success', icon: <CheckCircle2 size={30} className="text-success" /> },
  failed: { title: 'Failed', tone: 'text-danger', icon: <XCircle size={30} className="text-danger" /> },
  running: { title: 'Running', tone: 'text-accent', icon: <Loader2 size={28} className="animate-spin text-accent" /> },
  queued: { title: 'Queued', tone: 'text-text-2', icon: <Hourglass size={28} className="text-text-3" /> },
  stopped: { title: 'Stopped', tone: 'text-warning', icon: <CircleDashed size={28} className="text-warning" /> },
  notrun: { title: 'Not run yet', tone: 'text-text-2', icon: <CircleDashed size={28} className="text-text-4" /> },
}

function subtitle(suite: TestSuite): string {
  switch (suite.status) {
    case 'passed': return suite.total > 0 ? 'All tests passed' : 'The run finished without tests'
    case 'failed': return suite.total > 0 ? `${suite.failed} of ${suite.total} tests failed` : 'The test command failed before producing results'
    case 'running': return `${suite.passed + suite.failed + suite.skipped} tests finished so far`
    case 'queued': return 'Waiting for the suites before it'
    case 'stopped': return 'The run was stopped before it finished'
    default: return 'Run this suite to see its results'
  }
}

function Fact({ icon, value, label }: { icon: ReactNode; value: string; label: string }) {
  return (
    <div className="flex items-center gap-2.5 border-l border-border-1 pl-4">
      <span className="text-text-3">{icon}</span>
      <div><div className="text-[15px] font-semibold tabular-nums text-text-1">{value}</div><div className="text-[12px] text-text-3">{label}</div></div>
    </div>
  )
}

interface CodeStudioTestsOverviewProps {
  suite: TestSuite
  output: RunOutput
  actions: TestActions
  now: number
  onTab: (tab: 'output' | 'more') => void
}

const RUN_ITEMS = (go: boolean, coverage: boolean, hasFailed: boolean) => [
  { id: 'run', label: 'Run', icon: Play, iconClassName: 'text-success' },
  { id: 'failed', label: 'Run failed tests only', disabled: !hasFailed, disabledReason: 'No failed tests in the last run', icon: XCircle },
  { id: 'coverage', label: 'Run with coverage', disabled: !coverage, disabledReason: 'Coverage is available for Go and Java suites', icon: ShieldCheck },
  { id: 'repeat', label: 'Repeat ×20 in random order', disabled: !go, disabledReason: 'Repetition with -shuffle is available for Go suites', icon: Clock3 },
]

/** Scheda "Overview": esito in grande, Run/Debug e le ultime righe di output. */
export function CodeStudioTestsOverview({ suite, output, actions, now, onTab }: CodeStudioTestsOverviewProps) {
  const headline = HEADLINES[suite.status]
  const go = suite.language === 'go'
  const busy = suite.status === 'running'
  const runVariant = (id: string) => {
    if (id === 'failed') actions.rerunFailed([suite])
    else if (id === 'coverage') actions.runSuite(suite, { coverage: true })
    else if (id === 'repeat') actions.runSuite(suite, { repeat: 20, shuffle: 'on', bench: '', coverage: false })
    else actions.runSuite(suite)
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border-1 bg-surface-2/60 px-4 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          {headline.icon}
          <div className="min-w-0"><div className={`text-[20px] font-semibold leading-tight ${headline.tone}`}>{headline.title}</div><div className="text-[13px] text-text-3">{subtitle(suite)}</div></div>
        </div>
        <div className="ml-auto flex gap-4">
          <Fact icon={<Clock3 size={18} />} value={suite.run ? formatDuration(suite.durationMs) : '—'} label="Duration" />
          <Fact icon={<CalendarClock size={18} />} value={suite.lastRunAt ? relativeTime(suite.lastRunAt, now) : '—'} label="Last run" />
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_auto] gap-3">
        <SplitButton label="Run" icon={Play} variant="primary" disabled={busy} onMain={() => actions.runSuite(suite)} items={RUN_ITEMS(go, suite.language === 'go' || suite.language === 'java', suite.failed > 0)} onItem={runVariant} menuLabel="More ways to run this suite" />
        <SplitButton label="Debug" icon={Bug} variant="secondary" disabled={!actions.canDebug(suite)} mainTitle="Debug the first failed test" onMain={() => actions.debugSuite(suite)} items={[{ id: 'failed', label: 'Debug first failed test', icon: Bug, iconClassName: 'text-warning' }]} onItem={() => actions.debugSuite(suite)} menuLabel="More ways to debug this suite" />
        <button type="button" aria-label="More tools" title="Repetition, benchmarks, coverage overlay and history" onClick={() => onTab('more')} className="grid h-10 w-14 place-items-center rounded-lg border border-border-2 bg-surface-2 text-text-2 transition-colors hover:border-accent hover:bg-surface-3 hover:text-text-1"><MoreHorizontal size={18} /></button>
      </div>
      <section aria-label="Recent output" className="rounded-xl border border-border-1 bg-surface-2/40">
        <div className="flex items-center gap-2 border-b border-border-1 px-4 py-2.5 text-[14px] font-medium text-text-1">
          <SquareTerminal size={16} className="text-text-3" aria-hidden="true" /> Recent Output
          <button type="button" onClick={() => onTab('output')} className="ml-auto text-[13px] font-medium text-accent hover:underline">View Full Output ↗</button>
        </div>
        <div className="max-h-64 overflow-auto px-4 py-3 font-mono text-[12.5px] leading-5">
          {output.text ? <OutputLines text={output.text} baseDirectory={suite.target.workingDirectory} tail={14} /> : <span className="text-text-4">{output.loading ? 'Loading output…' : suite.run ? 'No output.' : 'Nothing has run yet.'}</span>}
        </div>
      </section>
    </div>
  )
}
