import { Folder } from 'lucide-react'
import type { GoIDESession } from '@/lib/code-studio-api'
import type { TestSuite } from '@/lib/code-studio/testSuites'
import type { TestActions } from './CodeStudioTestsActions'
import type { TestHistories } from './CodeStudioTestsHistory'
import { useRunOutput } from './CodeStudioTestsOutput'
import { CodeStudioTestsOverview } from './CodeStudioTestsOverview'
import { CoverageTab, MoreTab, OutputTab, TestsTab } from './CodeStudioTestsTabs'
import { LanguageChip, Tile } from './CodeStudioTestsUi'

export type DetailTab = 'overview' | 'tests' | 'output' | 'coverage' | 'more'

interface CodeStudioTestsDetailProps {
  suite: TestSuite
  session: GoIDESession
  actions: TestActions
  histories: TestHistories
  tab: DetailTab
  onTab: (tab: DetailTab) => void
  now: number
}

/** Dettaglio della suite selezionata: intestazione, schede (Overview, Tests, Output, Coverage, More) e il loro contenuto. */
export function CodeStudioTestsDetail({ suite, session, actions, histories, tab, onTab, now }: CodeStudioTestsDetailProps) {
  const output = useRunOutput(suite.run)
  const tabs: Array<{ id: DetailTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'tests', label: suite.total > 0 ? `Tests (${suite.total})` : 'Tests' },
    { id: 'output', label: 'Output' },
    { id: 'coverage', label: suite.run?.coverage ? `Coverage ${suite.run.coverage.percent.toFixed(0)}%` : 'Coverage' },
    { id: 'more', label: 'More' },
  ]
  return (
    <aside aria-label={`${suite.name} details`} className="flex min-w-0 flex-col gap-2 border border-border-1 bg-surface-0 p-2">
      <div className="flex items-center gap-3">
        <Tile tone="bg-surface-3 text-text-2"><Folder size={14} /></Tile>
        <div className="min-w-0"><h3 className="truncate text-[12px] font-semibold leading-tight text-text-1">{suite.name}</h3><p className="truncate font-mono text-[12px] text-text-3">{suite.path}</p></div>
        <span className="ml-auto"><LanguageChip label={suite.languageLabel} /></span>
      </div>
      <div role="tablist" aria-label="Suite details" className="-mx-2 flex gap-3 overflow-x-auto border-b border-border-1 px-2">
        {tabs.map((item) => (
          <button key={item.id} type="button" role="tab" id={`tests-tab-${item.id}`} aria-selected={tab === item.id} aria-controls="tests-tabpanel" onClick={() => onTab(item.id)} className={`-mb-px whitespace-nowrap border-b-2 pb-2.5 text-[12px] transition-colors ${tab === item.id ? 'border-text-2 font-medium text-text-1' : 'border-transparent text-text-3 hover:text-text-1'}`}>{item.label}</button>
        ))}
      </div>
      <div id="tests-tabpanel" role="tabpanel" aria-labelledby={`tests-tab-${tab}`} className="min-w-0">
        {tab === 'overview' && <CodeStudioTestsOverview suite={suite} output={output} actions={actions} now={now} onTab={onTab} />}
        {tab === 'tests' && <TestsTab suite={suite} session={session} histories={histories} />}
        {tab === 'output' && <OutputTab suite={suite} output={output} />}
        {tab === 'coverage' && <CoverageTab suite={suite} sessionId={session.id} actions={actions} />}
        {tab === 'more' && <MoreTab suite={suite} actions={actions} histories={histories} />}
      </div>
    </aside>
  )
}
