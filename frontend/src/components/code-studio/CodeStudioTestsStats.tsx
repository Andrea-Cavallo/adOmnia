import { formatDuration } from '@/lib/code-studio/codeStudioTestTree'
import { relativeTime, type SuiteStats } from '@/lib/code-studio/testSuites'

/** Riepilogo compatto, senza schede decorative. */
export function CodeStudioTestsStats({ stats, now }: { stats: SuiteStats; now: number }) {
  const values = [
    { label: 'Total Test Suites', value: stats.total, tone: 'bg-text-3' },
    { label: 'Passed', value: stats.passed, tone: 'bg-success' },
    { label: 'Failed', value: stats.failed, tone: 'bg-danger' },
    { label: 'Running', value: stats.running, tone: 'bg-text-2' },
    { label: 'Queued', value: stats.queued, tone: 'bg-text-4' },
  ]
  return (
    <section aria-label="Test summary" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-dashed border-border-1 px-2 py-2 text-[11px] text-text-3">
      {values.map(({ label, value, tone }) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className={`h-1 w-1 rounded-full ${tone}`} />
          <span>{label}</span>
          <span className="font-mono tabular-nums text-text-1">{value}</span>
        </span>
      ))}
      <span className="ml-auto inline-flex items-center gap-2">
        Last run <span className="font-mono tabular-nums text-text-2">{stats.lastRunAt ? formatDuration(stats.lastRunDurationMs) : '—'}</span>
        {stats.lastRunAt && <span>{relativeTime(stats.lastRunAt, now)}</span>}
      </span>
    </section>
  )
}
