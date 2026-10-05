import { useMemo, useState } from 'react'
import { Gauge, Pin, PinOff } from 'lucide-react'
import type { GoIDETestResult, GoIDETestRun } from '@/lib/goide-tests-api'
import { formatDuration } from '@/lib/goide/goStudioTestTree'
import { benchmarkMeasurementFor, benchmarkRunDurationMillis, formatBenchmarkValue, previousBenchmarkRun } from './goStudioBenchmarks'
import { BENCHMARK_ALPHA, benchmarkBaselines, benchmarkSamplesFor, compareBenchmarkSamples, defaultBaselineKey, isMainBranch, type GoStudioBenchmarkBaseline } from './goStudioBenchmarkCompare'
import type { GoStudioBenchmarkCompareSettings, GoStudioBenchmarkHistoryEntry } from './goStudioBenchmarkHistory'

interface GoStudioBenchmarkDetailProps {
  run: GoIDETestRun
  result: GoIDETestResult
  runs: GoIDETestRun[]
  history: GoStudioBenchmarkHistoryEntry[]
  branch?: string
  settings: GoStudioBenchmarkCompareSettings
  onSettingsChange: (settings: GoStudioBenchmarkCompareSettings) => void
}

const SESSION_KEY = 'session-previous'

/** Risultato di un benchmark confrontato con una baseline scelta: run precedente, main, un commit o la baseline fissata. */
export function GoStudioBenchmarkDetail({ run, result, runs, history, branch, settings, onSettingsChange }: GoStudioBenchmarkDetailProps) {
  const measurement = benchmarkMeasurementFor(result)
  const name = result.name ?? ''
  const current = useMemo(() => benchmarkSamplesFor(result), [result])
  const options = useMemo(() => {
    const items: GoStudioBenchmarkBaseline[] = []
    const previousRun = previousBenchmarkRun(runs, run, result)
    const previousResult = previousRun?.results.find((item) => item.package === result.package && item.name === result.name)
    if (previousRun && previousResult) items.push({ key: SESSION_KEY, label: `Previous run · ${new Date(previousRun.startedAt).toLocaleTimeString()}`, startedAt: previousRun.startedAt, samples: benchmarkSamplesFor(previousResult) })
    return [...items, ...benchmarkBaselines(history, { runId: run.runId, package: result.package, name }, settings.pinnedRunId)]
  }, [history, name, result, run, runs, settings.pinnedRunId])
  const [chosen, setChosen] = useState<string | null>(null)
  const fallback = useMemo(() => {
    const preferred = defaultBaselineKey(options.filter((item) => item.key !== SESSION_KEY), branch)
    const strong = options.find((item) => item.key === preferred && (item.key === 'pinned' || (!!branch && !isMainBranch(branch) && isMainBranch(item.branch))))
    return strong?.key ?? options[0]?.key ?? null
  }, [branch, options])
  const selected = options.find((item) => item.key === chosen) ?? options.find((item) => item.key === fallback) ?? null
  const comparisons = useMemo(() => compareBenchmarkSamples(current, selected?.samples ?? [], settings.thresholdPercent), [current, selected, settings.thresholdPercent])
  if (!measurement) return null
  const duration = benchmarkRunDurationMillis(run)
  const pinned = settings.pinnedRunId === run.runId
  const regressions = comparisons.filter((item) => item.regression).length
  const missingMain = !!branch && !isMainBranch(branch) && !options.some((item) => isMainBranch(item.branch))
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3 text-[11px]">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-text-2">
        <Gauge size={14} className="text-accent" aria-hidden="true" />
        <span className="font-semibold">Benchmark result</span>
        <span className="text-text-4">· {formatBenchmarkValue(measurement.iterations)} iterations{current.length > 1 ? ` · median of ${current.length} runs` : ''}</span>
        {duration !== null && <span className="text-text-4">· {formatDuration(duration)} run</span>}
        <button type="button" onClick={() => onSettingsChange({ ...settings, pinnedRunId: pinned ? null : run.runId })} title={pinned ? 'Stop using this run as the baseline' : 'Use this run as the fixed baseline, e.g. before a refactor'} className={`ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 ${pinned ? 'bg-accent/15 text-accent' : 'text-text-3 hover:bg-surface-3 hover:text-text-1'}`}>
          {pinned ? <PinOff size={10} aria-hidden="true" /> : <Pin size={10} aria-hidden="true" />} {pinned ? 'Pinned baseline' : 'Pin as baseline'}
        </button>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[10px] text-text-3">
        <label className="flex min-w-0 items-center gap-1">Compare with
          <select value={selected?.key ?? ''} disabled={!options.length} onChange={(event) => setChosen(event.target.value)} className="min-w-0 max-w-[22rem] rounded border border-border-1 bg-surface-2 px-1 py-0.5 text-text-1">
            {!options.length && <option value="">No earlier measurement</option>}
            {options.map((item) => <option key={item.key} value={item.key}>{item.label}{item.samples.length > 1 ? ` (${item.samples.length} runs)` : ''}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1" title="A slowdown at or above this percentage is reported as a regression">Regression ≥
          <input type="number" min={0} max={1000} step={1} value={settings.thresholdPercent} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= 0 && value <= 1000) onSettingsChange({ ...settings, thresholdPercent: value }) }} className="w-12 rounded border border-border-1 bg-surface-2 px-1 py-0.5 text-text-1" />%
        </label>
        {regressions > 0 && <span className="rounded bg-danger/15 px-1.5 py-0.5 font-semibold text-danger">{regressions} regression{regressions === 1 ? '' : 's'}</span>}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {comparisons.map((item) => (
          <div key={item.unit} className={`rounded-lg border px-2.5 py-2 ${item.regression ? 'border-danger/50 bg-danger/5' : 'border-border-1 bg-surface-2/60'}`}>
            <div className="text-[10px] text-text-4">{item.unit}</div>
            <div className="mt-0.5 font-mono text-[13px] font-semibold text-text-1">{formatBenchmarkValue(item.current)}</div>
            {item.baseline !== null && item.changePercent !== null ? (
              <div className={`mt-1 text-[10px] ${item.direction === 'better' ? 'text-success' : item.direction === 'worse' ? 'text-danger' : 'text-text-4'}`}>
                {item.changePercent > 0 ? '+' : ''}{item.changePercent.toFixed(1)}% vs {formatBenchmarkValue(item.baseline)}
                <span className="ml-1 text-text-4" title={item.pValue === null ? '' : `Mann-Whitney U test, p=${item.pValue.toFixed(3)} (n=${item.currentSamples}+${item.baselineSamples})`}>
                  {item.significant === null ? '· not enough runs' : item.significant ? `· significant (p=${item.pValue!.toFixed(3)})` : `· ~ noise (p=${item.pValue!.toFixed(2)})`}
                </span>
              </div>
            ) : <div className="mt-1 text-[10px] text-text-4">{selected ? 'Metric not in the baseline' : 'No earlier matching run'}</div>}
          </div>
        ))}
      </div>
      {comparisons.some((item) => item.significant === null && item.baseline !== null) && <p className="mt-3 text-[10px] text-text-4">Significance needs at least 4 runs on each side (p ≤ {BENCHMARK_ALPHA}): rerun the benchmark with -count=4 or more.</p>}
      {missingMain && <p className="mt-2 text-[10px] text-text-4">No measurement on main yet: run this benchmark once on main to compare branch {branch} against it.</p>}
      <div className="mt-3 border-t border-border-1 pt-2 font-mono text-[10px] leading-4 text-text-3">{result.benchmark}</div>
    </div>
  )
}
