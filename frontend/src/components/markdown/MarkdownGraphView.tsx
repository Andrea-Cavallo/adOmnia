import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react'
import { GitBranch, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MarkdownFileEntry } from '@/lib/markdown-api'
import { classifyMemoryRelation, type GraphNode, type MarkdownEdge, type AgentMemoryRelationType } from '@/lib/markdownDoc'

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
  onOpenChange: (open: boolean) => void
  onOpenFile: (file: MarkdownFileEntry) => void
  onResetLayout: () => void
  open: boolean
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
  onOpenChange,
  onOpenFile,
  onResetLayout,
  open,
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

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onOpenChange, open])

  const relationColor = useCallback((type: AgentMemoryRelationType) => ({
    references: 'var(--color-border-2)',
    updates: 'var(--color-warning)',
    extends: 'var(--color-accent)',
    derives: '#8b5cf6',
    unresolved: 'var(--color-warning)',
  }[type]), [])

  const controls = (large: boolean) => (
    <div className="flex flex-wrap items-center gap-1">
      <button onClick={fitGraph} className={cn('rounded border border-border-2 text-text-3 hover:text-text-1', large ? 'px-2 py-1 text-[11px]' : 'px-1.5 py-0.5 text-[10px]')}>Fit</button>
      <button onClick={onResetLayout} className={cn('rounded border border-border-2 text-text-3 hover:text-text-1', large ? 'px-2 py-1 text-[11px]' : 'px-1.5 py-0.5 text-[10px]')}>Reset</button>
      <button onClick={() => zoomGraph(0.15)} className={cn('rounded border border-border-2 text-text-3 hover:text-text-1', large ? 'px-2 py-1 text-[11px]' : 'px-1.5 py-0.5 text-[10px]')}>+</button>
      <button onClick={() => zoomGraph(-0.15)} className={cn('rounded border border-border-2 text-text-3 hover:text-text-1', large ? 'px-2 py-1 text-[11px]' : 'px-1.5 py-0.5 text-[10px]')}>-</button>
      <button onClick={() => setShowUnresolved((value) => !value)} className={cn('rounded border', large ? 'px-2 py-1 text-[11px]' : 'px-1.5 py-0.5 text-[10px]', showUnresolved ? 'border-accent/60 text-accent' : 'border-border-2 text-text-4')}>Unresolved</button>
      <button onClick={() => setShowOrphans((value) => !value)} className={cn('rounded border', large ? 'px-2 py-1 text-[11px]' : 'px-1.5 py-0.5 text-[10px]', showOrphans ? 'border-accent/60 text-accent' : 'border-border-2 text-text-4')}>Orphans</button>
      <select
        value={folderFilter}
        onChange={(event) => onFolderFilterChange(event.target.value)}
        className={cn('max-w-full rounded border border-border-2 bg-surface-0 text-text-3 outline-none', large ? 'h-7 px-2 text-[11px]' : 'h-5 px-1 text-[10px]')}
        title="Filter graph by folder"
      >
        <option value="">All folders</option>
        {folderOptions.map((folder) => <option key={folder} value={folder}>{folder}</option>)}
      </select>
    </div>
  )

  const graphCanvas = (large: boolean) => (
    <div className={cn('bg-surface-0', large ? 'h-[calc(100vh-98px)]' : 'h-64 border-b border-border-1')}>
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
            {visibleEdges.slice(0, large ? 500 : 160).map((edge, index) => {
              const from = graphNodeMap.get(edge.from)
              const to = graphNodeMap.get(edge.to)
              if (!from || !to) return null
              const relation = classifyMemoryRelation(edge)
              return (
                <line
                  key={`${edge.from}-${edge.to}-${index}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={relationColor(relation)}
                  opacity={edge.resolved ? 0.82 : 0.62}
                  strokeWidth={large ? '1.35' : '1'}
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
                    r={active ? (large ? 9 : 8) : (large ? 6.4 : 5.5)}
                    fill={active ? 'var(--color-accent)' : node.unresolved ? 'var(--color-warning)' : 'var(--color-surface-3)'}
                    stroke="var(--color-border-1)"
                    strokeWidth="1"
                  />
                  {(large || active || graphNodes.length <= 24) && (
                    <text
                      x={node.x + (large ? 9 : 8)}
                      y={node.y + 3}
                      fill={active ? 'var(--color-text-1)' : 'var(--color-text-3)'}
                      fontSize={large ? '5.8' : '8'}
                      pointerEvents="none"
                    >
                      {node.label.slice(0, large ? 34 : 22)}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        </svg>
      )}
    </div>
  )

  const legend = (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-4">
      {(['references', 'updates', 'extends', 'derives', 'unresolved'] as AgentMemoryRelationType[]).map((type) => (
        <span key={type} className="inline-flex items-center gap-1">
          <span className="h-1.5 w-4 rounded-full" style={{ background: relationColor(type) }} />
          {type}
        </span>
      ))}
    </div>
  )

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-[90] flex flex-col bg-surface-0">
          <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border-1 px-4 py-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-text-1">
                <GitBranch size={15} className="text-accent" />
                Markdown Graph
              </div>
              <div className="mt-0.5 text-[10px] text-text-4">{filesCount} notes / {edgesCount} links / {unresolvedCount} unresolved</div>
              {agentGraphPath && <div className="mt-0.5 truncate text-[9px] text-text-4" title={agentGraphPath}>agent graph saved</div>}
            </div>
            <div className="flex items-center gap-3">
              {controls(true)}
              <button type="button" onClick={() => onOpenChange(false)} className="rounded border border-border-2 p-1.5 text-text-3 hover:text-text-1" title="Close graph">
                <X size={15} />
              </button>
            </div>
          </div>
          <div className="border-b border-border-1 px-4 py-2">{legend}</div>
          {graphCanvas(true)}
        </div>
      )}
    </>
  )
}
