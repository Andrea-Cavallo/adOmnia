import { useMemo } from 'react'
import { layoutCallGraph } from './goStudioCallGraphLayout'
import { GoStudioGraphView } from './GoStudioGraphView'
import { codeOriginColor, formatProfilePercent, formatProfileValue, shortFunctionName, type ProfileFunction, type ProfileNode } from './goStudioProfiles'

interface GoStudioCallGraphProps {
  top: ProfileNode[]
  edges: Array<{ caller: ProfileFunction; callee: ProfileFunction; value: number[] }>
  sampleIndex: number
  total: number
  unit: string
  hideRuntime: boolean
  selected: string | null
  onSelect: (fn: ProfileFunction) => void
  onOpen: (fn: ProfileFunction) => void
}

/** Call graph a nodi delle funzioni più costose: spessore degli archi = costo della chiamata. */
export function GoStudioCallGraph({ top, edges, sampleIndex, total, unit, hideRuntime, selected, onSelect, onOpen }: GoStudioCallGraphProps) {
  const layout = useMemo(() => layoutCallGraph(top, edges, sampleIndex, { hideRuntime }), [top, edges, sampleIndex, hideRuntime])
  if (layout.nodes.length === 0) return <p className="p-4 text-[12px] text-text-4">No call data for this sample type.</p>
  return (
    <div className="min-h-0 flex-1 overflow-auto p-2">
      <p className="px-1 pb-2 text-[11px] text-text-4">The {layout.nodes.length} most expensive functions by cumulative cost. Click to highlight its calls, double-click to open the source.</p>
      <GoStudioGraphView
        layout={layout}
        label="Call graph"
        selected={selected}
        look={(node) => ({
          title: shortFunctionName(node.data),
          subtitle: `${formatProfileValue(node.weight, unit)} · ${formatProfilePercent(node.weight, total)}`,
          tooltip: `${node.data.name}\n${formatProfileValue(node.weight, unit)} cumulative (${formatProfilePercent(node.weight, total)})`,
          color: codeOriginColor(node.data),
        })}
        edgeTitle={(from, to, value) => `${shortFunctionName(from.data)} → ${shortFunctionName(to.data)}: ${formatProfileValue(value, unit)} (${formatProfilePercent(value, total)})`}
        onSelect={(node) => onSelect(node.data)}
        onOpen={(node) => onOpen(node.data)}
      />
    </div>
  )
}
