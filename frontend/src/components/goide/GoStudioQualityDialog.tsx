import { useMemo } from 'react'
import { Gauge, ScanSearch } from 'lucide-react'
import type { GoIDESession } from '@/lib/goide-api'
import { mergedReports, useGoIDELspStore } from '@/stores/goideLsp'
import { useGoIDETestsStore } from '@/stores/goideTests'
import { useGoIDEStore } from '@/stores/goide'
import { GoStudioButton, GoStudioModal } from './GoStudioModal'
import { flakyRecords, loadFlakyHistory } from './goStudioFlakyHistory'
import { debtTrend, loadLintSamples, qualityBreakdown, type GoStudioLintSample } from './goStudioQualityHistory'

interface GoStudioQualityDialogProps {
  session: GoIDESession
  open: boolean
  onClose: () => void
}

function Sparkline({ samples }: { samples: GoStudioLintSample[] }) {
  if (samples.length < 2) return <span className="text-[11px] text-text-4">The trend appears after two full lint runs.</span>
  const totals = samples.map((sample) => sample.issues + sample.baselined)
  const max = Math.max(...totals, 1)
  const points = totals.map((value, index) => `${(index / (totals.length - 1)) * 200},${38 - (value / max) * 34}`).join(' ')
  return (
    <svg viewBox="0 0 200 40" className="h-10 w-52" role="img" aria-label={`Lint findings over ${samples.length} runs`}>
      <polyline points={points} fill="none" stroke="var(--color-accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function Metric({ label, value, detail, tone = '' }: { label: string; value: string; detail?: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border-1 bg-surface-2/60 px-3 py-2">
      <div className="text-[11px] text-text-4">{label}</div>
      <div className={`mt-0.5 font-mono text-[18px] font-semibold ${tone || 'text-text-1'}`}>{value}</div>
      {detail && <div className="mt-0.5 text-[11px] text-text-4">{detail}</div>}
    </div>
  )
}

/** Quality: problemi gopls e linter, trend del debito, coverage e test flaky del progetto, tutto locale. */
export function GoStudioQualityDialog({ session, open, onClose }: GoStudioQualityDialogProps) {
  const sessionId = session.id
  const diagnostics = useGoIDELspStore((state) => state.diagnostics[sessionId])
  const lint = useGoIDELspStore((state) => state.lint[sessionId])
  const runs = useGoIDETestsStore((state) => state.runs[sessionId])
  const openLocation = useGoIDEStore((state) => state.openLocation)
  const reports = useMemo(() => Object.values(mergedReports(diagnostics, lint?.reports)), [diagnostics, lint?.reports])
  const breakdown = useMemo(() => qualityBreakdown(reports), [reports])
  const samples = useMemo(() => (open ? loadLintSamples(session.project.rootPath) : []), [open, session.project.rootPath, lint?.result])
  const flaky = useMemo(() => (open ? flakyRecords(loadFlakyHistory(session.project.rootPath)).size : 0), [open, session.project.rootPath, runs])
  if (!open) return null
  const trend = debtTrend(samples)
  const errors = reports.reduce((sum, report) => sum + report.diagnostics.filter((item) => item.severity === 1).length, 0)
  const coverage = runs?.find((run) => run.coverage)?.coverage ?? null
  const runLint = () => { useGoIDELspStore.getState().showToolWindow('problems'); void useGoIDELspStore.getState().runLint(sessionId) }
  return (
    <GoStudioModal open={open} onClose={onClose} size="lg" icon={Gauge} title="Code quality" subtitle="Measured on this machine from gopls, the linter and your test runs."
      footer={<><GoStudioButton variant="ghost" onClick={onClose}>Close</GoStudioButton><GoStudioButton variant="primary" icon={ScanSearch} loading={lint?.running} onClick={runLint}>Run linter</GoStudioButton></>}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Errors (gopls + lint)" value={String(errors)} tone={errors ? 'text-danger' : 'text-success'} />
        <Metric label="Lint findings" value={lint?.result ? String(lint.result.issueCount) : '—'} detail={lint?.result?.baselined ? `+${lint.result.baselined} accepted in baseline` : lint?.result?.changedOnly ? 'changed files only' : undefined} />
        <Metric label="Coverage" value={coverage ? `${coverage.percent.toFixed(1)}%` : '—'} detail={coverage ? `${coverage.covered}/${coverage.statements} statements` : 'Run tests with coverage'} />
        <Metric label="Known flaky tests" value={String(flaky)} tone={flaky ? 'text-warning' : ''} />
      </div>
      <div className="mt-4 flex items-center gap-3">
        <div>
          <div className="text-[12px] font-semibold text-text-2">Technical debt trend</div>
          <div className="text-[11px] text-text-4">
            {trend ? <>Now {trend.current} findings (visible + baseline), {trend.delta === 0 ? 'unchanged' : `${trend.delta > 0 ? '+' : ''}${trend.delta}`} since the first of {samples.length} runs{trend.direction === 'better' ? ' · improving' : trend.direction === 'worse' ? ' · growing' : ''}</> : 'No full lint run recorded yet.'}
          </div>
        </div>
        <div className="ml-auto"><Sparkline samples={samples} /></div>
      </div>
      {reports.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-4 text-[12px]">
          <section aria-label="Findings by rule">
            <div className="mb-1 font-semibold text-text-2">Top rules</div>
            {breakdown.bySource.map((item) => <div key={item.name} className="flex h-6 items-center gap-2 text-text-3"><span className="truncate font-mono text-[11.5px]">{item.name}</span><span className="ml-auto">{item.count}</span></div>)}
          </section>
          <section aria-label="Findings by file">
            <div className="mb-1 font-semibold text-text-2">Top files</div>
            {breakdown.byFile.map((item) => (
              <button key={item.relativePath} type="button" onClick={() => { onClose(); void openLocation(item.relativePath, 1, 1) }} className="flex h-6 w-full items-center gap-2 text-left text-text-3 hover:text-text-1">
                <span className="truncate font-mono text-[11.5px]">{item.relativePath}</span><span className="ml-auto">{item.count}</span>
              </button>
            ))}
          </section>
        </div>
      )}
    </GoStudioModal>
  )
}
