import { memo, useEffect, useMemo, useState } from 'react'
import { Play, Repeat, ShieldCheck, XCircle } from 'lucide-react'
import type { ContextMenuItem } from '@/components/ui/ContextMenu'
import type { GoIDESession } from '@/lib/code-studio-api'
import type { GoIDETestRun } from '@/lib/code-studio-tests-api'
import { buildSuites, filterSuites, suiteStats, type SuiteFilter, type TestSuite } from '@/lib/code-studio/testSuites'
import { testTargets, type TestTarget } from '@/lib/code-studio/testTargets'
import { useCodeStudioTestsStore } from '@/stores/codeStudioTests'
import { CodeStudioAlert } from './CodeStudioModal'
import { useTestActions } from './CodeStudioTestsActions'
import { CodeStudioTestsDetail, type DetailTab } from './CodeStudioTestsDetail'
import { CodeStudioTestsHeader } from './CodeStudioTestsHeader'
import { useTestHistories } from './CodeStudioTestsHistory'
import { CodeStudioTestsStats } from './CodeStudioTestsStats'
import { CodeStudioTestsTable } from './CodeStudioTestsTable'

const EMPTY_RUNS: GoIDETestRun[] = []
const IDLE_TICK_MS = 20_000
const ACTIVE_TICK_MS = 1_000

/** Cartella senza separatori finali: il `[\\/]+$` equivalente è quadratico sul percorso lungo. */
function withoutTrailingSeparators(path: string): string {
  let end = path.length
  while (end > 0 && (path[end - 1] === '/' || path[end - 1] === '\\')) end -= 1
  return path.slice(0, end)
}

/** Progetto senza unità rilevate: i test Go si lanciano comunque dalla radice, come prima del dashboard. */
function rootTarget(session: GoIDESession): TestTarget {
  const name = withoutTrailingSeparators(session.project.rootPath).split(/[\\/]/).pop() || 'project'
  return { key: 'go|', label: `${name} · Go`, language: 'go', workingDirectory: '', packages: ['./...'] }
}

/** Orologio che scatta spesso solo quando qualcosa gira: durate e "2m ago" restano vivi senza ridisegnare a vuoto. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), active ? ACTIVE_TICK_MS : IDLE_TICK_MS)
    return () => window.clearInterval(timer)
  }, [active])
  return now
}

/** Tool window Tests: la dashboard delle suite del workspace (una per modulo/unità) con dettaglio, output e coverage. */
export const CodeStudioTestsPanel = memo(function CodeStudioTestsPanel({ session }: { session: GoIDESession }) {
  const sessionId = session.id
  const runs = useCodeStudioTestsStore((state) => state.runs[sessionId]) ?? EMPTY_RUNS
  const queue = useCodeStudioTestsStore((state) => state.queue[sessionId])
  const testError = useCodeStudioTestsStore((state) => state.error)
  const [filter, setFilter] = useState<SuiteFilter>('all')
  const [query, setQuery] = useState('')
  const [ascending, setAscending] = useState(true)
  const [selectedKey, setSelectedKey] = useState('')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [tab, setTab] = useState<DetailTab>('overview')
  const targets = useMemo(() => {
    const found = testTargets(session.project)
    return found.length > 0 ? found : [rootTarget(session)]
  }, [session])
  const queuedKeys = useMemo(() => new Set((queue ?? []).map((item) => item.key)), [queue])
  const busy = runs.some((run) => run.status === 'running') || queuedKeys.size > 0
  const now = useNow(busy)
  const suites = useMemo(() => buildSuites(targets, runs, now, queuedKeys), [targets, runs, now, queuedKeys])
  const stats = useMemo(() => suiteStats(suites), [suites])
  const visible = useMemo(() => {
    const sorted = [...suites].sort((left, right) => left.name.localeCompare(right.name) * (ascending ? 1 : -1))
    return filterSuites(sorted, filter, query)
  }, [suites, ascending, filter, query])
  const selected = suites.find((suite) => suite.key === selectedKey) ?? suites.find((suite) => suite.status === 'failed') ?? suites[0]
  const actions = useTestActions(session)
  const histories = useTestHistories(session, runs)
  useEffect(() => { void useCodeStudioTestsStore.getState().loadRuns(sessionId) }, [sessionId])

  const toggle = (key: string) => setExpanded((current) => {
    const next = new Set(current)
    if (!next.delete(key)) next.add(key)
    return next
  })
  const rowMenu = (suite: TestSuite): ContextMenuItem[] => [
    { id: 'run', label: 'Run', icon: Play, iconClassName: 'text-success', disabled: suite.status === 'running' },
    { id: 'failed', label: 'Run failed tests only', icon: XCircle, disabled: suite.failed === 0, disabledReason: 'No failed tests in the last run' },
    { id: 'coverage', label: 'Run with coverage', icon: ShieldCheck, disabled: suite.language !== 'go' && suite.language !== 'java' && suite.language !== 'python', disabledReason: 'Coverage is available for Go, Java and Python suites' },
    { id: 'repeat', label: 'Repeat ×20 in random order', icon: Repeat, disabled: suite.language !== 'go', disabledReason: 'Repetition with -shuffle is available for Go suites' },
  ]
  const onRowMenu = (suite: TestSuite, id: string) => {
    if (id === 'failed') actions.rerunFailed([suite])
    else if (id === 'coverage') actions.runSuite(suite, { coverage: true })
    else if (id === 'repeat') actions.runSuite(suite, { repeat: 20, shuffle: 'on', bench: '', coverage: false })
    else actions.runSuite(suite)
  }

  if (!selected) {
    return <div className="flex h-full items-center justify-center p-6 text-[13px] text-text-4">No test runner was found in this project.</div>
  }
  return (
    <div className="h-full min-h-0 overflow-auto bg-surface-0 p-2">
      <div className="flex w-full min-w-0 flex-col gap-2">
        {testError && <CodeStudioAlert>{testError}</CodeStudioAlert>}
        <CodeStudioTestsHeader
          stats={stats} filter={filter} onFilter={setFilter} query={query} onQuery={setQuery} busy={busy}
          hasGo={suites.some((suite) => suite.language === 'go' || suite.language === 'java')} canRerunFailed={stats.failed > 0}
          onRunAll={(coverage) => actions.runAll(coverage ? suites.filter((suite) => suite.language === 'go' || suite.language === 'python') : suites, coverage ? { coverage: true } : undefined)}
          onRerunFailed={() => actions.rerunFailed(suites)} onStop={actions.stop}
        />
        <CodeStudioTestsStats stats={stats} now={now} />
        <div className="grid items-start gap-2 min-[1400px]:grid-cols-[minmax(620px,1.5fr)_minmax(320px,1fr)]">
          <CodeStudioTestsTable
            suites={visible} selectedKey={selected.key} expanded={expanded} ascending={ascending} now={now}
            onSort={() => setAscending((value) => !value)} onSelect={setSelectedKey} onToggle={toggle}
            onSelectPackage={(suite, nodeId) => { setSelectedKey(suite.key); setTab('tests'); useCodeStudioTestsStore.getState().selectNode(sessionId, nodeId) }}
            onRun={(suite) => actions.runSuite(suite)} onDebug={actions.debugSuite} canDebug={actions.canDebug}
            rowMenu={rowMenu} onRowMenu={onRowMenu}
          />
          <CodeStudioTestsDetail suite={selected} session={session} actions={actions} histories={histories} tab={tab} onTab={setTab} now={now} />
        </div>
      </div>
    </div>
  )
})
