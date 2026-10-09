import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, Flame } from 'lucide-react'
import { cn } from '@/lib/utils'
import { maxWeight, type ExecutionPlan, type PlanNode } from './explainPlan'

interface PlanViewProps {
  plan: ExecutionPlan
  analyzed: boolean
}

function NodeRow({ node, depth, max, analyzed }: { node: PlanNode; depth: number; max: number; analyzed: boolean }) {
  const [open, setOpen] = useState(true)
  const share = max > 0 ? node.weight / max : 0
  const hottest = max > 0 && node.weight === max
  return (
    <>
      <div
        className="group grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-border-1 px-3 py-2 hover:bg-surface-1"
        style={{ paddingLeft: 12 + depth * 18 }}
      >
        <div className="flex min-w-0 items-start gap-1.5">
          <button
            type="button"
            aria-label={open ? 'Collapse step' : 'Expand step'}
            onClick={() => setOpen((v) => !v)}
            className={cn('mt-0.5 grid h-4 w-4 flex-none place-items-center rounded text-text-4 hover:text-text-1', !node.children.length && 'invisible')}
          >
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[12px] font-semibold text-text-1">{node.label}</span>
              {hottest && (
                <span className="flex items-center gap-1 rounded bg-error/10 px-1.5 py-px text-[10px] font-semibold text-error">
                  <Flame size={10} /> {analyzed ? 'slowest step' : 'most expensive step'}
                </span>
              )}
              {node.warn && (
                <span className="flex items-center gap-1 rounded bg-warning/10 px-1.5 py-px text-[10px] font-semibold text-warning">
                  <AlertTriangle size={10} /> {node.warn}
                </span>
              )}
            </div>
            {node.detail && <div className="mt-0.5 break-words font-mono text-[11px] text-text-3">{node.detail}</div>}
          </div>
        </div>
        <div className="flex flex-none flex-col items-end gap-1">
          <div className="flex flex-wrap justify-end gap-1">
            {node.metrics.map(([k, v]) => (
              <span key={k} className="rounded border border-border-2 bg-surface-2 px-1.5 py-px text-[10.5px] text-text-3">
                {k} <span className="font-mono text-text-1">{v}</span>
              </span>
            ))}
          </div>
          {max > 0 && (
            <div className="h-1 w-32 overflow-hidden rounded-full bg-surface-3" title={`Own ${analyzed ? 'time' : 'cost'}, excluding child steps: ${Math.round(share * 100)}% of the heaviest step`}>
              <div className={cn('h-full rounded-full', hottest ? 'bg-error' : 'bg-accent')} style={{ width: `${Math.max(share * 100, 2)}%` }} />
            </div>
          )}
        </div>
      </div>
      {open && node.children.map((child, i) => <NodeRow key={i} node={child} depth={depth + 1} max={max} analyzed={analyzed} />)}
    </>
  )
}

export function PlanView({ plan, analyzed }: PlanViewProps) {
  const max = maxWeight(plan.nodes)
  return (
    <div className="flex flex-col">
      <div className="flex h-8 flex-none items-center gap-3 border-b border-border-1 bg-surface-1 px-3 text-[11px] text-text-3">
        <span className="font-semibold text-text-2">{analyzed ? 'Measured plan (EXPLAIN ANALYZE)' : 'Estimated plan'}</span>
        {plan.summary.map(([k, v]) => (
          <span key={k}>{k} <span className="font-mono text-text-1">{v}</span></span>
        ))}
        {max > 0 && <span className="ml-auto text-text-4">Bars compare {analyzed ? 'measured time' : 'estimated cost'} across steps</span>}
      </div>
      {plan.nodes.map((node, i) => <NodeRow key={i} node={node} depth={0} max={max} analyzed={analyzed} />)}
    </div>
  )
}
