import { useCallback, useMemo, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react'
import { GitBranch } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MarkdownFileEntry } from '@/lib/markdown-api'
import type { GraphNode, MarkdownEdge } from '@/lib/markdownDoc'

interface MarkdownGraphViewProps {
  activeFile: MarkdownFileEntry | null
  agentGraphPath: string
  edgesCount: number
  filesCount: number
  folderFilter: string
  folderOptions: string[]
  graphNodes: GraphNode[]
  graphOffset: { x: number; y: number }
  graphScale: number
  showOrphans: boolean
  showUnresolved: boolean
  unresolvedCount: number
  visibleEdges: MarkdownEdge[]
  onFolderFilterChange: (value: string) => void
  onOpenFile: (file: MarkdownFileEntry) => void
  onResetLayout: () => void
  setGraphOffset: Dispatch<SetStateAction<{ x: number; y: number }>>
  setGraphPositions: Dispatch<SetStateAction<Record<string, { x: number; y: number }>>>
  setGraphScale: Dispatch<SetStateAction<number>>
  setShowOrphans: Dispatch<SetStateAction<boolean>>
  setShowUnresolved: Dispatch<SetStateAction<boolean>>
}

export function MarkdownGraphView({
  activeFile,
  agentGraphPath,
  edgesCount,
  filesCount,
  folderFilter,
  folderOptions,
  graphNodes,
  graphOffset,
  graphScale,
  showOrphans,
  showUnresolved,
  unresolvedCount,
  visibleEdges,
  onFolderFilterChange,
  onOpenFile,
  onResetLayout,
  setGraphOffset,
  setGraphPositions,
  setGraphScale,
  setShowOrphans,
  setShowUnresolved,
}: MarkdownGraphViewProps) {
  const graphSvgRef = useRef<SVGSVGElement>(null)
  const graphPointerRef = useRef({ x: 0, y: 0 })
  const [draggingNode, setDraggingNode] = useState('')
  const [isPanning, setIsPanning] = useState(false)
  const graphNodeMap = useMemo(() => new Map(graphNodes.map((node) => [node.id, node])), [graphNodes])

  const graphPoint = useCallback((event: ReactPointerEvent<SVGElement>) => {
    const svg = graphSvgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / rect.width) * 300,
      y: ((event.clientY - rect.top) / rect.height) * 184,
    }
  }, [])

  const fitGraph = useCallback(() => {
    setGraphScale(1)
    setGraphOffset({ x: 0, y: 0 })
  }, [setGraphOffset, setGraphScale])

  const zoomGraph = useCallback((delta: number) => {
    setGraphScale((current) => Math.max(0.55, Math.min(2.4, current + delta)))
  }, [setGraphScale])

  return (
    <>
      <div className="px-3 py-2 border-b border-border-1">
        <div className="flex items-center gap-2 text-xs font-semibold text-text-2">
          <GitBranch size={13} className="text-accent" />
          Graph
        </div>
        <div className="mt-1 text-[10px] text-text-4">{filesCount} notes / {edgesCount} links / {unresolvedCount} unresolved</div>
        {agentGraphPath && <div className="mt-1 truncate text-[9px] text-text-4" title={agentGraphPath}>agent graph saved</div>}
        <div className="mt-2 flex flex-wrap gap-1">
          <button onClick={fitGraph} className="rounded border border-border-2 px-1.5 py-0.5 text-[10px] text-text-3 hover:text-text-1">Fit</button>
          <button onClick={onResetLayout} className="rounded border border-border-2 px-1.5 py-0.5 text-[10px] text-text-3 hover:text-text-1">Reset</button>
          <button onClick={() => zoomGraph(0.15)} className="rounded border border-border-2 px-1.5 py-0.5 text-[10px] text-text-3 hover:text-text-1">+</button>
          <button onClick={() => zoomGraph(-0.15)} className="rounded border border-border-2 px-1.5 py-0.5 text-[10px] text-text-3 hover:text-text-1">-</button>
          <button onClick={() => setShowUnresolved((value) => !value)} className={cn('rounded border px-1.5 py-0.5 text-[10px]', showUnresolved ? 'border-accent/60 text-accent' : 'border-border-2 text-text-4')}>Unresolved</button>
          <button onClick={() => setShowOrphans((value) => !value)} className={cn('rounded border px-1.5 py-0.5 text-[10px]', showOrphans ? 'border-accent/60 text-accent' : 'border-border-2 text-text-4')}>Orphans</button>
          <select
            value={folderFilter}
            onChange={(event) => onFolderFilterChange(event.target.value)}
            className="h-5 max-w-full rounded border border-border-2 bg-surface-0 px-1 text-[10px] text-text-3 outline-none"
            title="Filter graph by folder"
          >
            <option value="">All folders</option>
            {folderOptions.map((folder) => <option key={folder} value={folder}>{folder}</option>)}
          </select>
        </div>
      </div>
      <div className="h-64 border-b border-border-1 bg-surface-0">
        {graphNodes.length === 0 ? (
          <div className="px-3 py-5 text-[11px] text-text-4">Open a folder to build the graph.</div>
        ) : (
          <svg
            ref={graphSvgRef}
            viewBox="0 0 300 184"
            className="h-full w-full cursor-grab touch-none"
            onWheel={(event) => {
              event.preventDefault()
              zoomGraph(event.deltaY < 0 ? 0.12 : -0.12)
            }}
            onPointerDown={(event) => {
              const point = graphPoint(event)
              graphPointerRef.current = point
              setIsPanning(true)
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => {
              const point = graphPoint(event)
              const prev = graphPointerRef.current
              const dx = point.x - prev.x
              const dy = point.y - prev.y
              graphPointerRef.current = point
              if (draggingNode) {
                setGraphPositions((positions) => ({
                  ...positions,
                  [draggingNode]: {
                    x: (point.x - graphOffset.x) / graphScale,
                    y: (point.y - graphOffset.y) / graphScale,
                  },
                }))
              } else if (isPanning) {
                setGraphOffset((offset) => ({ x: offset.x + dx, y: offset.y + dy }))
              }
            }}
            onPointerUp={(event) => {
              setDraggingNode('')
              setIsPanning(false)
              event.currentTarget.releasePointerCapture(event.pointerId)
            }}
            onPointerLeave={() => {
              setDraggingNode('')
              setIsPanning(false)
            }}
          >
            <rect x="0" y="0" width="300" height="184" fill="var(--color-surface-0)" />
            <g transform={`translate(${graphOffset.x} ${graphOffset.y}) scale(${graphScale})`}>
              {visibleEdges.slice(0, 160).map((edge, index) => {
                const from = graphNodeMap.get(edge.from)
                const to = graphNodeMap.get(edge.to)
                if (!from || !to) return null
                return (
                  <line
                    key={`${edge.from}-${edge.to}-${index}`}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke={edge.resolved ? 'var(--color-border-2)' : 'var(--color-warning)'}
                    opacity={edge.resolved ? 0.8 : 0.55}
                    strokeWidth="1"
                  />
                )
              })}
              {graphNodes.map((node) => {
                const active = activeFile?.relPath === node.id
                return (
                  <g
                    key={node.id}
                    role={node.file ? 'button' : 'img'}
                    className={cn(node.file && 'cursor-pointer')}
                    onPointerDown={(event) => {
                      event.stopPropagation()
                      setDraggingNode(node.id)
                      graphPointerRef.current = graphPoint(event)
                      event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId)
                    }}
                    onDoubleClick={(event) => {
                      event.stopPropagation()
                      if (node.file) onOpenFile(node.file)
                    }}
                  >
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={active ? 8 : 5.5}
                      fill={active ? 'var(--color-accent)' : node.unresolved ? 'var(--color-warning)' : 'var(--color-surface-3)'}
                      stroke="var(--color-border-1)"
                      strokeWidth="1"
                    />
                    {(active || graphNodes.length <= 24) && (
                      <text
                        x={node.x + 8}
                        y={node.y + 3}
                        fill="var(--color-text-3)"
                        fontSize="8"
                        pointerEvents="none"
                      >
                        {node.label.slice(0, 22)}
                      </text>
                    )}
                  </g>
                )
              })}
            </g>
          </svg>
        )}
      </div>
    </>
  )
}
