import type { ReactNode } from 'react'
import { CheckCircle2, Clock3, Hourglass, Loader2, MinusCircle, XCircle } from 'lucide-react'
import { formatDuration } from '@/lib/code-studio/codeStudioTestTree'
import { relativeTime, type SuiteStats } from '@/lib/code-studio/testSuites'
import { SuiteDonut } from './CodeStudioTestsUi'

interface StatCardProps {
  icon: ReactNode
  value: ReactNode
  label: string
  aside?: ReactNode
}

function StatCard({ icon, value, label, aside }: StatCardProps) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border border-border-1 bg-surface-1 px-4 py-3">
      {icon}
      <div className="min-w-0">
        <div className="text-[24px] font-semibold leading-none tabular-nums text-text-1">{value}</div>
        <div className="mt-1 truncate text-[13px] text-text-3">{label}</div>
      </div>
      {aside && <div className="ml-auto shrink-0 text-right text-[13px] tabular-nums text-text-3">{aside}</div>}
    </div>
  )
}

const circle = (tone: string, icon: ReactNode) => <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${tone}`}>{icon}</span>

/** Sei schede: totale suite (con ciambella), passate, fallite, in corso, in coda e durata dell'ultima run. */
export function CodeStudioTestsStats({ stats, now }: { stats: SuiteStats; now: number }) {
  return (
    <section aria-label="Test summary" className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
      <StatCard icon={<SuiteDonut passed={stats.passed} failed={stats.failed} running={stats.running} total={stats.total} />} value={stats.total} label="Total Test Suites" />
      <StatCard icon={circle('bg-success/15 text-success', <CheckCircle2 size={22} />)} value={stats.passed} label="Passed" aside={`${stats.passedPercent}%`} />
      <StatCard icon={circle('bg-danger/15 text-danger', <XCircle size={22} />)} value={stats.failed} label="Failed" aside={`${stats.failedPercent}%`} />
      <StatCard icon={circle('bg-accent/15 text-accent', <Loader2 size={20} className={stats.running ? 'animate-spin' : ''} />)} value={stats.running} label="Running" aside={`${stats.runningPercent}%`} />
      <StatCard icon={circle('bg-surface-3 text-text-3', stats.queued ? <Hourglass size={20} /> : <MinusCircle size={22} />)} value={stats.queued} label="Queued" aside={`${stats.queuedPercent}%`} />
      <StatCard
        icon={circle('bg-surface-3 text-text-2', <Clock3 size={21} />)}
        value={stats.lastRunAt ? formatDuration(stats.lastRunDurationMs) : '—'}
        label="Last run"
        aside={stats.lastRunAt ? relativeTime(stats.lastRunAt, now) : undefined}
      />
    </section>
  )
}
