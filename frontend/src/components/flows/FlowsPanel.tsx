import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  FileInput,
  FileJson,
  GitBranch,
  GitFork,
  Grid3X3,
  Loader2,
  Maximize2,
  MoreVertical,
  PanelRight,
  List,
  Focus,
  Play,
  Plus,
  Save,
  Search,
  Server,
  Sparkles,
  Trash2,
  X,
  XCircle,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import {
  DEFAULT_MERMAID_FLOW,
  graphFromMermaid,
  matchCatalogRequest,
  type ApiCatalogRequest,
} from '@/lib/flowMermaid'
import { appendMockEndpoints } from '@/lib/mockEndpointStore'
import {
  createMockCommerceCollection,
  createMockCommerceEndpoints,
  createMockCommerceFlow,
  MOCK_FLOW_DEMO_NAME,
} from '@/lib/mockFlowDemo'
import { runApiFlow, validateFlowGraph, type RunEntry, type RuntimeByNode } from '@/lib/flowRunner'
import { handleKeyboardActivation } from '@/lib/accessibility'
import {
  loadFlowDefinitions,
  saveFlowDefinitions,
  createBlankFlowGraph,
  normalizeFlowDefinitions,
  type FlowCondition,
  type FlowEdgeDefinition,
  type FlowGraphDefinition,
  type FlowNodeDefinition,
  type FlowRunStatus,
  type SavedFlowDefinition,
} from '@/lib/flowStorage'
import { flattenApiCatalog } from '@/lib/apiCatalog'
import { generateAiFlowPreview, type AiFlowPreview } from '@/lib/aiFlow'
import { blankRequest, type RequestItem, uid } from '@/lib/types'
import { cn } from '@/lib/utils'
import { serverUrl, sidecarFetch, useServerPort } from '@/lib/useServerPort'
import { useAppStore } from '@/stores/app'
import { useCollectionsStore } from '@/stores/collections'
import { useEnvironmentsStore } from '@/stores/environments'
import { useSettingsStore } from '@/stores/settings'
import { useFlowCanvasInteraction } from './useFlowCanvasInteraction'
import { FlowDockPanel } from './FlowDockPanel'
import { Composer } from '@/components/composer/Composer'
import { ScopedVarsContext, flowScopeVars } from '@/lib/flowScopeVars'
import { flowEdgePath, flowNodeSize as nodeSize, layoutFlow } from '@/lib/flowLayout'


type InspectorTab = 'request' | 'response' | 'tests' | 'variables' | 'conditions'

function normalizeName(text: string) {
  return text.trim().replace(/\s+/g, '_').replace(/[^\w.-]/g, '').toLowerCase()
}

function nodeOverrideKey(node: FlowNodeDefinition) {
  return node.mermaidKey || normalizeName(node.label)
}

function requestOverridesFromGraph(graph: FlowGraphDefinition): Record<string, RequestItem> {
  return Object.fromEntries(graph.nodes
    .filter((node) => node.type === 'request' && node.config.request)
    .map((node) => [nodeOverrideKey(node), node.config.request as RequestItem]))
}

function conditionOverridesFromGraph(graph: FlowGraphDefinition): Record<string, FlowCondition> {
  return Object.fromEntries(graph.nodes
    .filter((node) => node.type === 'condition' && node.config.condition)
    .map((node) => [nodeOverrideKey(node), node.config.condition as FlowCondition]))
}

function downloadBlob(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function exportRunMarkdown(flowName: string, run: RunEntry[]) {
  const lines = [`# Flow run: ${flowName}`, '', `Generated: ${new Date().toISOString()}`, '']
  lines.push('| Step | Status | HTTP | Duration | Error |')
  lines.push('| --- | --- | ---: | ---: | --- |')
  run.forEach((entry) => {
    lines.push(`| ${entry.nodeLabel} | ${entry.status.toUpperCase()} | ${entry.httpStatus ?? '-'} | ${Math.round(entry.durationMs)}ms | ${(entry.error ?? '').replace(/\|/g, '\\|')} |`)
  })
  return lines.join('\n')
}

function methodTone(method?: string) {
  if (method === 'GET') return 'text-[var(--color-method-get)]'
  if (method === 'QUERY') return 'text-info'
  if (method === 'POST') return 'text-[var(--color-method-post)]'
  if (method === 'PUT') return 'text-[var(--color-method-put)]'
  if (method === 'PATCH') return 'text-[var(--color-method-patch)]'
  if (method === 'DELETE') return 'text-[var(--color-method-delete)]'
  return 'text-info'
}

function statusTheme(status?: FlowRunStatus) {
  if (status === 'success') return 'border-success/45 bg-success/10 text-success'
  if (status === 'failed') return 'border-error/45 bg-error/10 text-error'
  if (status === 'running') return 'border-accent/60 bg-accent/12 text-accent shadow-[0_0_0_3px_rgba(139,61,255,0.16)]'
  if (status === 'skipped') return 'border-warning/45 bg-warning/10 text-warning opacity-70'
  if (status === 'missing-binding') return 'border-warning/45 bg-warning/10 text-warning'
  if (status === 'broken') return 'border-error/45 bg-error/10 text-error'
  return 'border-border-2 bg-surface-1 text-text-2'
}

function FlowSwitcher({
  flowName,
  setFlowName,
  savedFlows,
  activeFlowId,
  onNew,
  onCreateMockDemo,
  onLoad,
  onDelete,
}: {
  flowName: string
  setFlowName: (value: string) => void
  savedFlows: SavedFlowDefinition[]
  activeFlowId: string | null
  onNew: () => void
  onCreateMockDemo: () => void
  onLoad: (flow: SavedFlowDefinition) => void
  onDelete: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const filtered = savedFlows.filter((flow) => flow.name.toLowerCase().includes(query.trim().toLowerCase()))

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title="Switch or rename flow"
        className={cn('flex h-[34px] min-w-0 max-w-[340px] items-center gap-2.5 rounded-lg border px-2.5 transition-colors', open ? 'border-accent/55 bg-accent/10' : 'border-border-1 bg-surface-0 hover:border-border-3 hover:bg-surface-2')}
      >
        <GitBranch size={13} className="shrink-0 text-accent" />
        <span className="truncate text-[13px] font-medium text-text-1">{flowName || 'Untitled API flow'}</span>
        <span className="shrink-0 text-[11px] text-text-3">{savedFlows.length} saved</span>
        <ChevronDown size={12} className={cn('shrink-0 text-text-3 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-50 w-[340px] overflow-hidden rounded-xl border border-border-1 bg-surface-1 shadow-[0_24px_48px_rgba(0,0,0,0.28)]">
          <div className="border-b border-border-1 p-3">
            <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-4">Flow name</label>
            <input
              value={flowName}
              onChange={(event) => setFlowName(event.target.value)}
              placeholder="Untitled API flow"
              className="mt-1.5 h-8 w-full rounded-lg border border-border-2 bg-surface-0 px-2.5 text-xs font-medium text-text-1 outline-none focus:border-accent"
            />
          </div>

          <div className="flex h-9 items-center gap-2 border-b border-border-1 px-3">
            <Search size={12} className="text-text-4" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search saved flows..." className="min-w-0 flex-1 bg-transparent text-xs text-text-1 outline-none placeholder:text-text-4" />
          </div>

          <div className="max-h-[280px] overflow-y-auto p-1.5">
            {filtered.map((flow) => (
              <div key={flow.id} className={cn('group flex items-center gap-2 rounded-lg px-2 py-1.5', flow.id === activeFlowId ? 'bg-accent/10' : 'hover:bg-surface-2')}>
                <button onClick={() => { onLoad(flow); setOpen(false) }} className="min-w-0 flex-1 text-left">
                  <div className="truncate text-xs font-medium text-text-1">{flow.name}</div>
                  <div className="truncate text-[10px] text-text-3">{flow.graph.nodes.length} nodes · {new Date(flow.updatedAt).toLocaleDateString()}</div>
                </button>
                <button onClick={() => onDelete(flow.id)} title="Delete flow" className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-text-4 opacity-0 hover:bg-error/10 hover:text-error group-hover:opacity-100">
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            {filtered.length === 0 && <div className="px-3 py-6 text-center text-[11px] text-text-3">No saved flow matches this search.</div>}
          </div>

          <div className="grid grid-cols-2 gap-1.5 border-t border-border-1 p-2">
            <button onClick={() => { onNew(); setOpen(false) }} className="flex h-8 items-center justify-center gap-1.5 rounded-lg bg-accent text-[11px] font-semibold text-white hover:bg-accent-hover"><Plus size={13} /> New flow</button>
            <button onClick={() => { onCreateMockDemo(); setOpen(false) }} className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border-2 bg-surface-0 text-[11px] font-semibold text-text-2 hover:border-border-3 hover:text-text-1"><Server size={13} /> Mock demo</button>
          </div>
        </div>
      )}
    </div>
  )
}

function FlowToolbarMenu({ items }: { items: { label: string; icon: typeof Save; onClick: () => void; disabled?: boolean }[] }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button onClick={() => setOpen((value) => !value)} aria-label="More flow actions" aria-expanded={open} className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition-colors', open ? 'border-accent/55 bg-accent/10 text-accent' : 'border-border-1 bg-surface-0 text-text-3 hover:border-border-3 hover:text-text-1')}>
        <MoreVertical size={14} />
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-[240px] overflow-hidden rounded-xl border border-border-1 bg-surface-1 p-1.5 shadow-[0_24px_48px_rgba(0,0,0,0.28)]">
          {items.map((item) => (
            <button
              key={item.label}
              disabled={item.disabled}
              onClick={() => { setOpen(false); item.onClick() }}
              className="flex h-8 w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 text-left text-xs text-text-2 hover:bg-surface-2 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <item.icon size={13} className="text-text-3" />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function FlowCanvas({
  graph,
  runtime,
  selectedNodeId,
  positions,
  zoom,
  onZoom,
  onSelect,
  onMove,
  onArrange,
  fitVersion,
}: {
  graph: FlowGraphDefinition
  runtime: RuntimeByNode
  selectedNodeId: string | null
  positions: Record<string, { x: number; y: number }>
  zoom: number
  onZoom: (value: number) => void
  onSelect: (id: string | null) => void
  onMove: (id: string, position: { x: number; y: number }) => void
  onArrange: () => void
  fitVersion: number
}) {
  const { scrollRef, panning, changeZoom, resetScroll, startPan, startDrag } = useFlowCanvasInteraction({ zoom, onZoom, onSelect, onMove })
  const liveNodes = graph.nodes.map((node) => ({ ...node, x: positions[node.id]?.x ?? node.x, y: positions[node.id]?.y ?? node.y }))
  const byId = new Map(liveNodes.map((node) => [node.id, node]))
  const maxX = Math.max(900, ...liveNodes.map((node) => node.x + nodeSize(node).w + 180))
  const maxY = Math.max(520, ...liveNodes.map((node) => node.y + nodeSize(node).h + 220))

  const fit = () => {
    if (!scrollRef.current || liveNodes.length === 0) return
    const width = Math.max(...liveNodes.map(node => node.x + nodeSize(node).w)) + 64
    const height = Math.max(...liveNodes.map(node => node.y + nodeSize(node).h)) + 120
    onZoom(Math.max(0.2, Math.min(1, scrollRef.current.clientWidth / width, scrollRef.current.clientHeight / height)))
    resetScroll()
  }
  const graphIdentity = graph.nodes.map(node => node.id).join('|')
  useEffect(() => { fit() }, [graphIdentity, fitVersion])
  useEffect(() => {
    if (!selectedNodeId) return
    scrollRef.current?.querySelector('[data-flow-node="' + CSS.escape(selectedNodeId) + '"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [selectedNodeId])

  const edgePath = (edge: FlowEdgeDefinition) => flowEdgePath(edge, byId)

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-surface-0">
      <div
        ref={scrollRef}
        tabIndex={0}
        role="region"
        aria-label="Flow canvas. Drag to pan, Ctrl scroll to zoom, F to fit, Shift drag to snap."
        onKeyDown={event => {
          if (event.target !== event.currentTarget) return
          if (event.key.toLowerCase() === 'f') { event.preventDefault(); fit() }
          if (event.key === '0') { event.preventDefault(); changeZoom(1) }
          if (event.key === '+' || event.key === '=') { event.preventDefault(); changeZoom(zoom + .1) }
          if (event.key === '-') { event.preventDefault(); changeZoom(zoom - .1) }
        }}
        onPointerDown={startPan}
        style={{ cursor: panning ? 'grabbing' : 'grab' }}
        className="absolute inset-0 touch-none overflow-auto outline-none bg-[radial-gradient(var(--color-border-1)_1px,transparent_1px)] bg-[size:24px_24px]"
      >
        <div style={{ width: maxX * zoom, height: maxY * zoom }}>
        <div className="relative origin-top-left" style={{ width: maxX, height: maxY, transform: `scale(${zoom})` }}>
          <svg className="pointer-events-none absolute inset-0 overflow-visible" width={maxX} height={maxY}>
            <defs>
              <marker id="flow-arrow" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" viewBox="0 0 9 9" refX="7" refY="4.5" orient="auto">
                <path d="M1 1 L7 4.5 L1 8 Z" fill="var(--color-text-3)" />
              </marker>
              <marker id="flow-arrow-ok" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" viewBox="0 0 9 9" refX="7" refY="4.5" orient="auto">
                <path d="M1 1 L7 4.5 L1 8 Z" fill="var(--color-success)" />
              </marker>
              <marker id="flow-arrow-error" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" viewBox="0 0 9 9" refX="7" refY="4.5" orient="auto">
                <path d="M1 1 L7 4.5 L1 8 Z" fill="var(--color-error)" />
              </marker>
            </defs>
            {graph.edges.map((edge) => {
              const path = edgePath(edge)
              if (!path) return null
              const targetStatus = runtime[edge.target]?.status
              const errorEdge = edge.branch === 'false' || edge.branch === 'else' || edge.branch === 'error'
              const active = targetStatus && targetStatus !== 'idle' && targetStatus !== 'pending' && targetStatus !== 'skipped'
              const stroke = active
                ? (errorEdge ? 'var(--color-error)' : 'var(--color-success)')
                : errorEdge ? 'color-mix(in srgb, var(--color-error) 45%, transparent)' : 'var(--color-text-3)'
              return (
                <path
                  key={edge.id}
                  d={path.d}
                  fill="none"
                  stroke={stroke}
                  strokeWidth="2.5"
                  vectorEffect="non-scaling-stroke"
                  strokeDasharray={runtime[edge.target]?.status === 'running' ? '6 5' : undefined}
                  markerEnd={`url(#${active ? (errorEdge ? 'flow-arrow-error' : 'flow-arrow-ok') : 'flow-arrow'})`}
                />
              )
            })}
          </svg>

          {graph.edges.map((edge) => {
            const path = edgePath(edge)
            if (!path || (!edge.label && edge.branch === 'next')) return null
            const errorEdge = edge.branch === 'false' || edge.branch === 'else' || edge.branch === 'error'
            return (
              <div
                key={`${edge.id}-label`}
                className={cn('pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded bg-surface-0/90 px-1.5 py-0.5 text-[10px] font-medium', errorEdge ? 'text-error' : 'text-success')}
                style={{ left: path.labelX, top: path.labelY }}
              >
                {edge.label || edge.branch}
              </div>
            )
          })}

          {liveNodes.map((node) => (
            <FlowBoardNode
              key={node.id}
              node={node}
              runtime={runtime[node.id]}
              selected={selectedNodeId === node.id}
              onPointerDown={startDrag}
              onSelect={onSelect}
            />
          ))}
        </div>
        </div>
      </div>

      <div className="absolute bottom-4 left-4 z-20 flex h-[34px] items-center gap-0.5 rounded-lg border border-border-1 bg-surface-1/95 px-1 shadow-[0_8px_24px_rgba(0,0,0,0.18)] backdrop-blur">
        <button title="Zoom out" onClick={() => changeZoom(zoom - 0.1)} className="grid h-[26px] w-[26px] place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text-1"><ZoomOut size={13} /></button>
        <button title="Reset zoom" onClick={() => changeZoom(1)} className="min-w-[42px] rounded-md px-1 text-center text-[12px] text-text-2 hover:bg-surface-2 hover:text-text-1">{Math.round(zoom * 100)}%</button>
        <button title="Zoom in" onClick={() => changeZoom(zoom + 0.1)} className="grid h-[26px] w-[26px] place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text-1"><ZoomIn size={13} /></button>
        <span className="mx-1 h-4 w-px bg-border-1" />
        <button title="Fit flow to view" onClick={fit} className="grid h-[26px] w-[26px] place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text-1"><Maximize2 size={13} /></button>
        <button title="Arrange nodes in execution order" onClick={onArrange} className="grid h-[26px] w-[26px] place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text-1"><Grid3X3 size={13} /></button>
      </div>
      <div className="pointer-events-none absolute right-3 bottom-4 rounded bg-surface-1/90 px-2 py-1 text-[10px] text-text-3">Ctrl + scroll: zoom · F: fit · Shift + drag: snap</div>
    </div>
  )
}

function nodeStatusDot(status?: FlowRunStatus) {
  if (status === 'success') return 'bg-success'
  if (status === 'failed' || status === 'broken') return 'bg-error'
  if (status === 'running') return 'animate-pulse bg-accent'
  if (status === 'missing-binding') return 'bg-warning'
  return 'bg-border-3'
}

function nodeFrame(status: FlowRunStatus | undefined, selected: boolean) {
  if (selected) return 'border border-accent bg-surface-1 shadow-[0_0_0_3px_var(--color-accent-glow)]'
  if (status === 'success') return 'border border-success/45 bg-surface-1'
  if (status === 'failed' || status === 'broken') return 'border border-error/45 bg-surface-1'
  if (status === 'running') return 'border border-accent/60 bg-surface-1'
  if (status === 'missing-binding') return 'border border-warning/45 bg-surface-1'
  return 'border border-border-2 bg-surface-1 hover:border-border-3'
}

function FlowBoardNode({
  node,
  runtime,
  selected,
  onPointerDown,
  onSelect,
}: {
  node: FlowNodeDefinition
  runtime?: RuntimeByNode[string]
  selected: boolean
  onPointerDown: (event: React.PointerEvent, node: FlowNodeDefinition) => void
  onSelect: (id: string) => void
}) {
  const size = nodeSize(node)
  const request = node.config.request
  const status = runtime?.status ?? (node.type === 'request' && !request?.url.trim() ? 'missing-binding' : 'idle')
  const common = {
    'data-flow-node': node.id,
    onPointerDown: (event: React.PointerEvent) => onPointerDown(event, node),
    onClick: (event: React.MouseEvent) => { event.stopPropagation(); if (event.detail === 0) onSelect(node.id) },
  }
  // Details stay folded until hover or selection so the canvas reads as a flow,
  // not as a wall of cards.
  const detail = cn(
    'overflow-hidden text-left transition-all duration-200 ease-out',
    selected ? 'max-h-24 opacity-100' : 'max-h-0 opacity-0 group-hover:max-h-24 group-hover:opacity-100',
  )

  if (node.type === 'start') {
    return (
      <button {...common} style={{ left: node.x, top: node.y, width: size.w, height: size.h }} className={cn('group absolute touch-none z-[1] flex select-none items-center gap-2.5 rounded-[10px] px-3.5 transition-colors hover:bg-surface-2', nodeFrame(status, selected))}>
        <span className="h-[7px] w-[7px] rounded-full bg-success" />
        <span className="truncate text-[13px] font-medium text-text-1">{node.label}</span>
      </button>
    )
  }

  if (node.type === 'end') {
    const failed = node.config.endState === 'failed'
    return (
      <button
        {...common}
        style={{ left: node.x, top: node.y, width: size.w, height: size.h }}
        className={cn(
          'group absolute touch-none z-[1] flex select-none items-center gap-2.5 rounded-[10px] px-3.5 transition-colors hover:bg-surface-2',
          selected ? nodeFrame(status, true) : failed ? 'border border-error/40 bg-surface-1' : 'border border-border-2 bg-surface-1 hover:border-border-3',
        )}
      >
        {failed ? <XCircle size={13} className="shrink-0 text-error" /> : <CheckCircle2 size={13} className="shrink-0 text-success" />}
        <span className="truncate text-[13px] font-medium text-text-1">{node.label}</span>
      </button>
    )
  }

  if (node.type === 'condition') {
    const condition = node.config.condition
    return (
      <button {...common} style={{ left: node.x, top: node.y, width: size.w }} className={cn('group absolute touch-none z-[1] select-none rounded-xl px-3.5 py-3 text-left transition-colors hover:z-20 hover:bg-surface-2', nodeFrame(status, selected))}>
        <div className="flex items-center gap-2.5">
          <GitFork size={13} className="shrink-0 text-warning" />
          <span className="truncate text-[13px] font-medium text-text-1">{node.label}</span>
          <span className="flex-1" />
          <span className="shrink-0 text-[11px] text-text-4">{graphStepLabel(node)}</span>
        </div>
        <div className={detail}>
          <div className="truncate pt-2 font-mono text-[11px] text-text-3">
            {condition ? `${condition.source}${condition.path ? `.${condition.path}` : ''} ${condition.operator} ${condition.value}` : 'No condition configured'}
          </div>
        </div>
      </button>
    )
  }

  return (
    <button {...common} style={{ left: node.x, top: node.y, width: size.w }} className={cn('group absolute touch-none z-[1] select-none rounded-xl px-3.5 py-3 text-left transition-colors hover:z-20 hover:bg-surface-2', nodeFrame(status, selected))}>
      <div className="flex items-center gap-2.5">
        <span className={cn('min-w-[52px] shrink-0 font-mono text-[11px] font-medium', methodTone(request?.method))}>{request?.method ?? 'REQ'}</span>
        <span className="truncate text-[13px] font-medium text-text-1">{node.label}</span>
        <span className="flex-1" />
        {runtime?.durationMs !== undefined && <span className="shrink-0 font-mono text-[10px] text-text-3">{Math.round(runtime.durationMs)}ms</span>}
        {runtime?.status === 'running'
          ? <Loader2 size={11} className="shrink-0 animate-spin text-accent" />
          : <span className={cn('h-[6px] w-[6px] shrink-0 rounded-full', nodeStatusDot(status))} />}
        <span className="shrink-0 text-[11px] text-text-4">{graphStepLabel(node)}</span>
      </div>
      <div className={detail}>
        <div className="truncate pt-2 font-mono text-[11px] text-text-3">{request?.url || 'Missing URL'}</div>
        <div className="flex items-center gap-2.5 pt-2 text-[11px]">
          {request?.url
            ? <span className="inline-flex shrink-0 items-center gap-1.5 text-text-2"><span className="h-[5px] w-[5px] rounded-full bg-success" /> Mapped</span>
            : <span className="inline-flex shrink-0 items-center gap-1.5 text-warning"><AlertTriangle size={11} /> Missing binding</span>}
          {!!node.config.extractions?.length && <span className="truncate text-text-3">{node.config.extractions.length} output · {node.config.extractions.map(mapping => mapping.name).join(', ')}</span>}
        </div>
      </div>
    </button>
  )
}

function graphStepLabel(node: FlowNodeDefinition) {
  if (node.type === 'start') return 'S'
  if (node.config.seq) return String(node.config.seq).padStart(2, '0')
  const raw = node.mermaidKey || node.id
  return raw.length <= 3 ? raw.toUpperCase() : raw.slice(0, 2).toUpperCase()
}

const INSPECTOR_TABS: { id: InspectorTab; label: string }[] = [
  { id: 'request', label: 'Request' },
  { id: 'response', label: 'Response' },
  { id: 'tests', label: 'Tests' },
  { id: 'variables', label: 'Variables' },
  { id: 'conditions', label: 'Conditions' },
]

function FlowInspectorDrawer({
  node,
  graph,
  runtime,
  lastEntry,
  catalog,
  activeEnvName,
  search,
  setSearch,
  onBindRequest,
  onPatchNodeConfig,
  onPatchCondition,
  onRunStep,
  scopeVars,
}: {
  node: FlowNodeDefinition
  graph: FlowGraphDefinition
  scopeVars: Record<string, string>
  runtime?: RuntimeByNode[string]
  lastEntry?: RunEntry
  catalog: ApiCatalogRequest[]
  activeEnvName: string
  search: string
  setSearch: (value: string) => void
  onBindRequest: (nodeId: string, request: RequestItem) => void
  onPatchNodeConfig: (nodeId: string, patch: Partial<FlowNodeDefinition['config']>) => void
  onPatchCondition: (nodeId: string, patch: Partial<FlowCondition>) => void
  onRunStep: (nodeId: string) => void
}) {
  const [tab, setTab] = useState<InspectorTab>('request')
  const condition = node.config.condition
  const request = node.config.request
  const status = runtime?.status ?? 'idle'

  useEffect(() => {
    setTab(node.type === 'condition' ? 'conditions' : 'request')
  }, [node.id, node.type])

  const q = search.trim().toLowerCase()
  const filteredCatalog = catalog
    .filter((item) => !q || `${item.label} ${item.source} ${item.request.method} ${item.request.url}`.toLowerCase().includes(q))
    .slice(0, 9)

  return (
    <aside className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-1">
        <header className="flex h-[60px] flex-shrink-0 items-center gap-3 border-b border-border-1 px-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              {node.type === 'condition'
                ? <GitFork size={13} className="shrink-0 text-warning" />
                : <span className={cn('shrink-0 font-mono text-[11px] font-medium', methodTone(request?.method))}>{request?.method ?? node.type.toUpperCase()}</span>}
              <span className="truncate text-[15px] font-medium text-text-1">{node.label}</span>
              <span className={cn('shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase', statusTheme(status))}>{status}</span>
            </div>
            <div className="truncate pt-0.5 text-[11px] text-text-3">{graphStepLabel(node)} · {activeEnvName}</div>
          </div>
          <button onClick={() => onRunStep(node.id)} className="flex h-[30px] shrink-0 items-center gap-1.5 rounded-lg border border-border-2 bg-surface-0 px-2.5 text-xs text-text-2 hover:border-border-3 hover:text-text-1">
            <Play size={11} /> Run step
          </button>
        </header>

        <nav className="flex h-10 flex-shrink-0 items-stretch gap-4 overflow-x-auto border-b border-border-1 px-3">
          {INSPECTOR_TABS.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={cn('relative text-xs transition-colors', tab === item.id ? 'text-text-1' : 'text-text-3 hover:text-text-1')}
            >
              {item.label}
              {tab === item.id && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent" />}
            </button>
          ))}
        </nav>

        {runtime?.message && <div className="flex-shrink-0 border-b border-border-1 px-4 py-2 text-[11px] text-text-3">{runtime.message}</div>}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === 'request' && (
            node.type === 'request' && request ? (
              <div className="flex min-h-full flex-col">
                <div className="flex min-h-[560px] flex-col">
                  {/* Vars extracted by other steps resolve at run time; show them as defined. */}
                  <ScopedVarsContext.Provider value={scopeVars}>
                    <Composer
                      tabId={`flow-node-${node.id}`}
                      request={request}
                      onChange={(next) => onBindRequest(node.id, next)}
                      onSend={() => onRunStep(node.id)}
                      onSave={() => onBindRequest(node.id, request)}
                      loading={runtime?.status === 'running'}
                    />
                  </ScopedVarsContext.Provider>
                </div>

                <div className="grid grid-cols-2 gap-3 border-t border-border-1 p-4">
                  <label className="space-y-1.5">
                    <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-text-4">Delay (ms)</span>
                    <input type="number" min="0" value={node.config.delayMs ?? 0} onChange={(event) => onPatchNodeConfig(node.id, { delayMs: Math.max(0, Number(event.target.value) || 0) })} className="h-8 w-full rounded-lg border border-border-2 bg-surface-0 px-2.5 font-mono text-xs text-text-1 outline-none focus:border-accent" />
                  </label>
                  <label className="space-y-1.5">
                    <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-text-4">Retry attempts</span>
                    <input type="number" min="0" max="9" value={node.config.retryCount ?? 0} onChange={(event) => onPatchNodeConfig(node.id, { retryCount: Math.min(9, Math.max(0, Number(event.target.value) || 0)) })} className="h-8 w-full rounded-lg border border-border-2 bg-surface-0 px-2.5 font-mono text-xs text-text-1 outline-none focus:border-accent" />
                  </label>
                  <label className="col-span-2 flex items-center gap-2 text-xs text-text-2">
                    <input type="checkbox" checked={node.config.stopOnFailure ?? graph.settings.failOnHttpError} onChange={(event) => onPatchNodeConfig(node.id, { stopOnFailure: event.target.checked })} />
                    Stop the flow when this step fails
                  </label>
                </div>

                <div className="border-t border-border-1 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-text-4">Bind from API catalog</span>
                    <span className="text-[10px] text-text-4">{catalog.length}</span>
                  </div>
                  <div className="mb-2 flex h-8 items-center gap-2 rounded-lg border border-border-2 bg-surface-0 px-2.5">
                    <Search size={12} className="text-text-4" />
                    <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find request..." className="min-w-0 flex-1 bg-transparent text-xs text-text-1 outline-none placeholder:text-text-4" />
                  </div>
                  <div className="space-y-1.5">
                    {filteredCatalog.map((item) => (
                      <button key={item.id} onClick={() => onBindRequest(node.id, item.request)} className="w-full rounded-lg border border-border-1 bg-surface-0 px-2.5 py-2 text-left hover:border-accent/50 hover:bg-accent/5">
                        <div className="flex items-center gap-2.5">
                          <span className={cn('w-12 shrink-0 font-mono text-[10px] font-medium', methodTone(item.request.method))}>{item.request.method}</span>
                          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-text-1">{item.label}</span>
                        </div>
                        <div className="mt-1 truncate font-mono text-[10px] text-text-3">{item.request.url || 'Missing URL'}</div>
                      </button>
                    ))}
                    {filteredCatalog.length === 0 && <div className="rounded-lg border border-dashed border-border-2 px-3 py-5 text-center text-[11px] text-text-3">No catalog request matches this search.</div>}
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-4 text-xs text-text-3">This node has no HTTP request.</div>
            )
          )}

          {tab === 'response' && (
            <div className="flex flex-col gap-3 p-4">
              {!lastEntry ? (
                <div className="rounded-xl border border-dashed border-border-2 py-12 text-center text-xs text-text-3">Run this flow to capture a response for this step.</div>
              ) : (
                <>
                  <div className="flex items-center gap-3.5">
                    <span className={cn('inline-flex h-7 items-center rounded-lg px-2.5 font-mono text-xs', lastEntry.status === 'success' ? 'bg-success/10 text-success' : 'bg-error/10 text-error')}>
                      {lastEntry.httpStatus ?? lastEntry.status}
                    </span>
                    <span className="text-xs text-text-2">{Math.round(lastEntry.durationMs)} ms</span>
                    <span className="flex-1" />
                    <span className="text-[11px] text-text-3">{lastEntry.nodeLabel}</span>
                  </div>
                  {lastEntry.response?.body && <pre className="max-h-[420px] overflow-auto rounded-xl border border-border-2 bg-surface-0 p-3.5 font-mono text-[12px] leading-6 text-text-2">{lastEntry.response.body}</pre>}
                  {lastEntry.error && <div className="rounded-xl border border-error/30 bg-error/10 p-3 text-xs text-error">{lastEntry.error}</div>}
                </>
              )}
            </div>
          )}

          {tab === 'tests' && (
            <div className="space-y-2 p-4">
              {(request?.assertions ?? []).length === 0 && <div className="rounded-xl border border-dashed border-border-2 px-4 py-10 text-center text-xs text-text-3">No assertions configured for this request.</div>}
              {(lastEntry?.assertions ?? []).map((assertion) => (
                <div key={assertion.assertionId} className="flex items-center gap-2.5 rounded-xl border border-border-1 bg-surface-0 p-3">
                  {assertion.passed ? <CheckCircle2 size={14} className="shrink-0 text-success" /> : <XCircle size={14} className="shrink-0 text-error" />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-text-1">{assertion.label}</div>
                    <div className="truncate font-mono text-[10px] text-text-3">actual {assertion.actual} · expected {assertion.expected}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'variables' && (
            <div className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-text-4">Extracted from this step</span>
                {node.type === 'request' && (
                  <button
                    onClick={() => onPatchNodeConfig(node.id, { extractions: [...(node.config.extractions ?? []), { id: uid(), name: `var${(node.config.extractions?.length ?? 0) + 1}`, source: 'body', path: '' }] })}
                    className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-dashed border-border-2 px-2.5 text-[11px] text-text-2 hover:border-border-3 hover:text-text-1"
                  >
                    <Plus size={11} /> Extract variable
                  </button>
                )}
              </div>
              {(node.config.extractions ?? []).length === 0 && <div className="mt-3 rounded-xl border border-dashed border-border-2 px-4 py-8 text-center text-xs text-text-3">This step extracts no variables.</div>}
              {(node.config.extractions ?? []).map((mapping, index) => (
                <div key={mapping.id} className="mt-2 grid grid-cols-[1fr_92px_28px] gap-2">
                  <input value={mapping.name} onChange={(event) => onPatchNodeConfig(node.id, { extractions: (node.config.extractions ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })} className="h-8 min-w-0 rounded-lg border border-border-2 bg-surface-0 px-2.5 font-mono text-xs text-text-1 outline-none focus:border-accent" placeholder="variable" />
                  <select value={mapping.source} onChange={(event) => onPatchNodeConfig(node.id, { extractions: (node.config.extractions ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, source: event.target.value as typeof item.source } : item) })} className="h-8 rounded-lg border border-border-2 bg-surface-0 px-2 text-[11px] text-text-1">
                    <option value="body">body</option><option value="header">header</option><option value="status">status</option><option value="expression">expr</option>
                  </select>
                  <button onClick={() => onPatchNodeConfig(node.id, { extractions: (node.config.extractions ?? []).filter((_, itemIndex) => itemIndex !== index) })} className="grid h-8 w-7 place-items-center rounded-lg text-text-4 hover:bg-error/10 hover:text-error"><X size={13} /></button>
                  <input value={mapping.path} onChange={(event) => onPatchNodeConfig(node.id, { extractions: (node.config.extractions ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, path: event.target.value } : item) })} className="col-span-3 h-8 rounded-lg border border-border-2 bg-surface-0 px-2.5 font-mono text-xs text-text-1 outline-none focus:border-accent" placeholder="access_token or response.body.token" />
                </div>
              ))}
            </div>
          )}

          {tab === 'conditions' && (
            <div className="space-y-3.5 p-4">
              {node.type === 'condition' && condition ? (
                <div className="rounded-xl border border-border-2 bg-surface-0 p-3.5">
                  <div className="grid grid-cols-2 gap-2.5">
                    <label className="space-y-1.5">
                      <span className="block text-[11px] text-text-3">Source</span>
                      <select value={condition.source} onChange={(event) => onPatchCondition(node.id, { source: event.target.value as FlowCondition['source'] })} className="h-8 w-full rounded-lg border border-border-2 bg-surface-1 px-2 text-xs text-text-1">
                        <option value="body">response body</option>
                        <option value="status">status</option>
                        <option value="header">header</option>
                        <option value="variable">variable</option>
                        <option value="expression">expression</option>
                      </select>
                    </label>
                    <label className="space-y-1.5">
                      <span className="block text-[11px] text-text-3">Field</span>
                      <input value={condition.path} onChange={(event) => onPatchCondition(node.id, { path: event.target.value })} className="h-8 w-full rounded-lg border border-border-2 bg-surface-1 px-2.5 font-mono text-xs text-text-1 outline-none focus:border-accent" placeholder="user.active" />
                    </label>
                    <label className="space-y-1.5">
                      <span className="block text-[11px] text-text-3">Operator</span>
                      <select value={condition.operator} onChange={(event) => onPatchCondition(node.id, { operator: event.target.value as FlowCondition['operator'] })} className="h-8 w-full rounded-lg border border-border-2 bg-surface-1 px-2 font-mono text-xs text-text-1">
                        <option value="exists">exists</option><option value="not_exists">not exists</option><option value="eq">equals</option><option value="neq">not equals</option><option value="contains">contains</option><option value="gt">greater than</option><option value="lt">less than</option><option value="gte">at least</option><option value="lte">at most</option>
                      </select>
                    </label>
                    <label className="space-y-1.5">
                      <span className="block text-[11px] text-text-3">Value</span>
                      <input value={condition.value} onChange={(event) => onPatchCondition(node.id, { value: event.target.value })} className="h-8 w-full rounded-lg border border-border-2 bg-surface-1 px-2.5 font-mono text-xs text-text-1 outline-none focus:border-accent" placeholder="true" />
                    </label>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-border-1 bg-surface-0 p-4 text-xs text-text-3">Outgoing edges from this node define the next execution path.</div>
              )}

              <div className="rounded-xl border border-border-1 bg-surface-0 p-3.5">
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-text-4">Branches</div>
                <div className="mt-2 space-y-1.5">
                  {graph.edges.filter((edge) => edge.source === node.id).map((edge) => {
                    const errorEdge = edge.branch === 'false' || edge.branch === 'else' || edge.branch === 'error'
                    return (
                      <div key={edge.id} className="flex items-center gap-2.5 rounded-lg border border-border-1 bg-surface-1 px-2.5 py-2 text-xs">
                        <span className={cn('h-[5px] w-[5px] shrink-0 rounded-full', errorEdge ? 'bg-error' : 'bg-success')} />
                        <span className="shrink-0 text-text-2">{edge.label || edge.branch || 'next'}</span>
                        <span className="min-w-0 flex-1 truncate text-right text-text-3">{graph.nodes.find((item) => item.id === edge.target)?.label ?? edge.target}</span>
                      </div>
                    )
                  })}
                  {graph.edges.filter((edge) => edge.source === node.id).length === 0 && <div className="py-3 text-center text-[11px] text-text-3">This node has no outgoing branch.</div>}
                </div>
              </div>
            </div>
          )}
        </div>
    </aside>
  )
}

function FlowRunTimeline({ entries, running, selectedNodeId, onSelect, onClear }: {
  entries: RunEntry[]
  running: boolean
  selectedNodeId: string | null
  onSelect: (id: string) => void
  onClear: () => void
}) {
  const success = entries.length > 0 && entries.every((entry) => entry.status !== 'failed')
  const total = entries.reduce((sum, entry) => sum + entry.durationMs, 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface-1">
      <div className="flex h-[34px] flex-shrink-0 items-center gap-2.5 pr-2">
        <div className="flex h-full min-w-0 flex-1 items-center gap-2.5 px-4">
          {running && <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-accent"><Loader2 size={11} className="animate-spin" /> Running</span>}
          {!running && entries.length > 0 && (
            <span className={cn('inline-flex shrink-0 items-center gap-1.5 text-[11px]', success ? 'text-success' : 'text-error')}>
              {success ? <CheckCircle2 size={11} /> : <XCircle size={11} />}{success ? 'Success' : 'Failed'}
            </span>
          )}
          <span className="truncate text-[11px] text-text-3">{entries.length} steps{entries.length > 0 ? ` · ${Math.round(total)} ms` : ''}</span>
        </div>
        <button type="button" onClick={onClear} disabled={entries.length === 0} className="rounded-md px-2 py-1 text-[11px] text-text-3 hover:bg-surface-2 hover:text-text-1 disabled:opacity-40">Clear</button>
      </div>

        <div className="min-h-0 flex-1 overflow-auto border-t border-border-1">
          {entries.length === 0 ? (
            <div className="grid h-full place-items-center text-xs text-text-3">{running ? 'Executing flow...' : 'Run the flow to populate this timeline.'}</div>
          ) : (
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-surface-1">
                <tr className="border-b border-border-1 text-left text-[10px] uppercase tracking-[0.12em] text-text-4">
                  <th className="w-14 px-4 py-2">Step</th>
                  <th className="px-4 py-2">Name</th>
                  <th className="w-24 px-4 py-2">Status</th>
                  <th className="w-20 px-4 py-2">HTTP</th>
                  <th className="w-24 px-4 py-2">Duration</th>
                  <th className="px-4 py-2">Error</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, index) => (
                  <tr
                    key={entry.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Inspect ${entry.nodeLabel} execution`}
                    onClick={() => onSelect(entry.nodeId)}
                    onKeyDown={(event) => handleKeyboardActivation(event, () => onSelect(entry.nodeId))}
                    className={cn('cursor-pointer border-b border-border-1 hover:bg-surface-2/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent', selectedNodeId === entry.nodeId && 'bg-accent/10')}
                  >
                    <td className="px-4 py-2 font-mono text-[11px] text-text-3">{String(index + 1).padStart(2, '0')}</td>
                    <td className="px-4 py-2 text-text-1">{entry.nodeLabel}</td>
                    <td className="px-4 py-2">
                      <span className={cn('inline-flex items-center gap-1.5 text-[11px]', entry.status === 'success' ? 'text-success' : entry.status === 'failed' ? 'text-error' : 'text-warning')}>
                        <span className={cn('h-[5px] w-[5px] rounded-full', entry.status === 'success' ? 'bg-success' : entry.status === 'failed' ? 'bg-error' : 'bg-warning')} />
                        {entry.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-mono text-text-3">{entry.httpStatus ?? '-'}</td>
                    <td className="px-4 py-2 font-mono text-text-3">{Math.round(entry.durationMs)}ms</td>
                    <td className="max-w-[360px] truncate px-4 py-2 text-error">{entry.error ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
    </div>
  )
}

function MermaidModal({ value, onChange, onClose, onImport, catalog, graph }: {
  value: string
  onChange: (value: string) => void
  onClose: () => void
  onImport: () => void
  catalog: ApiCatalogRequest[]
  graph: FlowGraphDefinition
}) {
  return (
    <FlowDockPanel title="Import Mermaid" side="right" open initialFloating initialWidth={860} onClose={onClose}>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-1">
        <div className="flex items-center gap-3 border-b border-border-1 px-5 py-4">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent/12 text-accent"><GitBranch size={18} /></span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-text-1">Import Mermaid Flow</div>
            <div className="text-xs text-text-4">Preview matching against the API catalog before importing.</div>
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-text-3 hover:bg-surface-2 hover:text-text-1"><X size={16} /></button>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-4 overflow-auto p-5">
          <div className="min-h-0">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-text-4">Mermaid source</div>
            <textarea value={value} onChange={(event) => onChange(event.target.value)} spellCheck={false} className="h-[360px] w-full resize-none rounded-xl border border-border-2 bg-surface-0 p-4 font-mono text-xs leading-6 text-text-1 outline-none focus:border-accent" />
          </div>
          <div className="min-h-0">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-text-4">Catalog match preview</div>
            <div className="space-y-2">
              {graph.nodes.map((node) => {
                const match = node.type === 'request' ? matchCatalogRequest(node.label, catalog) : null
                return (
                  <div key={node.id} className="flex items-center gap-3 rounded-xl border border-border-1 bg-surface-0 p-3">
                    <span className={cn('grid h-8 w-8 place-items-center rounded-lg', node.type === 'condition' ? 'bg-warning/10 text-warning' : match ? 'bg-accent/10 text-accent' : 'bg-surface-2 text-text-4')}>{node.type === 'condition' ? <GitFork size={15} /> : match ? <Check size={15} /> : <AlertTriangle size={15} />}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold text-text-1">{node.label}</div>
                      <div className={cn('truncate text-[10px]', match ? 'text-text-4' : 'text-warning')}>{match ? match.label : node.type === 'request' ? 'No catalog match yet' : node.type}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 border-t border-border-1 px-5 py-4">
          <span className="text-xs text-text-4">{graph.nodes.length} nodes generated</span>
          <span className="flex-1" />
          <button onClick={onClose} className="h-9 rounded-lg border border-border-2 px-4 text-xs font-semibold text-text-2 hover:bg-surface-2 hover:text-text-1">Cancel</button>
          <button onClick={onImport} className="flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-xs font-semibold text-white hover:bg-accent-hover"><Check size={14} /> Import Flow</button>
        </div>
      </div>
    </FlowDockPanel>
  )
}

function AiFlowDrawer({
  instructions,
  setInstructions,
  preview,
  loading,
  error,
  onGeneratePreview,
  onApply,
  onClose,
}: {
  instructions: string
  setInstructions: (value: string) => void
  preview: AiFlowPreview | null
  loading: boolean
  error: string
  onGeneratePreview: () => void
  onApply: () => void
  onClose: () => void
}) {
  return (
    <aside className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-1">
      <div className="flex h-14 items-center gap-3 border-b border-border-1 px-4">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent/12 text-accent"><Sparkles size={17} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text-1">AI Flow Generator</div>
          <div className="text-[10px] text-text-4">Preview before adding to the board</div>
        </div>
        <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-text-3 hover:bg-surface-2 hover:text-text-1"><X size={15} /></button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <div>
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-text-4">Describe your flow</div>
          <textarea
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            spellCheck={false}
            placeholder="POST /auth/login, extract access_token as token, then GET /users/me with Authorization: Bearer {{token}}..."
            className="h-44 w-full resize-none rounded-lg border border-border-2 bg-surface-0 p-3 text-xs leading-5 text-text-1 outline-none placeholder:text-text-4 focus:border-accent"
          />
        </div>

        {error && <div className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-[11px] text-error">{error}</div>}

        {preview && (
          <div className="space-y-3 rounded-xl border border-border-1 bg-surface-0 p-3">
            <div>
              <div className="text-xs font-bold text-text-1">{preview.summary.name}</div>
              {preview.summary.description && <div className="mt-1 text-[11px] leading-4 text-text-3">{preview.summary.description}</div>}
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-center">
              <div className="rounded-lg bg-surface-2 px-2 py-2"><div className="text-sm font-bold text-text-1">{preview.summary.stepCount}</div><div className="text-[9px] uppercase text-text-4">steps</div></div>
              <div className="rounded-lg bg-surface-2 px-2 py-2"><div className="text-sm font-bold text-text-1">{preview.summary.variables.length}</div><div className="text-[9px] uppercase text-text-4">vars</div></div>
              <div className="rounded-lg bg-surface-2 px-2 py-2"><div className="text-sm font-bold text-text-1">{preview.summary.conditions.length}</div><div className="text-[9px] uppercase text-text-4">checks</div></div>
            </div>
            <PreviewList title="API calls" items={preview.summary.apiCalls} />
            <PreviewList title="Variables" items={preview.summary.variables} />
            <PreviewList title="Conditions" items={preview.summary.conditions} />
            <PreviewList title="Assertions" items={preview.summary.assertions} />
            <PreviewList title="Missing data" items={preview.summary.missing} tone="warning" />
            <PreviewList title="Warnings" items={preview.summary.warnings} tone="warning" />
            <PreviewList title="Potentially destructive" items={preview.summary.destructiveOperations} tone="error" />
            <PreviewList title="Sanitized before AI" items={preview.summary.sanitizedContext} />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-border-1 p-3">
        <button onClick={onClose} className="h-9 rounded-lg border border-border-2 px-3 text-xs font-semibold text-text-2 hover:bg-surface-2 hover:text-text-1">Cancel</button>
        {preview && <button onClick={onGeneratePreview} disabled={loading} className="h-9 rounded-lg border border-border-2 px-3 text-xs font-semibold text-text-2 hover:bg-surface-2 hover:text-text-1 disabled:opacity-50">Regenerate</button>}
        <span className="flex-1" />
        {preview ? (
          <button onClick={onApply} className="flex h-9 items-center gap-2 rounded-lg bg-accent px-3 text-xs font-bold text-white hover:bg-accent-hover"><Check size={14} /> Generate Flow</button>
        ) : (
          <button onClick={onGeneratePreview} disabled={loading || !instructions.trim()} className="flex h-9 items-center gap-2 rounded-lg bg-accent px-3 text-xs font-bold text-white hover:bg-accent-hover disabled:opacity-45">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Preview
          </button>
        )}
      </div>
    </aside>
  )
}

function PreviewList({ title, items, tone = 'default' }: { title: string; items: string[]; tone?: 'default' | 'warning' | 'error' }) {
  if (items.length === 0) return null
  return (
    <div>
      <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-text-4">{title}</div>
      <div className="space-y-1">
        {items.slice(0, 8).map((item, index) => (
          <div key={`${title}-${index}`} className={cn('rounded-md border px-2 py-1.5 font-mono text-[10px]', tone === 'error' ? 'border-error/25 bg-error/10 text-error' : tone === 'warning' ? 'border-warning/25 bg-warning/10 text-warning' : 'border-border-1 bg-surface-1 text-text-3')}>
            {item}
          </div>
        ))}
      </div>
    </div>
  )
}

export function FlowsPanel() {
  const fileRef = useRef<HTMLInputElement>(null)
  const sidecarPort = useServerPort()
  const collections = useCollectionsStore((s) => s.collections)
  const importCollection = useCollectionsStore((s) => s.importCollection)
  const envVars = useEnvironmentsStore((s) => s.getResolvedVars)
  const environments = useEnvironmentsStore((s) => s.environments)
  const activeEnvId = useEnvironmentsStore((s) => s.activeEnvId)
  const mockSettings = useSettingsStore((s) => s.settings.mock)
  const setMockRunning = useAppStore((s) => s.setMockRunning)
  const catalog = useMemo(() => flattenApiCatalog(collections), [collections])

  const [flowName, setFlowName] = useState('Untitled API flow')
  const [activeFlowId, setActiveFlowId] = useState<string | null>(null)
  const [savedFlows, setSavedFlows] = useState<SavedFlowDefinition[]>([])
  const [mermaid, setMermaid] = useState(DEFAULT_MERMAID_FLOW)
  const [draftMermaid, setDraftMermaid] = useState(DEFAULT_MERMAID_FLOW)
  const [directGraph, setDirectGraph] = useState<FlowGraphDefinition | null>(null)
  const [runtime, setRuntime] = useState<RuntimeByNode>({})
  const [lastRun, setLastRun] = useState<RunEntry[]>([])
  const [vars, setVars] = useState<Record<string, string>>({})
  const [running, setRunning] = useState(false)
  const runAbortRef = useRef<AbortController | null>(null)
  const [saveError, setSaveError] = useState('')
  const [saveNotice, setSaveNotice] = useState('')
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [timelineOpen, setTimelineOpen] = useState(true)
  const [focusMode, setFocusMode] = useState(false)
  const selectNode = (id: string | null) => { setSelectedNodeId(id); if (id) { setInspectorOpen(true); setFocusMode(false) } }
  const [catalogSearch, setCatalogSearch] = useState('')
  const [zoom, setZoom] = useState(1)
  const [fitVersion, setFitVersion] = useState(0)
  const [requestOverrides, setRequestOverrides] = useState<Record<string, RequestItem>>({})
  const [conditionOverrides, setConditionOverrides] = useState<Record<string, FlowCondition>>({})
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({})
  const [mermaidOpen, setMermaidOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiInstructions, setAiInstructions] = useState('')
  const [aiPreview, setAiPreview] = useState<AiFlowPreview | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')

  const savedSortedFlows = useMemo(() => [...savedFlows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [savedFlows])

  useEffect(() => {
    let cancelled = false
    loadFlowDefinitions().then((flows) => {
      if (cancelled) return
      setSavedFlows(flows)
      const first = [...flows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
      if (first) {
        setActiveFlowId(first.id)
        setFlowName(first.name)
        setMermaid(first.mermaidSource || '')
        setDraftMermaid(first.mermaidSource || '')
        setDirectGraph(first.graph)
        setRequestOverrides(requestOverridesFromGraph(first.graph))
        setConditionOverrides(conditionOverridesFromGraph(first.graph))
      }
    })
    return () => { cancelled = true }
  }, [])

  const graph = useMemo(() => {
    if (directGraph) return directGraph
    // Mermaid parsing emits a single row; the canvas layout gives branches their
    // own lane so a false edge never crosses the happy path.
    const next = layoutFlow(graphFromMermaid(mermaid, catalog))
    return {
      ...next,
      nodes: next.nodes.map((node) => {
        const key = nodeOverrideKey(node)
        if (node.type === 'request' && requestOverrides[key]) {
          return { ...node, config: { ...node.config, request: { ...requestOverrides[key], id: uid(), name: node.label } } }
        }
        if (node.type === 'condition' && conditionOverrides[key]) {
          return { ...node, config: { ...node.config, condition: conditionOverrides[key] } }
        }
        return node
      }),
    }
  }, [catalog, conditionOverrides, directGraph, mermaid, requestOverrides])

  const draftGraph = useMemo(() => graphFromMermaid(draftMermaid, catalog), [catalog, draftMermaid])
  const validationErrors = useMemo(() => validateFlowGraph(graph), [graph])
  const activeEnv = environments.find((env) => env.id === activeEnvId)
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId) ?? null
  const firstProblem = validationErrors[0]
  const requestCount = graph.nodes.filter((node) => node.type === 'request').length

  useEffect(() => {
    setPositions(Object.fromEntries(graph.nodes.map((node) => [node.id, { x: node.x, y: node.y }])))
    setSelectedNodeId((current) => current && graph.nodes.some((node) => node.id === current) ? current : null)
  }, [graph.nodes])

  const persist = async (next: SavedFlowDefinition[]) => {
    setSaveError('')
    setSaveNotice('')
    setSavedFlows(next)
    try {
      setSavedFlows(await saveFlowDefinitions(next))
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    }
  }

  const saveFlow = () => {
    const id = activeFlowId ?? uid()
    // Dragging is a user edit: persist the canvas coordinates, rather than only
    // keeping them in the renderer's transient position map.
    const graphToSave: FlowGraphDefinition = {
      ...graph,
      nodes: graph.nodes.map((node) => ({ ...node, ...(positions[node.id] ?? {}) })),
    }
    const saved: SavedFlowDefinition = {
      id,
      name: flowName.trim() || 'Untitled API flow',
      graph: graphToSave,
      mermaidSource: '',
      updatedAt: new Date().toISOString(),
      version: 4,
      schemaVersion: 4,
    }
    setDirectGraph(graphToSave)
    setMermaid('')
    setActiveFlowId(id)
    setFlowName(saved.name)
    void persist([saved, ...savedFlows.filter((flow) => flow.id !== id)])
  }

  const createMockDemo = useCallback(async () => {
    const mockPort = mockSettings.defaultMockPort || 3000
    const mockBaseUrl = `http://127.0.0.1:${mockPort}`
    const endpoints = createMockCommerceEndpoints()
    const collection = createMockCommerceCollection(mockBaseUrl)
    const demoFlow = createMockCommerceFlow(collection)

    importCollection(collection)
    await appendMockEndpoints(endpoints)
    await persist([demoFlow, ...savedFlows.filter((flow) => flow.name !== MOCK_FLOW_DEMO_NAME)])
    loadFlow(demoFlow)
    setCatalogSearch('')

    let startMessage = `Created ${MOCK_FLOW_DEMO_NAME}.`
    if (sidecarPort) {
      try {
        const response = await sidecarFetch(serverUrl(sidecarPort, '/mock/start'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            port: mockPort,
            password: mockSettings.mockServerPassword || '',
            endpoints,
          }),
        })
        if (response.ok) {
          const data = await response.json() as { ok?: boolean; running?: boolean }
          const started = data.ok === true || data.running === true
          setMockRunning(started)
          startMessage = started
            ? `Created ${MOCK_FLOW_DEMO_NAME} and started Mock Server on ${mockBaseUrl}.`
            : `${startMessage} Open Mock Server and press Start, then run the flow.`
        } else {
          startMessage = `${startMessage} Open Mock Server and press Start, then run the flow.`
        }
      } catch {
        startMessage = `${startMessage} Open Mock Server and press Start, then run the flow.`
      }
    } else {
      startMessage = `${startMessage} Open Mock Server and press Start, then run the flow.`
    }
    setSaveNotice(startMessage)
  }, [importCollection, mockSettings.defaultMockPort, mockSettings.mockServerPassword, persist, savedFlows, setMockRunning, sidecarPort])

  const newFlow = () => {
    setActiveFlowId(null)
    setFlowName('Untitled API flow')
    setMermaid('')
    setDraftMermaid('')
    setDirectGraph(createBlankFlowGraph())
    setRuntime({})
    setLastRun([])
    setVars({})
    setSelectedNodeId(null)
    setRequestOverrides({})
    setConditionOverrides({})
  }

  const loadFlow = (flow: SavedFlowDefinition) => {
    setActiveFlowId(flow.id)
    setFlowName(flow.name)
    setMermaid(flow.mermaidSource || '')
    setDraftMermaid(flow.mermaidSource || '')
    setDirectGraph(flow.graph)
    setRequestOverrides(requestOverridesFromGraph(flow.graph))
    setConditionOverrides(conditionOverridesFromGraph(flow.graph))
    setRuntime({})
    setLastRun([])
    setVars({})
    setSelectedNodeId(null)
  }

  const deleteFlow = (id: string) => {
    void persist(savedFlows.filter((flow) => flow.id !== id))
    if (activeFlowId === id) newFlow()
  }

  const updateFlowNode = (nodeId: string, update: (node: FlowNodeDefinition) => FlowNodeDefinition) => {
    // A user edit turns a Mermaid-derived graph into the persisted visual graph.
    // This prevents the next Mermaid parse from silently discarding editor changes.
    setMermaid('')
    setDirectGraph({ ...graph, nodes: graph.nodes.map((node) => { const positioned = { ...node, ...positions[node.id] }; return node.id === nodeId ? update(positioned) : positioned }) })
  }

  const updateNodeRequest = (nodeId: string, request: RequestItem) => {
    updateFlowNode(nodeId, (node) => ({
      ...node,
      label: request.name ? `${node.config.seq ? `${node.config.seq}. ` : ''}${request.name}` : node.label,
      config: { ...node.config, request },
    }))
  }

  const patchNodeConfig = (nodeId: string, patch: Partial<FlowNodeDefinition['config']>) => {
    updateFlowNode(nodeId, (node) => ({ ...node, config: { ...node.config, ...patch } }))
  }

  const arrangeNodes = () => {
    setFitVersion(value => value + 1)
    setMermaid('')
    setDirectGraph(layoutFlow(graph))
    setSelectedNodeId(null)
  }

  const addNode = (type: 'request' | 'condition') => {
    const base = directGraph ?? graph
    const start = base.nodes.find((node) => node.type === 'start')
    const end = base.nodes.find((node) => node.type === 'end')
    if (!start || !end) return
    const ordinal = base.nodes.filter((node) => node.type === 'request' || node.type === 'condition').length + 1
    const node: FlowNodeDefinition = type === 'request'
      ? { id: uid(), type, label: `${ordinal}. API Request`, x: 300 + (ordinal - 1) * 270, y: 190, width: 244, height: 126, config: { request: blankRequest('GET', 'API Request'), expectedStatus: '2xx', stopOnFailure: true, retryCount: 0, extractions: [], seq: ordinal } }
      : { id: uid(), type, label: `Condition ${ordinal}`, x: 300 + (ordinal - 1) * 270, y: 170, width: 170, height: 170, config: { condition: { source: 'status', path: 'response.status', operator: 'eq', value: '200' } } }
    const incoming = base.edges.filter((edge) => edge.target === end.id)
    const retained = base.edges.filter((edge) => edge.target !== end.id)
    const nextEdges = type === 'condition'
      ? [...retained, ...incoming.map(edge => ({ ...edge, target: node.id })), { id: uid(), source: node.id, target: end.id, branch: 'true' as const, label: 'true' }, { id: uid(), source: node.id, target: end.id, branch: 'false' as const, label: 'false' }]
      : [...retained, ...incoming.map(edge => ({ ...edge, target: node.id })), { id: uid(), source: node.id, target: end.id, branch: 'next' as const, label: '' }]
    setMermaid('')
    setDirectGraph(layoutFlow({ ...base, nodes: [...base.nodes, node], edges: nextEdges }))
    selectNode(node.id)
  }

  const applyVisualOrder = () => {
    if (!directGraph || graph.nodes.some(node => node.type === 'condition' || node.type === 'extract')) return
    const start = graph.nodes.find((node) => node.type === 'start')
    const end = graph.nodes.find((node) => node.type === 'end')
    const requests = graph.nodes
      .filter((node) => node.type === 'request')
      .sort((a, b) => (positions[a.id]?.x ?? a.x) - (positions[b.id]?.x ?? b.x))
      .map((node, index) => ({ ...node, label: node.label.replace(/^\d+\.\s*/, `${index + 1}. `), config: { ...node.config, seq: index + 1 } }))
    if (!start || !end || requests.length === 0) return
    const nodesById = new Map<string, FlowNodeDefinition>(requests.map((node) => [node.id, node]))
    nodesById.set(start.id, start)
    nodesById.set(end.id, end)
    const linearNodes = [start, ...requests, end]
    setDirectGraph({
      ...directGraph,
      nodes: graph.nodes.map((node) => nodesById.get(node.id) ?? node),
      edges: linearNodes.slice(1).map((node, index) => ({ id: uid(), source: linearNodes[index].id, target: node.id, branch: 'next' as const, label: '' })),
    })
  }

  const patchCondition = (nodeId: string, patch: Partial<FlowCondition>) => {
    const node = graph.nodes.find((item) => item.id === nodeId)
    if (!node || node.type !== 'condition') return
    updateFlowNode(nodeId, (current) => ({
      ...current,
      config: { ...current.config, condition: { ...(current.config.condition ?? { source: 'body', path: '', operator: 'eq', value: '' }), ...patch } },
    }))
  }

  const runFlow = useCallback(async (fromNodeId?: string) => {
    if (running) return
    const errors = validateFlowGraph(graph)
    if (errors.length > 0) return
    setRunning(true)
    setLastRun([])
    const controller = new AbortController()
    runAbortRef.current = controller
    try {
      await runApiFlow(graph, {
        initialVars: envVars(),
        startNodeId: fromNodeId,
        signal: controller.signal,
        onRuntime: setRuntime,
        onEntry: setLastRun,
        onVars: setVars,
        onSelectedNode: setSelectedNodeId,
      })
    } finally {
      runAbortRef.current = null
      setRunning(false)
    }
  }, [envVars, graph, running])

  const handleImportFile = async (file: File) => {
    const text = await file.text()
    if (/\.json$/i.test(file.name)) {
      try {
        const parsed = JSON.parse(text) as { definition?: { name?: string; graph?: unknown; mermaidSource?: string }; name?: string; graph?: unknown; mermaidSource?: string }
        const definition = parsed.definition ?? parsed
        if (!definition.graph) throw new Error('This JSON file does not contain an adOmnia Flow definition.')
        const [imported] = normalizeFlowDefinitions([{
          id: uid(), name: definition.name || file.name.replace(/\.json$/i, ''), graph: definition.graph,
          mermaidSource: definition.mermaidSource || '', updatedAt: new Date().toISOString(), version: 4, schemaVersion: 4,
        }])
        if (!imported) throw new Error('Could not read this Flow definition.')
        await persist([imported, ...savedFlows.filter((flow) => flow.id !== imported.id)])
        loadFlow(imported)
        return
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : 'Could not import Flow JSON.')
        return
      }
    }
    setDraftMermaid(text)
    setMermaid(text)
    setDirectGraph(null)
    setFlowName(file.name.replace(/\.(mmd|mermaid|txt)$/i, '') || 'Imported API flow')
    setActiveFlowId(null)
    setRuntime({})
    setLastRun([])
    setRequestOverrides({})
    setConditionOverrides({})
  }

  const openMermaidModal = () => {
    setDraftMermaid(mermaid)
    setMermaidOpen(true)
  }

  const applyMermaidModal = () => {
    setMermaid(draftMermaid)
    setDirectGraph(null)
    setActiveFlowId(null)
    setRuntime({})
    setLastRun([])
    setRequestOverrides({})
    setConditionOverrides({})
    setMermaidOpen(false)
  }

  const exportJson = () => downloadBlob(JSON.stringify({ format: 'adomnia-flow', version: 4, schemaVersion: 4, definition: { name: flowName, graph, mermaidSource: mermaid }, lastRun }, null, 2), `${flowName.replace(/[^\w.-]+/g, '-').toLowerCase() || 'flow'}.json`, 'application/json')
  const exportRun = () => downloadBlob(exportRunMarkdown(flowName, lastRun), `${flowName.replace(/[^\w.-]+/g, '-').toLowerCase() || 'flow'}-run.md`, 'text/markdown')

  const generateAiPreview = async () => {
    if (!aiInstructions.trim()) return
    setAiLoading(true)
    setAiError('')
    try {
      setAiPreview(await generateAiFlowPreview({
        instructions: aiInstructions,
        context: { collections, environments },
      }))
    } catch (error) {
      setAiError(error instanceof Error ? error.message : String(error))
    } finally {
      setAiLoading(false)
    }
  }

  const applyAiPreview = () => {
    if (!aiPreview) return
    const generated = aiPreview.definition
    setActiveFlowId(null)
    setFlowName(generated.name)
    setMermaid('')
    setDraftMermaid('')
    setDirectGraph(generated.graph)
    setRequestOverrides(requestOverridesFromGraph(generated.graph))
    setConditionOverrides(conditionOverridesFromGraph(generated.graph))
    setRuntime({})
    setLastRun([])
    setVars({})
    setSelectedNodeId(generated.graph.nodes.find((node) => node.type === 'request')?.id ?? generated.graph.nodes[0]?.id ?? null)
    setPositions(Object.fromEntries(generated.graph.nodes.map((node) => [node.id, { x: node.x, y: node.y }])))
    void persist([generated, ...savedFlows])
    setAiOpen(false)
  }


  const conditionCount = graph.nodes.filter((node) => node.type === 'condition').length
  const canOrderSteps = !!directGraph && requestCount > 0 && !graph.nodes.some((node) => node.type === 'condition' || node.type === 'extract')

  return (
    <div data-flow-workspace className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-0">
      <input ref={fileRef} type="file" accept=".mmd,.mermaid,.txt,.json" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleImportFile(file); event.currentTarget.value = '' }} />

      <header className="relative z-30 flex h-[52px] flex-shrink-0 items-center gap-2 border-b border-border-1 bg-surface-1 px-4">
        <FlowSwitcher
          flowName={flowName}
          setFlowName={setFlowName}
          savedFlows={savedSortedFlows}
          activeFlowId={activeFlowId}
          onNew={newFlow}
          onCreateMockDemo={() => void createMockDemo()}
          onLoad={loadFlow}
          onDelete={deleteFlow}
        />
        <span className="hidden h-5 shrink-0 items-center rounded-md bg-surface-3 px-2 text-[11px] text-text-2 sm:inline-flex">Draft</span>
        <span className="hidden shrink truncate text-[11px] text-text-3 xl:inline">
          {requestCount} steps · {conditionCount} conditions · saved locally
        </span>

        {firstProblem && (
          <span className="hidden max-w-[260px] shrink items-center gap-1.5 truncate text-[11px] text-warning 2xl:inline-flex" title={firstProblem}>
            <AlertTriangle size={12} className="shrink-0" />
            <span className="truncate">{firstProblem}</span>
          </span>
        )}

        <span className="flex-1" />

        <div className="flex h-8 shrink-0 items-center gap-2 rounded-lg border border-border-1 bg-surface-0 pl-2.5 text-text-2 hover:border-border-3">
          <span className={cn('h-[6px] w-[6px] shrink-0 rounded-full', activeEnv ? 'bg-accent' : 'bg-text-4')} />
          <select
            aria-label="Flow environment"
            value={activeEnvId ?? ''}
            onChange={(event) => useEnvironmentsStore.getState().setActiveEnv(event.target.value || null)}
            className="h-full max-w-[160px] cursor-pointer border-0 bg-transparent pr-6 text-xs text-text-2 outline-none"
          >
            <option value="">No environment</option>
            {environments.map((env) => <option key={env.id} value={env.id}>{env.name}</option>)}
          </select>
        </div>

        <button onClick={() => addNode('request')} className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border-1 bg-surface-0 px-2.5 text-xs text-text-2 hover:border-border-3 hover:text-text-1">
          <Plus size={12} /> Step
        </button>
        <button onClick={() => addNode('condition')} className="hidden h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border-1 bg-surface-0 px-2.5 text-xs text-text-2 hover:border-border-3 hover:text-text-1 lg:flex">
          <GitFork size={12} /> Condition
        </button>

        <button title={inspectorOpen && !focusMode ? 'Hide inspector' : 'Show inspector'} aria-pressed={inspectorOpen && !focusMode} onClick={() => { setInspectorOpen(!inspectorOpen || focusMode); setFocusMode(false) }} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border-1 text-text-3 hover:text-accent"><PanelRight size={14} /></button>
        <button title={timelineOpen && !focusMode ? 'Hide timeline' : 'Show timeline'} aria-pressed={timelineOpen && !focusMode} onClick={() => { setTimelineOpen(!timelineOpen || focusMode); setFocusMode(false) }} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border-1 text-text-3 hover:text-accent"><List size={14} /></button>
        <button title={focusMode ? 'Restore panels' : 'Focus canvas'} aria-pressed={focusMode} onClick={() => setFocusMode(value => !value)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border-1 text-text-3 hover:text-accent"><Focus size={14} /></button>
        <FlowToolbarMenu
          items={[
            { label: 'Save flow', icon: Save, onClick: saveFlow },
            { label: 'Generate with AI', icon: Sparkles, onClick: () => { setFocusMode(false); setAiOpen(true) } },
            { label: 'Arrange layout', icon: Grid3X3, onClick: arrangeNodes },
            { label: 'Order steps', icon: GitBranch, onClick: applyVisualOrder, disabled: !canOrderSteps },
            { label: 'Import Mermaid...', icon: FileInput, onClick: openMermaidModal },
            { label: 'Open flow file...', icon: Download, onClick: () => fileRef.current?.click() },
            { label: 'Export flow JSON', icon: FileJson, onClick: exportJson },
            { label: 'Export run report', icon: Download, onClick: exportRun, disabled: lastRun.length === 0 },
          ]}
        />

        <button
          onClick={() => running ? runAbortRef.current?.abort() : void runFlow()}
          disabled={!running && validationErrors.length > 0}
          className={cn('flex h-8 shrink-0 items-center gap-2 rounded-lg px-3.5 text-xs font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-45', running ? 'bg-error hover:bg-error/85' : 'bg-accent hover:bg-accent-hover')}
        >
          {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} fill="currentColor" />}
          {running ? 'Stop' : 'Run'}
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <FlowCanvas
          graph={graph}
          runtime={runtime}
          selectedNodeId={selectedNodeId}
          positions={positions}
          zoom={zoom}
          fitVersion={fitVersion}
          onZoom={setZoom}
          onSelect={selectNode}
          onArrange={arrangeNodes}
          onMove={(id, position) => setPositions((current) => ({ ...current, [id]: position }))}
        />
        <FlowDockPanel title="Execution timeline" side="bottom" open={timelineOpen && !focusMode} onClose={() => setTimelineOpen(false)}><FlowRunTimeline entries={lastRun} running={running} selectedNodeId={selectedNodeId} onSelect={selectNode} onClear={() => setLastRun([])} /></FlowDockPanel>
        </div>

        <FlowDockPanel title="Inspector" side="right" open={inspectorOpen && !focusMode} onClose={() => setInspectorOpen(false)}>
        {selectedNode ? (
          <FlowInspectorDrawer
            node={selectedNode}
            graph={graph}
            scopeVars={flowScopeVars(graph, selectedNode.id, vars)}
            runtime={runtime[selectedNode.id]}
            lastEntry={lastRun.find((entry) => entry.nodeId === selectedNode.id)}
            catalog={catalog}
            activeEnvName={activeEnv?.name ?? 'No environment'}
            search={catalogSearch}
            setSearch={setCatalogSearch}
            onBindRequest={updateNodeRequest}
            onPatchNodeConfig={patchNodeConfig}
            onPatchCondition={patchCondition}
            onRunStep={(nodeId) => void runFlow(nodeId)}
          />
        ) : <div className="p-4 text-xs text-text-3">Select a step to edit its request, inspect the response or map variables.</div>}
        </FlowDockPanel>

      {mermaidOpen && (
        <MermaidModal
          value={draftMermaid}
          onChange={setDraftMermaid}
          onClose={() => setMermaidOpen(false)}
          onImport={applyMermaidModal}
          catalog={catalog}
          graph={draftGraph}
        />
      )}

        {aiOpen && (
          <FlowDockPanel title="Generate flow" side="right" open={!focusMode} initialFloating initialWidth={560} onClose={() => setAiOpen(false)}>
              <AiFlowDrawer
                instructions={aiInstructions}
                setInstructions={(value) => { setAiInstructions(value); setAiPreview(null); setAiError('') }}
                preview={aiPreview}
                loading={aiLoading}
                error={aiError}
                onGeneratePreview={() => void generateAiPreview()}
                onApply={applyAiPreview}
                onClose={() => setAiOpen(false)}
              />
          </FlowDockPanel>
        )}
      </div>

      <footer className="flex h-[22px] flex-shrink-0 items-center gap-3 border-t border-border-1 bg-surface-1 px-3 text-[11px] text-text-4">
        <span className="inline-flex shrink-0 items-center gap-1.5">
          <span className={cn('h-[5px] w-[5px] rounded-full', sidecarPort ? 'bg-success' : 'bg-warning')} />
          {sidecarPort ? 'connected' : 'backend offline'}
        </span>
        <span className="shrink-0">{catalog.length} catalog requests</span>
        {saveNotice && <span className="min-w-0 truncate text-info" title={saveNotice}>{saveNotice}</span>}
        {saveError && <span className="min-w-0 truncate text-error" title={saveError}>{saveError}</span>}
        <span className="flex-1" />
        <span className="shrink-0">{activeEnv?.name ?? 'No environment'}</span>
        <span className="shrink-0">Default Workspace</span>
      </footer>


    </div>
  )
}
