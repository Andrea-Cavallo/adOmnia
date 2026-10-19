import type { Snapshot } from '../../../bindings/adomnia/internal/resources/models'
import { resourceChartPath } from '@/lib/resourceReport'

export function ResourceChart({ samples }: { samples: Snapshot[] }) {
  if (samples.length < 2) return null
  return <div className="my-3 grid grid-cols-2 gap-3" aria-label="CPU / RAM">
    {(['cpu','ram'] as const).map(metric => {
      const chart = resourceChartPath(samples,metric)
      return <figure key={metric} className="min-w-0">
        <figcaption className="mb-1 flex justify-between font-mono text-[10px] text-text-3"><span>{metric.toUpperCase()}</span><span>{metric==='cpu'?'0–100%':`0–${(chart.max/1048576).toFixed(0)} MiB`}</span></figcaption>
        <svg viewBox="0 0 600 88" preserveAspectRatio="none" className="h-14 w-full border-b border-border-2" role="img" aria-label={`${metric.toUpperCase()} ${samples[0].at} → ${samples[samples.length-1].at}`}>
          <path d="M0 44H600" fill="none" stroke="currentColor" className="text-border-2" strokeDasharray="3 8"/>
          <path d={chart.path} fill="none" stroke="currentColor" className={metric==='cpu'?'text-accent':'text-text-2'} strokeWidth="1.5" vectorEffect="non-scaling-stroke"/>
        </svg>
        <div className="mt-1 flex justify-between font-mono text-[9px] text-text-4"><time>{new Date(samples[0].at).toLocaleTimeString()}</time><time>{new Date(samples[samples.length-1].at).toLocaleTimeString()}</time></div>
      </figure>
    })}
  </div>
}
