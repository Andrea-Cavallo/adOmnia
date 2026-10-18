import { FlaskConical, Play, RotateCcw, Search, Square } from 'lucide-react'
import type { SuiteFilter, SuiteStats } from '@/lib/code-studio/testSuites'
import { SplitButton } from './CodeStudioTestsUi'

interface FilterChip {
  id: SuiteFilter
  label: string
  count: number
  dot?: string
}

interface CodeStudioTestsHeaderProps {
  stats: SuiteStats
  filter: SuiteFilter
  onFilter: (filter: SuiteFilter) => void
  query: string
  onQuery: (query: string) => void
  busy: boolean
  hasGo: boolean
  canRerunFailed: boolean
  onRunAll: (coverage: boolean) => void
  onRerunFailed: () => void
  onStop: () => void
}

const RUN_ALL_ITEMS = (hasGo: boolean) => [
  { id: 'all', label: 'Run all suites', icon: Play, iconClassName: 'text-success' },
  { id: 'coverage', label: 'Run all with coverage', disabled: !hasGo, disabledReason: 'Coverage is available for Go and Java suites', icon: Play },
]

/** Titolo, ricerca, filtri per stato e le azioni globali: Run All (con varianti), Re-run Failed e Stop. */
export function CodeStudioTestsHeader({ stats, filter, onFilter, query, onQuery, busy, hasGo, canRerunFailed, onRunAll, onRerunFailed, onStop }: CodeStudioTestsHeaderProps) {
  const chips: FilterChip[] = [
    { id: 'all', label: 'All', count: stats.total },
    { id: 'passed', label: 'Passed', count: stats.passed, dot: 'bg-success' },
    { id: 'failed', label: 'Failed', count: stats.failed, dot: 'bg-danger' },
    { id: 'running', label: 'Running', count: stats.running, dot: 'bg-accent' },
    { id: 'queued', label: 'Queued', count: stats.queued, dot: 'bg-text-4' },
    ...(stats.notRun > 0 ? [{ id: 'notrun' as const, label: 'Not run', count: stats.notRun, dot: 'bg-surface-4' }] : []),
  ]
  return (
    <header className="flex flex-wrap items-center gap-x-2 gap-y-2">
      <div className="flex items-center gap-3">
        <FlaskConical size={14} className="text-text-3" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="text-[13px] font-extrabold uppercase tracking-[1.5px] leading-tight text-text-1" style={{ fontFamily: 'var(--skin-font-ui, Doto, var(--font-ui))' }}>Tests</h2>
          
        </div>
      </div>
      <label className="flex h-7 w-44 min-w-32 items-center gap-2 rounded border border-border-1 bg-surface-1 px-3 text-text-4 focus-within:border-accent">
        <Search size={14} aria-hidden="true" />
        <input value={query} onChange={(event) => onQuery(event.target.value)} aria-label="Search test suites" placeholder="Search test suites…" className="min-w-0 flex-1 bg-transparent text-[12px] text-text-1 outline-none placeholder:text-text-4" />
      </label>
      <div role="group" aria-label="Filter by status" className="flex max-w-full h-7 items-stretch overflow-x-auto rounded border border-border-1 bg-surface-1">
        {chips.map((chip) => (
          <button key={chip.id} type="button" aria-pressed={filter === chip.id} onClick={() => onFilter(chip.id)} className={`flex shrink-0 items-center gap-1.5 border-r border-border-1 px-2.5 text-[12px] transition-colors last:border-r-0 ${filter === chip.id ? 'bg-surface-3 text-text-1' : 'text-text-3 hover:bg-surface-3 hover:text-text-1'}`}>
            {chip.dot && <span className={`h-2 w-2 rounded-full ${chip.dot}`} aria-hidden="true" />}
            {chip.label}
            <span className="font-medium tabular-nums text-text-2">{chip.count}</span>
          </button>
        ))}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <SplitButton label="Run All" icon={Play} variant="primary" className="w-28" disabled={stats.total === 0} onMain={() => onRunAll(false)} items={RUN_ALL_ITEMS(hasGo)} onItem={(id) => onRunAll(id === 'coverage')} menuLabel="More ways to run all suites" mainTitle="Run every test suite, one after the other" />
        <button type="button" disabled={busy || !canRerunFailed} onClick={onRerunFailed} title="Run again only the failed tests of the failed suites" className="flex h-7 items-center gap-2 rounded border border-border-2 bg-surface-2 px-3 text-[12px] font-medium text-text-1 transition-colors hover:border-accent hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40">
          <RotateCcw size={14} aria-hidden="true" /> Re-run Failed
        </button>
        <button type="button" disabled={!busy} onClick={onStop} title="Stop the running tests and clear the queue" className="flex h-7 items-center gap-2 rounded border border-border-1 bg-surface-1 px-3 text-[12px] font-medium text-text-2 transition-colors hover:border-danger hover:text-danger disabled:cursor-not-allowed disabled:opacity-40">
          <Square size={13} fill="currentColor" aria-hidden="true" /> Stop
        </button>
      </div>
    </header>
  )
}
