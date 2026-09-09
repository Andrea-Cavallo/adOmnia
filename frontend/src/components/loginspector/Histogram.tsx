import { cn } from '@/lib/utils'
import type { HistogramBucket } from '@/lib/loginspector'

interface HistogramProps {
  buckets: HistogramBucket[]
  /** Click a bar to narrow the time range to it. */
  onSelectRange: (from: number, to: number) => void
  className?: string
}

/** Mini time histogram: total events per bucket, error share in red. */
export function Histogram({ buckets, onSelectRange, className }: HistogramProps) {
  if (buckets.length === 0) return null
  const peak = Math.max(...buckets.map((bucket) => bucket.total), 1)
  const first = buckets[0]
  const last = buckets[buckets.length - 1]

  return (
    <div className={cn('flex shrink-0 flex-col gap-0.5 border-b border-border-1 bg-surface-1 px-3 py-1.5', className)}>
      <div className="flex h-8 items-end gap-[1px]">
        {buckets.map((bucket, index) => {
          const height = Math.round((bucket.total / peak) * 100)
          const errorHeight = bucket.total > 0 ? Math.round((bucket.errors / bucket.total) * height) : 0
          return (
            <button
              key={index}
              onClick={() => onSelectRange(Math.floor(bucket.start), Math.ceil(bucket.end))}
              title={`${new Date(bucket.start).toLocaleTimeString()} — ${bucket.total} events, ${bucket.errors} errors`}
              className="group relative flex min-w-[2px] flex-1 flex-col justify-end"
              style={{ height: '100%' }}
            >
              <span className="w-full bg-error/80" style={{ height: `${errorHeight}%` }} />
              <span className="w-full bg-accent/55 transition-colors group-hover:bg-accent" style={{ height: `${Math.max(height - errorHeight, bucket.total > 0 ? 2 : 0)}%` }} />
            </button>
          )
        })}
      </div>
      <div className="flex justify-between font-mono text-[9px] text-text-4">
        <span>{new Date(first.start).toLocaleTimeString()}</span>
        <span>peak {peak}</span>
        <span>{new Date(last.end).toLocaleTimeString()}</span>
      </div>
    </div>
  )
}
