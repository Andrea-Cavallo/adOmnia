import type { FlowStressConfig } from '@/lib/flowStress'
import { baselineStep, type StressBaseline } from '@/lib/flowStressExport'
import { chartPoints, distributionChartModel, latencyChartModel, timelineChartModel, trendChartModel, workloadChartModel } from '@/lib/flowStressCharts'
import type { StressStats } from '@/lib/flowStressStats'
import type { StressHistoryEntry } from '@/lib/flowStressHistory'

interface FlowStressChartsProps {
  stats: StressStats
  config: FlowStressConfig
  baseline?: StressBaseline | null
  history?: StressHistoryEntry[]
}

const axisText = { fill: 'var(--color-text-4)', fontSize: 9, fontFamily: 'ui-monospace, monospace' }
const trimLabel = (label: string) => label.length > 24 ? `${label.slice(0, 22)}…` : label

function LegendItem({ color, label, dashed, dot }: { color: string; label: string; dashed?: boolean; dot?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={dot ? 'h-2 w-2 rounded-full' : 'h-0.5 w-4'} style={{ background: color, ...(dashed ? { backgroundImage: `linear-gradient(90deg, ${color} 55%, transparent 55%)`, backgroundSize: '5px 1px' } : {}) }} />
      {label}
    </span>
  )
}

function TimelineChart({ stats }: { stats: StressStats }) {
  const model = timelineChartModel(stats.timeline)
  const area = model.requestPoints.length
    ? `${model.plot.left},${model.plot.top + model.plot.height} ${chartPoints(model.requestPoints)} ${model.plot.left + model.plot.width},${model.plot.top + model.plot.height}`
    : ''
  const peakRps = Math.max(0, ...stats.timeline.map((point) => point.requests))
  const peakErrorRate = Math.max(0, ...model.errorRatePoints.map((point) => point.value))

  return (
    <article className="rounded-xl border border-border-1 bg-surface-0 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-[11px] font-semibold text-text-1">Traffic over time</h3>
          <p className="text-[10px] text-text-4">Completed requests per one-second bucket; error rate uses its own right axis.</p>
        </div>
        <div className="flex flex-wrap gap-3 text-[9px] text-text-3">
          <LegendItem color="var(--color-accent)" label="Throughput · left" />
          <LegendItem color="var(--color-error)" label="Error rate · right" dashed />
        </div>
      </div>
      <div className="mt-2 overflow-x-auto">
        <svg viewBox={`0 0 ${model.width} ${model.height}`} className="h-auto w-full min-w-[600px]" role="img" aria-label={`Traffic over time. Peak ${peakRps} requests per second and ${peakErrorRate}% errors.`}>
          <defs>
            <linearGradient id="stress-throughput-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--color-accent)" stopOpacity="0.24" />
              <stop offset="1" stopColor="var(--color-accent)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {model.requestTicks.map((tick) => <line key={tick.y} x1={model.plot.left} x2={model.plot.left + model.plot.width} y1={tick.y} y2={tick.y} stroke="var(--color-border-1)" strokeWidth="1" />)}
          {area && <polygon points={area} fill="url(#stress-throughput-area)" />}
          <polyline points={chartPoints(model.requestPoints)} fill="none" stroke="var(--color-accent)" strokeWidth="2.25" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          <polyline points={chartPoints(model.errorRatePoints)} fill="none" stroke="var(--color-error)" strokeWidth="1.75" strokeDasharray="5 4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {model.requestPoints.map((point, index) => <circle key={`r-${index}`} cx={point.x} cy={point.y} r="7" fill="transparent"><title>{point.label}</title></circle>)}
          {model.errorRatePoints.map((point, index) => <circle key={`e-${index}`} cx={point.x} cy={point.y} r={point.value ? 2.5 : 0} fill="var(--color-error)"><title>{point.label}</title></circle>)}
          {model.requestTicks.map((tick) => <text key={`left-${tick.y}`} x={model.plot.left - 7} y={tick.y + 3} textAnchor="end" style={axisText}>{tick.label}</text>)}
          {model.errorTicks.map((tick) => <text key={`right-${tick.y}`} x={model.plot.left + model.plot.width + 7} y={tick.y + 3} textAnchor="start" style={axisText}>{tick.label}</text>)}
          {model.xTicks.map((tick) => <text key={`${tick.x}-${tick.label}`} x={tick.x} y={model.height - 8} textAnchor="middle" style={axisText}>{tick.label}</text>)}
          <text x="8" y="11" style={axisText}>req/s</text>
          <text x={model.width - 5} y="11" textAnchor="end" style={axisText}>errors</text>
        </svg>
      </div>
      <p className="mt-1 font-mono text-[9px] text-text-4">Peak {peakRps} req/s · peak error rate {peakErrorRate}% · hover points for exact values</p>
    </article>
  )
}

function LatencyChart({ stats, config, baseline }: FlowStressChartsProps) {
  const model = latencyChartModel(stats.steps, config.maxP95Ms ?? 0)
  return (
    <article className="rounded-xl border border-border-1 bg-surface-0 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-[11px] font-semibold text-text-1">Latency by flow step</h3>
          <p className="text-[10px] text-text-4">The p95 bar identifies the bottleneck; p50 and p99 show the spread.</p>
        </div>
        <div className="flex flex-wrap gap-3 text-[9px] text-text-3">
          <LegendItem color="var(--color-accent)" label="p95" />
          <LegendItem color="var(--color-text-2)" label="p50" dot />
          <LegendItem color="var(--color-surface-4)" label="p99 range" />
          {(config.maxP95Ms ?? 0) > 0 && <LegendItem color="var(--color-error)" label="SLO" dashed />}
          {baseline && <LegendItem color="var(--color-success)" label="baseline p95" dot />}
        </div>
      </div>
      <div className="mt-2 overflow-x-auto">
        <svg viewBox={`0 0 ${model.width} ${model.height}`} className="h-auto w-full min-w-[600px]" role="img" aria-label={`Latency percentiles for ${stats.steps.length} flow steps.`}>
          {model.ticks.map((tick) => <g key={tick.x}><line x1={tick.x} x2={tick.x} y1={model.plot.top - 5} y2={model.height - model.plot.bottom} stroke="var(--color-border-1)" /><text x={tick.x} y={model.height - 7} textAnchor="middle" style={axisText}>{tick.label}</text></g>)}
          {model.rows.map((row) => {
            const base = baselineStep(baseline?.stats ?? stats, row.step)?.p95
            const baseX = baseline && base !== undefined ? model.plot.left + (Math.min(model.maxMs, base) / model.maxMs) * model.plot.width : undefined
            return (
              <g key={row.step.nodeId}>
                <text x={model.plot.left - 9} y={row.y + 3} textAnchor="end" style={{ ...axisText, fill: 'var(--color-text-2)', fontSize: 10 }}>{trimLabel(row.step.step)}<title>{row.step.step}</title></text>
                <rect x={model.plot.left} y={row.y - 7} width={Math.max(1, row.p99X - model.plot.left)} height="14" rx="3" fill="var(--color-surface-3)" />
                <rect x={model.plot.left} y={row.y - 3} width={Math.max(1, row.p95X - model.plot.left)} height="6" rx="3" fill="var(--color-accent)" />
                <circle cx={row.p50X} cy={row.y} r="3" fill="var(--color-text-1)" stroke="var(--color-surface-0)" strokeWidth="1.5" />
                {baseX !== undefined && <path d={`M ${baseX} ${row.y - 8} V ${row.y + 8}`} stroke="var(--color-success)" strokeWidth="2" />}
                <rect x={model.plot.left} y={row.y - 12} width={model.plot.width} height="24" fill="transparent"><title>{`${row.step.step}: p50 ${row.step.p50} ms · p95 ${row.step.p95} ms · p99 ${row.step.p99} ms${base !== undefined && baseline ? ` · baseline p95 ${base} ms` : ''}`}</title></rect>
                <text x={Math.min(model.width - 4, row.p95X + 6)} y={row.y + 3} style={{ ...axisText, fill: 'var(--color-text-2)' }}>{row.step.p95}</text>
              </g>
            )
          })}
          {model.thresholdX !== undefined && <g><line x1={model.thresholdX} x2={model.thresholdX} y1={model.plot.top - 8} y2={model.height - model.plot.bottom} stroke="var(--color-error)" strokeWidth="1.5" strokeDasharray="5 4" /><text x={model.thresholdX + 4} y={11} style={{ ...axisText, fill: 'var(--color-error)' }}>SLO {config.maxP95Ms} ms</text></g>}
        </svg>
      </div>
    </article>
  )
}

function WorkloadChart({ stats }: { stats: StressStats }) {
  const model = workloadChartModel(stats.timeline)
  return (
    <article className="rounded-xl border border-border-1 bg-surface-0 p-3">
      <div className="flex items-start justify-between gap-2">
        <div><h3 className="text-[11px] font-semibold text-text-1">Active virtual users</h3><p className="text-[10px] text-text-4">Actual concurrency over time makes ramps, spikes and recovery visible.</p></div>
        <div className="text-[9px] text-text-3"><LegendItem color="var(--color-info)" label={`Peak ${Math.max(0, ...stats.timeline.map((point) => point.activeVus ?? 0))} VUs`} /></div>
      </div>
      <div className="mt-2 overflow-x-auto"><svg viewBox={`0 0 ${model.width} ${model.height}`} className="h-auto w-full min-w-[600px]" role="img" aria-label="Active virtual users over time">
        {model.ticks.map((tick) => <g key={tick.y}><line x1={model.plot.left} x2={model.plot.left + model.plot.width} y1={tick.y} y2={tick.y} stroke="var(--color-border-1)" /><text x={model.plot.left - 7} y={tick.y + 3} textAnchor="end" style={axisText}>{tick.label}</text></g>)}
        <polyline points={chartPoints(model.points)} fill="none" stroke="var(--color-info)" strokeWidth="2.25" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {model.points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="7" fill="transparent"><title>{point.label}</title></circle>)}
        {model.xTicks.map((tick) => <text key={`${tick.x}-${tick.label}`} x={tick.x} y={model.height - 8} textAnchor="middle" style={axisText}>{tick.label}</text>)}
      </svg></div>
    </article>
  )
}

function DistributionChart({ stats }: { stats: StressStats }) {
  const model = distributionChartModel(stats.distribution)
  return (
    <article className="rounded-xl border border-border-1 bg-surface-0 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h3 className="text-[11px] font-semibold text-text-1">Latency distribution</h3><p className="text-[10px] text-text-4">Request share per latency band; the last bar isolates values beyond p99.</p></div>
        <span className="font-mono text-[9px] text-text-3">APDEX {stats.apdex.score} · T={stats.apdex.thresholdMs}ms</span>
      </div>
      <div className="mt-2 overflow-x-auto"><svg viewBox={`0 0 ${model.width} ${model.height}`} className="h-auto w-full min-w-[600px]" role="img" aria-label="Latency distribution histogram">
        {model.ticks.map((tick) => <g key={tick.y}><line x1={model.plot.left} x2={model.plot.left + model.plot.width} y1={tick.y} y2={tick.y} stroke="var(--color-border-1)" /><text x={model.plot.left - 7} y={tick.y + 3} textAnchor="end" style={axisText}>{tick.label}</text></g>)}
        {model.bars.map((bar, index) => <g key={index}><rect x={bar.x} y={bar.y} width={bar.width} height={Math.max(1, bar.height)} rx="2" fill={index === model.bars.length - 1 && stats.distribution[index]?.overflow ? 'var(--color-warning)' : 'var(--color-accent)'}><title>{bar.label}</title></rect><text x={bar.x + bar.width / 2} y={model.height - 24 + (index % 2) * 10} textAnchor="middle" style={{ ...axisText, fontSize: 8 }}>{stats.distribution[index]?.overflow ? `>${stats.distribution[index].fromMs}` : stats.distribution[index]?.toMs}</text></g>)}
      </svg></div>
    </article>
  )
}

function TrendChart({ history }: { history: StressHistoryEntry[] }) {
  const model = trendChartModel(history)
  return (
    <article className="rounded-xl border border-border-1 bg-surface-0 p-3 2xl:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-[11px] font-semibold text-text-1">Regression trend</h3><p className="text-[10px] text-text-4">Last {history.length} persisted runs, oldest to newest. Independent axes keep latency and throughput readable.</p></div><div className="flex gap-3 text-[9px] text-text-3"><LegendItem color="var(--color-warning)" label="p95 · left" /><LegendItem color="var(--color-success)" label="RPS · right" /></div></div>
      <div className="mt-2 overflow-x-auto"><svg viewBox={`0 0 ${model.width} ${model.height}`} className="h-auto w-full min-w-[600px]" role="img" aria-label="p95 latency and throughput trend across saved runs">
        {[0, 0.5, 1].map((fraction) => <g key={fraction}><line x1={model.plot.left} x2={model.plot.left + model.plot.width} y1={model.plot.top + model.plot.height * (1 - fraction)} y2={model.plot.top + model.plot.height * (1 - fraction)} stroke="var(--color-border-1)" /><text x={model.plot.left - 7} y={model.plot.top + model.plot.height * (1 - fraction) + 3} textAnchor="end" style={axisText}>{Math.round(model.p95Max * fraction)}ms</text><text x={model.plot.left + model.plot.width + 7} y={model.plot.top + model.plot.height * (1 - fraction) + 3} style={axisText}>{Math.round(model.rpsMax * fraction)}</text></g>)}
        <polyline points={chartPoints(model.p95Points)} fill="none" stroke="var(--color-warning)" strokeWidth="2" /><polyline points={chartPoints(model.rpsPoints)} fill="none" stroke="var(--color-success)" strokeWidth="2" />
        {[...model.p95Points, ...model.rpsPoints].map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="6" fill="transparent"><title>{point.label}</title></circle>)}
      </svg></div>
    </article>
  )
}

export function FlowStressCharts(props: FlowStressChartsProps) {
  if (props.stats.timeline.length < 2 && props.stats.steps.length === 0) return null
  return (
    <div className="grid gap-2 2xl:grid-cols-2">
      {props.stats.timeline.length > 1 && <TimelineChart stats={props.stats} />}
      {props.stats.timeline.length > 1 && <WorkloadChart stats={props.stats} />}
      {props.stats.steps.length > 0 && <LatencyChart {...props} />}
      {props.stats.distribution.length > 0 && <DistributionChart stats={props.stats} />}
      {(props.history?.length ?? 0) >= 2 && <TrendChart history={props.history!} />}
    </div>
  )
}
