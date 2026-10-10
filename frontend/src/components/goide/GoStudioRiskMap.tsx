import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import * as GoIDE from '../../../bindings/adomnia/goide'
import type { GraphRiskMap } from '../../../bindings/adomnia/internal/goide/models'
import type { GraphRef } from '@/lib/goide/workspaceGraph'

/** Risk map: how risky a change is, function by function, summed per package (riskiest first). */
export function GoStudioRiskMap({ sessionId, onFocus }: { sessionId: string; onFocus: (ref: GraphRef) => void }) {
  const [map, setMap] = useState<GraphRiskMap | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setMap(null)
    GoIDE.GraphRiskMap(sessionId).then((result) => { if (!cancelled) setMap(result) }, (problem) => { if (!cancelled) setError(problem instanceof Error ? problem.message : String(problem)) })
    return () => { cancelled = true }
  }, [sessionId])
  if (error) return <p className="p-3 text-[11.5px] text-danger">{error}</p>
  if (!map) return <p className="flex items-center gap-2 p-3 text-[11.5px] text-text-3"><Loader2 size={13} className="animate-spin" />Scoring every function of the project…</p>
  const packages = map.packages ?? []
  const widest = Math.max(1, ...packages.map((item) => item.high + item.medium + item.low))
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      <p className="mb-2 text-[11px] text-text-4">Change risk of every function: high means public APIs or other modules depend on it and few tests reach it.{map.truncated ? ' Very large project: the first 3000 functions.' : ''}</p>
      <ul className="space-y-2">
        {packages.map((item) => {
          const total = item.high + item.medium + item.low
          return (
            <li key={item.package} className="rounded-md border border-border-1 px-2 py-1.5">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text-1" title={item.package}>{item.package}</span>
                <span className="shrink-0 text-[10.5px] text-text-4">{item.high} high · {item.medium} medium · {item.low} low</span>
              </div>
              <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-surface-2" style={{ width: `${Math.max(8, (total / widest) * 100)}%` }} aria-hidden="true">
                <span className="bg-danger" style={{ width: `${(item.high / total) * 100}%` }} />
                <span className="bg-warning" style={{ width: `${(item.medium / total) * 100}%` }} />
                <span className="bg-success/60" style={{ width: `${(item.low / total) * 100}%` }} />
              </div>
              {!!item.riskiest?.length && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {item.riskiest.map((node) => (
                    <button key={node.id} type="button" onClick={() => onFocus({ node, depth: 0 })} title="Analyze the impact of this function" className="rounded bg-danger/10 px-1.5 py-0.5 font-mono text-[10.5px] text-danger hover:bg-danger/20">{node.label}</button>
                  ))}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
