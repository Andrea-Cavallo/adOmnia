import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Download,
  FileInput,
  FileJson,
  GitBranch,
  GitFork,
  Grid3X3,
  Layers,
  Loader2,
  Maximize2,
  Play,
  Plus,
  Save,
  Search,
  Server,
  Settings,
  Square,
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
import {
  loadFlowDefinitions,
  saveFlowDefinitions,
  type FlowCondition,
  type FlowEdgeDefinition,
  type FlowGraphDefinition,
  type FlowNodeDefinition,
  type FlowRunStatus,
  type SavedFlowDefinition,
} from '@/lib/flowStorage'
import { flattenApiCatalog } from '@/lib/apiCatalog'
import { type RequestItem, uid } from '@/lib/types'
import { cn } from '@/lib/utils'
import { serverUrl, sidecarFetch, useServerPort } from '@/lib/useServerPort'
import { useAppStore } from '@/stores/app'
import { useCollectionsStore } from '@/stores/collections'
import { useEnvironmentsStore } from '@/stores/environments'
import { useSettingsStore } from '@/stores/settings'

const NODE_SIZE: Record<FlowNodeDefinition['type'], { w: number; h: number }> = {
  start: { w: 136, h: 66 },
  request: { w: 244, h: 126 },
  condition: { w: 170, h: 170 },
  end: { w: 188, h: 74 },
  extract: { w: 220, h: 104 },
}

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
  return 'border-border-2 bg-surface-1 text-text-2'
}

function statusIcon(status?: FlowRunStatus) {
  if (status === 'running') return <Loader2 size={14} className="animate-spin" />
  if (status === 'success') return <CheckCircle2 size={14} />
  if (status === 'failed') return <XCircle size={14} />
  if (status === 'skipped') return <Circle size={14} />
  return null
}

function nodeSize(node: FlowNodeDefinition) {
  return {
    w: node.width ?? NODE_SIZE[node.type].w,
    h: node.height ?? NODE_SIZE[node.type].h,
  }
}

function FlowWorkspaceSidebar({
  flowName,
  setFlowName,
  savedFlows,
  activeFlowId,
  saveError,
  onNew,
  onCreateMockDemo,
  onSave,
  onLoad,
  onDelete,
  onImport,
  onExportJson,
  onExportRun,
  hasRun,
}: {
  flowName: string
  setFlowName: (value: string) => void
  savedFlows: SavedFlowDefinition[]
  activeFlowId: string | null
  saveError: string
  onNew: () => void
  onCreateMockDemo: () => void
  onSave: () => void
  onLoad: (flow: SavedFlowDefinition) => void
  onDelete: (id: string) => void
  onImport: () => void
  onExportJson: () => void
  onExportRun: () => void
  hasRun: boolean
}) {
  const [query, setQuery] = useState('')
  const filtered = savedFlows.filter((flow) => flow.name.toLowerCase().includes(query.toLowerCase()))

  return (
    <aside className="flex min-h-0 w-[276px] flex-shrink-0 flex-col border-r border-border-1 bg-surface-1">
      <div className="flex h-14 items-center gap-2 border-b border-border-1 px-4">
        <GitBranch size={17} className="text-accent" />
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text-1">Flow Workspace</div>
          <div className="text-[10px] text-text-4">Mermaid, catalog, saved runs</div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
        <div className="grid grid-cols-2 gap-1.5">
          <button onClick={onNew} className="flex h-9 items-center justify-center gap-2 rounded-lg bg-accent text-xs font-semibold text-white shadow-[0_8px_22px_rgba(139,61,255,0.24)] hover:bg-accent-hover">
            <Plus size={15} /> New Flow
          </button>
          <button onClick={onCreateMockDemo} className="flex h-9 items-center justify-center gap-2 rounded-lg border border-success/30 bg-success/10 text-xs font-semibold text-success hover:bg-success/15">
            <Server size={15} /> Mock demo
          </button>
        </div>

        <div className="mt-2 grid grid-cols-4 gap-1.5">
          <button onClick={onSave} title="Save flow" className="grid h-9 place-items-center rounded-lg border border-border-2 bg-surface-0 text-text-3 hover:text-text-1"><Save size={14} /></button>
          <button onClick={onImport} title="Import Mermaid" className="grid h-9 place-items-center rounded-lg border border-border-2 bg-surface-0 text-text-3 hover:text-text-1"><FileInput size={14} /></button>
          <button onClick={onExportJson} title="Export flow JSON" className="grid h-9 place-items-center rounded-lg border border-border-2 bg-surface-0 text-text-3 hover:text-text-1"><FileJson size={14} /></button>
          <button onClick={onExportRun} disabled={!hasRun} title="Export run report" className="grid h-9 place-items-center rounded-lg border border-border-2 bg-surface-0 text-text-3 hover:text-text-1 disabled:opacity-40"><Download size={14} /></button>
        </div>

        <label className="mt-4 text-[10px] font-bold uppercase tracking-[0.14em] text-text-4">Active flow</label>
        <input
          value={flowName}
          onChange={(event) => setFlowName(event.target.value)}
          className="mt-2 h-9 rounded-lg border border-border-2 bg-surface-0 px-3 text-xs font-medium text-text-1 outline-none focus:border-accent"
          placeholder="Flow name"
        />
        {saveError && <div className="mt-2 rounded-lg border border-error/30 bg-error/10 px-2 py-1.5 text-[10px] text-error">{saveError}</div>}

        <div className="mt-5 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-4">Saved flows</span>
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-text-4">{filtered.length}</span>
        </div>
        <div className="mt-2 flex h-9 items-center gap-2 rounded-lg border border-border-2 bg-surface-0 px-2">
          <Search size={13} className="text-text-4" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search flows..." className="min-w-0 flex-1 bg-transparent text-xs text-text-1 outline-none placeholder:text-text-4" />
        </div>

        <div className="mt-2 space-y-1">
          {filtered.map((flow) => (
            <div key={flow.id} className={cn('group flex items-center gap-2 rounded-lg border px-2 py-2', flow.id === activeFlowId ? 'border-accent/60 bg-accent/10' : 'border-transparent hover:border-border-1 hover:bg-surface-0')}>
              <button onClick={() => onLoad(flow)} className="min-w-0 flex-1 text-left">
                <div className="truncate text-xs font-semibold text-text-1">{flow.name}</div>
                <div className="truncate text-[10px] text-text-4">{flow.graph.nodes.length} nodes · {new Date(flow.updatedAt).toLocaleDateString()}</div>
              </button>
              <button onClick={() => onDelete(flow.id)} title="Delete flow" className="grid h-7 w-7 place-items-center rounded-md text-text-4 opacity-0 hover:bg-error/10 hover:text-error group-hover:opacity-100">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {filtered.length === 0 && <div className="rounded-lg border border-dashed border-border-2 px-3 py-5 text-center text-[11px] text-text-4">No saved flow matches this search.</div>}
        </div>

        <div className="mt-auto pt-4">
          <div className="rounded-xl border border-border-1 bg-surface-0 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-text-2">
              <Layers size={14} className="text-accent" />
              Default Workspace
            </div>
            <div className="mt-1 text-[10px] text-text-4">Flows are saved locally with this workspace.</div>
          </div>
        </div>
      </div>
    </aside>
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
}: {
  graph: FlowGraphDefinition
  runtime: RuntimeByNode
  selectedNodeId: string | null
  positions: Record<string, { x: number; y: number }>
  zoom: number
  onZoom: (value: number) => void
  onSelect: (id: string | null) => void
  onMove: (id: string, position: { x: number; y: number }) => void
}) {
  const liveNodes = graph.nodes.map((node) => ({ ...node, x: positions[node.id]?.x ?? node.x, y: positions[node.id]?.y ?? node.y }))
  const byId = new Map(liveNodes.map((node) => [node.id, node]))
  const maxX = Math.max(900, ...liveNodes.map((node) => node.x + nodeSize(node).w + 180))
  const maxY = Math.max(560, ...liveNodes.map((node) => node.y + nodeSize(node).h + 180))

  const startDrag = (event: React.PointerEvent, node: FlowNodeDefinition) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startY = event.clientY
    const base = positions[node.id] ?? { x: node.x, y: node.y }
    let moved = false

    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / zoom
      const dy = (ev.clientY - startY) / zoom
      moved = moved || Math.abs(dx) > 2 || Math.abs(dy) > 2
      onMove(node.id, {
        x: Math.max(24, Math.round((base.x + dx) / 22) * 22),
        y: Math.max(24, Math.round((base.y + dy) / 22) * 22),
      })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (!moved) onSelect(node.id)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const edgePath = (edge: FlowEdgeDefinition) => {
    const source = byId.get(edge.source)
    const target = byId.get(edge.target)
    if (!source || !target) return null
    const ss = nodeSize(source)
    const ts = nodeSize(target)
    const branchOffset = edge.branch === 'false' || edge.branch === 'else' || edge.branch === 'error' ? 34 : edge.branch === 'true' ? -26 : 0
    const a = { x: source.x + ss.w, y: source.y + ss.h / 2 + branchOffset }
    const b = { x: target.x, y: target.y + ts.h / 2 }
    const dx = Math.max(70, Math.abs(b.x - a.x) * 0.45)
    return {
      d: `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`,
      labelX: (a.x + b.x) / 2,
      labelY: (a.y + b.y) / 2,
    }
  }

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-surface-0">
      <div className="absolute left-4 top-4 z-20 flex items-center gap-1 rounded-xl border border-border-1 bg-surface-1/95 p-1 shadow-lg">
        <button title="Select" className="grid h-8 w-8 place-items-center rounded-lg bg-accent/15 text-accent"><Square size={14} /></button>
        <button title="Add step" className="flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-text-2 hover:bg-surface-2 hover:text-text-1"><Plus size={14} /> Step</button>
        <span className="mx-1 h-5 w-px bg-border-1" />
        <button title="Zoom out" onClick={() => onZoom(Math.max(0.55, zoom - 0.1))} className="grid h-8 w-8 place-items-center rounded-lg text-text-3 hover:bg-surface-2 hover:text-text-1"><ZoomOut size={14} /></button>
        <button title="Reset zoom" onClick={() => onZoom(1)} className="h-8 rounded-lg px-2 text-[11px] font-semibold text-text-3 hover:bg-surface-2 hover:text-text-1">{Math.round(zoom * 100)}%</button>
        <button title="Zoom in" onClick={() => onZoom(Math.min(1.6, zoom + 0.1))} className="grid h-8 w-8 place-items-center rounded-lg text-text-3 hover:bg-surface-2 hover:text-text-1"><ZoomIn size={14} /></button>
        <button title="Snap grid" className="grid h-8 w-8 place-items-center rounded-lg text-accent"><Grid3X3 size={14} /></button>
        <button title="Fullscreen" className="grid h-8 w-8 place-items-center rounded-lg text-text-3 hover:bg-surface-2 hover:text-text-1"><Maximize2 size={14} /></button>
      </div>

      <div
        className="absolute inset-0 overflow-auto bg-[radial-gradient(var(--color-border-1)_1px,transparent_1px)] bg-[size:22px_22px]"
        onClick={() => onSelect(null)}
      >
        <div className="relative origin-top-left" style={{ width: maxX, height: maxY, transform: `scale(${zoom})` }}>
          <svg className="pointer-events-none absolute inset-0 overflow-visible" width={maxX} height={maxY}>
            <defs>
              <marker id="flow-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
                <path d="M1 1 L7 4.5 L1 8 Z" fill="var(--color-border-2)" />
              </marker>
              <marker id="flow-arrow-ok" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
                <path d="M1 1 L7 4.5 L1 8 Z" fill="var(--color-success)" />
              </marker>
              <marker id="flow-arrow-error" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
                <path d="M1 1 L7 4.5 L1 8 Z" fill="var(--color-error)" />
              </marker>
            </defs>
            {graph.edges.map((edge) => {
              const path = edgePath(edge)
              if (!path) return null
              const targetStatus = runtime[edge.target]?.status
              const errorEdge = edge.branch === 'false' || edge.branch === 'else' || edge.branch === 'error'
              const active = targetStatus && targetStatus !== 'pending' && targetStatus !== 'skipped'
              const stroke = active ? (errorEdge ? 'var(--color-error)' : 'var(--color-success)') : 'var(--color-border-2)'
              return (
                <path
                  key={edge.id}
                  d={path.d}
                  fill="none"
                  stroke={stroke}
                  strokeWidth="2"
                  strokeDasharray={runtime[edge.target]?.status === 'running' ? '7 6' : undefined}
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
                className={cn('pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-md border px-2 py-0.5 text-[10px] font-semibold', errorEdge ? 'border-error/30 bg-error/10 text-error' : 'border-success/30 bg-success/10 text-success')}
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

      <div className="absolute bottom-4 left-4 z-20 w-48 rounded-xl border border-border-1 bg-surface-1/95 p-2 shadow-lg">
        <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.12em] text-text-4">
          Minimap
          <span>{graph.nodes.length}</span>
        </div>
        <div className="relative h-20 rounded-lg border border-border-1 bg-surface-0">
          {liveNodes.map((node) => {
            const x = Math.max(5, Math.min(160, node.x / Math.max(1, maxX) * 176))
            const y = Math.max(5, Math.min(68, node.y / Math.max(1, maxY) * 78))
            return <span key={node.id} className={cn('absolute rounded-sm border', node.type === 'condition' ? 'h-3 w-3 rotate-45 border-warning/40 bg-warning/20' : 'h-3 w-6 border-accent/40 bg-accent/20')} style={{ left: x, top: y }} />
          })}
        </div>
      </div>
    </div>
  )
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
  const status = runtime?.status ?? 'pending'
  const baseClass = cn('absolute select-none', selected && 'z-10')

  if (node.type === 'condition') {
    const condition = node.config.condition
    return (
      <button
        onPointerDown={(event) => onPointerDown(event, node)}
        onClick={(event) => { event.stopPropagation(); onSelect(node.id) }}
        className={baseClass}
        style={{ left: node.x, top: node.y, width: size.w, height: size.h }}
      >
        <div className={cn('absolute left-1/2 top-1/2 h-[118px] w-[118px] -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-2xl border shadow-lg', statusTheme(status), selected && 'ring-2 ring-accent')} />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-5 text-center">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-warning/12 text-warning"><GitFork size={16} /></span>
          <span className="text-xs font-bold text-text-1">{node.label}</span>
          <span className="max-w-[130px] truncate font-mono text-[10px] text-text-4">{condition?.source}.{condition?.path} {condition?.operator} {condition?.value}</span>
          <span className="absolute right-3 top-3 rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold text-text-3">{graphStepLabel(node)}</span>
        </div>
      </button>
    )
  }

  if (node.type === 'start') {
    return (
      <button
        onPointerDown={(event) => onPointerDown(event, node)}
        onClick={(event) => { event.stopPropagation(); onSelect(node.id) }}
        className={cn(baseClass, 'flex items-center gap-3 rounded-2xl border px-4 py-3 shadow-lg', statusTheme(status), selected && 'ring-2 ring-accent')}
        style={{ left: node.x, top: node.y, width: size.w, height: size.h }}
      >
        <span className="grid h-9 w-9 place-items-center rounded-full bg-success/12 text-success"><Play size={15} /></span>
        <span className="text-sm font-bold text-text-1">{node.label}</span>
      </button>
    )
  }

  if (node.type === 'end') {
    const failed = node.config.endState === 'failed' || /error|stop|fail/i.test(node.label)
    return (
      <button
        onPointerDown={(event) => onPointerDown(event, node)}
        onClick={(event) => { event.stopPropagation(); onSelect(node.id) }}
        className={cn(baseClass, 'rounded-2xl border p-3 text-left shadow-lg', failed ? 'border-error/35 bg-error/10' : 'border-success/35 bg-success/10', selected && 'ring-2 ring-accent')}
        style={{ left: node.x, top: node.y, width: size.w, minHeight: size.h }}
      >
        <div className="flex items-center gap-3">
          <span className={cn('grid h-9 w-9 place-items-center rounded-xl', failed ? 'bg-error/12 text-error' : 'bg-success/12 text-success')}>{failed ? <XCircle size={16} /> : <CheckCircle2 size={16} />}</span>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-text-1">{node.label}</div>
            <div className="truncate text-[10px] text-text-4">{node.config.note || (failed ? 'Terminal failure' : 'Terminal success')}</div>
          </div>
        </div>
      </button>
    )
  }

  return (
    <button
      onPointerDown={(event) => onPointerDown(event, node)}
      onClick={(event) => { event.stopPropagation(); onSelect(node.id) }}
      className={cn(baseClass, 'rounded-2xl border p-3 text-left shadow-lg transition-colors', statusTheme(status), selected && 'ring-2 ring-accent')}
      style={{ left: node.x, top: node.y, width: size.w, minHeight: size.h }}
    >
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-lg bg-surface-2 text-text-3">{statusIcon(status) ?? <Square size={13} />}</span>
        <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold text-text-3">{graphStepLabel(node)}</span>
        <span className={cn('font-mono text-[10px] font-extrabold', methodTone(request?.method))}>{request?.method ?? 'REQ'}</span>
      </div>
      <div className="mt-3 truncate text-sm font-bold text-text-1">{node.label}</div>
      <div className="mt-1 truncate font-mono text-[10px] text-text-4">{request?.url || 'Missing URL'}</div>
      <div className="mt-3 flex items-center gap-2">
        {request?.url
          ? <span className="inline-flex items-center gap-1 rounded-md border border-accent/25 bg-accent/10 px-2 py-1 text-[10px] font-semibold text-accent"><Check size={11} /> Mapped</span>
          : <span className="inline-flex items-center gap-1 rounded-md border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] font-semibold text-warning"><AlertTriangle size={11} /> Missing binding</span>}
        {runtime?.durationMs !== undefined && <span className="rounded-md border border-border-1 bg-surface-0 px-2 py-1 text-[10px] text-text-4">{Math.round(runtime.durationMs)}ms</span>}
      </div>
    </button>
  )
}

function graphStepLabel(node: FlowNodeDefinition) {
  if (node.type === 'start') return 'S'
  const raw = node.mermaidKey || node.id
  return raw.length <= 3 ? raw.toUpperCase() : raw.slice(0, 2).toUpperCase()
}

function FlowInspectorPanel({
  node,
  graph,
  runtime,
  lastEntry,
  catalog,
  activeEnvName,
  search,
  setSearch,
  onBindRequest,
  onPatchCondition,
  onRunStep,
  onClose,
}: {
  node: FlowNodeDefinition | null
  graph: FlowGraphDefinition
  runtime?: RuntimeByNode[string]
  lastEntry?: RunEntry
  catalog: ApiCatalogRequest[]
  activeEnvName: string
  search: string
  setSearch: (value: string) => void
  onBindRequest: (nodeId: string, request: RequestItem) => void
  onPatchCondition: (nodeId: string, patch: Partial<FlowCondition>) => void
  onRunStep: (nodeId: string) => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<InspectorTab>('request')
  const condition = node?.config.condition
  const request = node?.config.request
  const q = search.trim().toLowerCase()
  const filteredCatalog = catalog
    .filter((item) => !q || `${item.label} ${item.source} ${item.request.method} ${item.request.url}`.toLowerCase().includes(q))
    .slice(0, 9)

  useEffect(() => {
    setTab(node?.type === 'condition' ? 'conditions' : 'request')
  }, [node?.id, node?.type])

  return (
    <aside className="flex min-h-0 w-[370px] flex-shrink-0 flex-col border-l border-border-1 bg-surface-1">
      <div className="flex h-14 items-center gap-2 border-b border-border-1 px-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text-1">Inspector</div>
          <div className="truncate text-[10px] text-text-4">{node ? `${node.label} · ${activeEnvName}` : `Flow settings · ${activeEnvName}`}</div>
        </div>
        {node && <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-text-3 hover:bg-surface-2 hover:text-text-1"><X size={15} /></button>}
      </div>

      {node && (
        <div className="flex border-b border-border-1 px-2">
          {(['request', 'response', 'tests', 'variables', 'conditions'] as InspectorTab[]).map((item) => (
            <button key={item} onClick={() => setTab(item)} className={cn('h-10 px-2 text-[11px] font-semibold capitalize', tab === item ? 'border-b-2 border-accent text-accent' : 'text-text-4 hover:text-text-1')}>
              {item}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!node && (
          <div className="space-y-3">
            <div className="rounded-xl border border-border-1 bg-surface-0 p-3">
              <div className="text-sm font-semibold text-text-1">Flow Settings</div>
              <div className="mt-1 text-xs text-text-4">{graph.nodes.length} nodes, {graph.edges.length} edges.</div>
            </div>
            <div className="rounded-xl border border-border-1 bg-surface-0 p-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-text-4">Execution</div>
              <div className="mt-3 space-y-2 text-xs text-text-2">
                <div className="flex items-center justify-between"><span>Max steps</span><span className="font-mono">{graph.settings.maxSteps}</span></div>
                <div className="flex items-center justify-between"><span>Fail on HTTP error</span><span>{graph.settings.failOnHttpError ? 'On' : 'Off'}</span></div>
                <div className="flex items-center justify-between"><span>Stop on missing branch</span><span>{graph.settings.stopOnMissingBranch ? 'On' : 'Off'}</span></div>
              </div>
            </div>
          </div>
        )}

        {node && (
          <div className="space-y-3">
            <div className="rounded-xl border border-border-1 bg-surface-0 p-3">
              <div className="flex items-center gap-2">
                <span className={cn('rounded-lg border px-2 py-1 text-[10px] font-bold uppercase', statusTheme(runtime?.status ?? 'pending'))}>{runtime?.status ?? 'pending'}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-1">{node.label}</span>
              </div>
              {runtime?.message && <div className="mt-2 text-xs text-text-4">{runtime.message}</div>}
              <button onClick={() => onRunStep(node.id)} className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-border-2 bg-surface-1 text-xs font-semibold text-text-1 hover:border-accent/50 hover:text-accent">
                <Play size={14} /> Run this step
              </button>
            </div>

            {tab === 'request' && (
              <>
                {node.type === 'request' ? (
                  <>
                    <div className="rounded-xl border border-border-1 bg-surface-0 p-3">
                      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-text-4">Method and URL</div>
                      <div className="mt-3 flex gap-2">
                        <span className={cn('grid h-9 w-16 place-items-center rounded-lg border border-border-2 bg-surface-1 font-mono text-xs font-extrabold', methodTone(request?.method))}>{request?.method ?? 'GET'}</span>
                        <input readOnly value={request?.url || ''} placeholder="Missing URL" className="min-w-0 flex-1 rounded-lg border border-border-2 bg-surface-1 px-3 font-mono text-xs text-text-1 outline-none" />
                      </div>
                    </div>

                    <div className="rounded-xl border border-border-1 bg-surface-0 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-text-4">Bind from API Catalog</span>
                        <span className="text-[10px] text-text-4">{catalog.length}</span>
                      </div>
                      <div className="mb-2 flex h-8 items-center gap-2 rounded-lg border border-border-2 bg-surface-1 px-2">
                        <Search size={13} className="text-text-4" />
                        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find request..." className="min-w-0 flex-1 bg-transparent text-xs text-text-1 outline-none placeholder:text-text-4" />
                      </div>
                      <div className="space-y-1.5">
                        {filteredCatalog.map((item) => (
                          <button key={item.id} onClick={() => onBindRequest(node.id, item.request)} className="w-full rounded-lg border border-border-1 bg-surface-1 px-2 py-2 text-left hover:border-accent/50 hover:bg-accent/5">
                            <div className="flex items-center gap-2">
                              <span className={cn('w-12 font-mono text-[10px] font-bold', methodTone(item.request.method))}>{item.request.method}</span>
                              <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-text-1">{item.label}</span>
                            </div>
                            <div className="mt-1 truncate font-mono text-[10px] text-text-4">{item.request.url || 'Missing URL'}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="rounded-xl border border-border-1 bg-surface-0 p-4 text-xs text-text-4">This node has no HTTP request.</div>
                )}
              </>
            )}

            {tab === 'response' && (
              <div className="rounded-xl border border-border-1 bg-surface-0 p-3">
                {!lastEntry ? (
                  <div className="py-10 text-center text-xs text-text-4">Run this flow to capture a response for this node.</div>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <span className={cn('rounded-md px-2 py-1 text-[10px] font-bold uppercase', lastEntry.status === 'success' ? 'bg-success/10 text-success' : 'bg-error/10 text-error')}>{lastEntry.status}</span>
                      {lastEntry.httpStatus !== undefined && <span className="text-xs text-text-3">HTTP {lastEntry.httpStatus}</span>}
                      <span className="text-xs text-text-4">{Math.round(lastEntry.durationMs)}ms</span>
                    </div>
                    {lastEntry.response?.body && <pre className="mt-3 max-h-72 overflow-auto rounded-lg border border-border-1 bg-surface-1 p-3 font-mono text-[10px] text-text-2">{lastEntry.response.body}</pre>}
                    {lastEntry.error && <div className="mt-3 rounded-lg border border-error/30 bg-error/10 p-2 text-xs text-error">{lastEntry.error}</div>}
                  </>
                )}
              </div>
            )}

            {tab === 'tests' && (
              <div className="space-y-2">
                {(request?.assertions ?? []).length === 0 && <div className="rounded-xl border border-border-1 bg-surface-0 p-4 text-xs text-text-4">No assertions configured for this request.</div>}
                {(lastEntry?.assertions ?? []).map((assertion) => (
                  <div key={assertion.assertionId} className="flex items-center gap-2 rounded-xl border border-border-1 bg-surface-0 p-3">
                    {assertion.passed ? <CheckCircle2 size={14} className="text-success" /> : <XCircle size={14} className="text-error" />}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold text-text-1">{assertion.label}</div>
                      <div className="truncate text-[10px] text-text-4">actual {assertion.actual} · expected {assertion.expected}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'variables' && (
              <div className="rounded-xl border border-border-1 bg-surface-0 p-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-text-4">Extractions</div>
                {(node.config.extractions ?? []).length === 0 && <div className="mt-3 text-xs text-text-4">This step extracts no variables.</div>}
                {(node.config.extractions ?? []).map((mapping) => (
                  <div key={mapping.id} className="mt-2 rounded-lg border border-border-1 bg-surface-1 p-2 font-mono text-[11px] text-text-2">
                    <span className="text-accent">{`{{${mapping.name}}}`}</span> = {mapping.source}.{mapping.path}
                  </div>
                ))}
              </div>
            )}

            {tab === 'conditions' && (
              <div className="space-y-3">
                {node.type === 'condition' && condition ? (
                  <div className="rounded-xl border border-border-1 bg-surface-0 p-3">
                    <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-text-4">Condition</div>
                    <select value={condition.source} onChange={(event) => onPatchCondition(node.id, { source: event.target.value as FlowCondition['source'] })} className="mt-3 h-9 w-full rounded-lg border border-border-2 bg-surface-1 px-2 text-xs text-text-1">
                      <option value="body">response body</option>
                      <option value="status">status</option>
                      <option value="header">header</option>
                      <option value="variable">variable</option>
                      <option value="expression">expression</option>
                    </select>
                    <input value={condition.path} onChange={(event) => onPatchCondition(node.id, { path: event.target.value })} className="mt-2 h-9 w-full rounded-lg border border-border-2 bg-surface-1 px-2 font-mono text-xs text-text-1" placeholder="user.active" />
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <input readOnly value={condition.operator} className="h-9 rounded-lg border border-border-2 bg-surface-1 px-2 font-mono text-xs text-text-3" />
                      <input value={condition.value} onChange={(event) => onPatchCondition(node.id, { value: event.target.value })} className="h-9 rounded-lg border border-border-2 bg-surface-1 px-2 font-mono text-xs text-text-1" placeholder="true" />
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-border-1 bg-surface-0 p-4 text-xs text-text-4">Outgoing edges from this node define the next execution path.</div>
                )}
                <div className="rounded-xl border border-border-1 bg-surface-0 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-text-4">Branches</div>
                  <div className="mt-2 space-y-1.5">
                    {graph.edges.filter((edge) => edge.source === node.id).map((edge) => (
                      <div key={edge.id} className="flex items-center justify-between rounded-lg border border-border-1 bg-surface-1 px-2 py-2 text-xs">
                        <span className="font-semibold text-text-2">{edge.label || edge.branch || 'next'}</span>
                        <span className="truncate pl-3 text-text-4">{graph.nodes.find((item) => item.id === edge.target)?.label ?? edge.target}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
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
  const [collapsed, setCollapsed] = useState(false)
  const success = entries.length > 0 && entries.every((entry) => entry.status !== 'failed')

  return (
    <div className={cn('flex-shrink-0 border-t border-border-1 bg-surface-1', collapsed ? 'h-11' : 'h-[218px]')}>
      <button onClick={() => setCollapsed((value) => !value)} className="flex h-11 w-full items-center gap-3 border-b border-border-1 px-4 text-left">
        <ChevronDown size={15} className={cn('text-text-4 transition-transform', collapsed && '-rotate-90')} />
        <span className="text-sm font-semibold text-text-1">Execution Timeline</span>
        {running && <span className="inline-flex items-center gap-1 rounded-md bg-accent/10 px-2 py-1 text-[11px] font-semibold text-accent"><Loader2 size={12} className="animate-spin" /> Running</span>}
        {!running && entries.length > 0 && <span className={cn('inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold', success ? 'bg-success/10 text-success' : 'bg-error/10 text-error')}>{success ? <CheckCircle2 size={12} /> : <XCircle size={12} />}{success ? 'Success' : 'Failed'}</span>}
        <span className="text-xs text-text-4">{entries.length} entries</span>
        <span className="flex-1" />
        <span onClick={(event) => { event.stopPropagation(); onClear() }} className="rounded-md px-2 py-1 text-[11px] font-semibold text-text-4 hover:bg-surface-2 hover:text-text-1">Clear</span>
      </button>

      {!collapsed && (
        <div className="h-[calc(100%-2.75rem)] overflow-auto">
          {entries.length === 0 ? (
            <div className="grid h-full place-items-center text-xs text-text-4">{running ? 'Executing flow...' : 'Run the flow to populate this timeline.'}</div>
          ) : (
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-surface-1">
                <tr className="border-b border-border-1 text-left text-[10px] uppercase tracking-[0.12em] text-text-4">
                  <th className="w-16 px-4 py-2">Step</th>
                  <th className="px-4 py-2">Step Name</th>
                  <th className="w-28 px-4 py-2">Status</th>
                  <th className="w-24 px-4 py-2">HTTP</th>
                  <th className="w-24 px-4 py-2">Duration</th>
                  <th className="px-4 py-2">Error</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, index) => (
                  <tr key={entry.id} onClick={() => onSelect(entry.nodeId)} className={cn('cursor-pointer border-b border-border-1 hover:bg-surface-2/70', selectedNodeId === entry.nodeId && 'bg-accent/10')}>
                    <td className="px-4 py-2"><span className={cn('grid h-6 w-6 place-items-center rounded-full border text-[11px] font-bold', entry.status === 'success' ? 'border-success/35 bg-success/10 text-success' : entry.status === 'failed' ? 'border-error/35 bg-error/10 text-error' : 'border-border-2 bg-surface-2 text-text-4')}>{index + 1}</span></td>
                    <td className="px-4 py-2 font-semibold text-text-1">{entry.nodeLabel}</td>
                    <td className="px-4 py-2"><span className={cn('rounded-md px-2 py-1 text-[10px] font-bold uppercase', entry.status === 'success' ? 'bg-success/10 text-success' : entry.status === 'failed' ? 'bg-error/10 text-error' : 'bg-warning/10 text-warning')}>{entry.status}</span></td>
                    <td className="px-4 py-2 font-mono text-text-3">{entry.httpStatus ?? '-'}</td>
                    <td className="px-4 py-2 font-mono text-text-3">{Math.round(entry.durationMs)}ms</td>
                    <td className="max-w-[360px] truncate px-4 py-2 text-error">{entry.error ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-8 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[82vh] w-[860px] max-w-full flex-col overflow-hidden rounded-2xl border border-border-2 bg-surface-1 shadow-2xl" onClick={(event) => event.stopPropagation()}>
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
  const [runtime, setRuntime] = useState<RuntimeByNode>({})
  const [lastRun, setLastRun] = useState<RunEntry[]>([])
  const [, setVars] = useState<Record<string, string>>({})
  const [running, setRunning] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [catalogSearch, setCatalogSearch] = useState('')
  const [zoom, setZoom] = useState(1)
  const [requestOverrides, setRequestOverrides] = useState<Record<string, RequestItem>>({})
  const [conditionOverrides, setConditionOverrides] = useState<Record<string, FlowCondition>>({})
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({})
  const [mermaidOpen, setMermaidOpen] = useState(false)

  const savedSortedFlows = useMemo(() => [...savedFlows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [savedFlows])

  useEffect(() => {
    let cancelled = false
    loadFlowDefinitions().then((flows) => {
      if (cancelled) return
      setSavedFlows(flows)
      const first = flows[0]
      if (first) {
        setActiveFlowId(first.id)
        setFlowName(first.name)
        setMermaid(first.mermaidSource || DEFAULT_MERMAID_FLOW)
        setDraftMermaid(first.mermaidSource || DEFAULT_MERMAID_FLOW)
        setRequestOverrides(requestOverridesFromGraph(first.graph))
        setConditionOverrides(conditionOverridesFromGraph(first.graph))
      }
    })
    return () => { cancelled = true }
  }, [])

  const graph = useMemo(() => {
    const next = graphFromMermaid(mermaid, catalog)
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
  }, [catalog, conditionOverrides, mermaid, requestOverrides])

  const draftGraph = useMemo(() => graphFromMermaid(draftMermaid, catalog), [catalog, draftMermaid])
  const validationErrors = useMemo(() => validateFlowGraph(graph), [graph])
  const activeEnv = environments.find((env) => env.id === activeEnvId)
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId) ?? null
  const firstProblem = validationErrors[0]
  const requestCount = graph.nodes.filter((node) => node.type === 'request').length

  useEffect(() => {
    setPositions(Object.fromEntries(graph.nodes.map((node) => [node.id, { x: node.x, y: node.y }])))
    setSelectedNodeId((current) => current && graph.nodes.some((node) => node.id === current) ? current : graph.nodes.find((node) => node.type === 'request')?.id ?? graph.nodes[0]?.id ?? null)
  }, [graph.nodes])

  const persist = async (next: SavedFlowDefinition[]) => {
    setSaveError('')
    setSavedFlows(next)
    try {
      setSavedFlows(await saveFlowDefinitions(next))
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    }
  }

  const saveFlow = () => {
    const id = activeFlowId ?? uid()
    const saved: SavedFlowDefinition = {
      id,
      name: flowName.trim() || 'Untitled API flow',
      graph,
      mermaidSource: mermaid,
      updatedAt: new Date().toISOString(),
      version: 3,
    }
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
          const data = await response.json() as { running?: boolean }
          setMockRunning(Boolean(data.running))
          startMessage = data.running
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
    setSaveError(startMessage)
  }, [importCollection, mockSettings.defaultMockPort, mockSettings.mockServerPassword, persist, savedFlows, setMockRunning, sidecarPort])

  const newFlow = () => {
    setActiveFlowId(null)
    setFlowName('Untitled API flow')
    setMermaid(DEFAULT_MERMAID_FLOW)
    setDraftMermaid(DEFAULT_MERMAID_FLOW)
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
    setMermaid(flow.mermaidSource || DEFAULT_MERMAID_FLOW)
    setDraftMermaid(flow.mermaidSource || DEFAULT_MERMAID_FLOW)
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

  const updateNodeRequest = (nodeId: string, request: RequestItem) => {
    const node = graph.nodes.find((item) => item.id === nodeId)
    if (!node) return
    setRequestOverrides((current) => ({ ...current, [nodeOverrideKey(node)]: request }))
  }

  const patchCondition = (nodeId: string, patch: Partial<FlowCondition>) => {
    const node = graph.nodes.find((item) => item.id === nodeId)
    if (!node || node.type !== 'condition') return
    setConditionOverrides((current) => ({
      ...current,
      [nodeOverrideKey(node)]: { ...(node.config.condition ?? { source: 'body', path: '', operator: 'eq', value: '' }), ...patch },
    }))
  }

  const runFlow = useCallback(async (fromNodeId?: string) => {
    if (running) return
    const errors = validateFlowGraph(graph)
    if (errors.length > 0) return
    setRunning(true)
    setLastRun([])
    try {
      await runApiFlow(graph, {
        initialVars: envVars(),
        startNodeId: fromNodeId,
        onRuntime: setRuntime,
        onEntry: setLastRun,
        onVars: setVars,
        onSelectedNode: setSelectedNodeId,
      })
    } finally {
      setRunning(false)
    }
  }, [envVars, graph, running])

  const handleImportFile = async (file: File) => {
    const text = await file.text()
    setDraftMermaid(text)
    setMermaid(text)
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
    setActiveFlowId(null)
    setRuntime({})
    setLastRun([])
    setRequestOverrides({})
    setConditionOverrides({})
    setMermaidOpen(false)
  }

  const exportJson = () => downloadBlob(JSON.stringify({ format: 'adomnia-flow', version: 3, definition: { name: flowName, graph, mermaidSource: mermaid }, lastRun }, null, 2), `${flowName.replace(/[^\w.-]+/g, '-').toLowerCase() || 'flow'}.json`, 'application/json')
  const exportRun = () => downloadBlob(exportRunMarkdown(flowName, lastRun), `${flowName.replace(/[^\w.-]+/g, '-').toLowerCase() || 'flow'}-run.md`, 'text/markdown')

  return (
    <div className="flex min-h-0 flex-1 bg-surface-0">
      <input ref={fileRef} type="file" accept=".mmd,.mermaid,.txt" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleImportFile(file); event.currentTarget.value = '' }} />
      <FlowWorkspaceSidebar
        flowName={flowName}
        setFlowName={setFlowName}
        savedFlows={savedSortedFlows}
        activeFlowId={activeFlowId}
        saveError={saveError}
        onNew={newFlow}
        onCreateMockDemo={() => void createMockDemo()}
        onSave={saveFlow}
        onLoad={loadFlow}
        onDelete={deleteFlow}
        onImport={openMermaidModal}
        onExportJson={exportJson}
        onExportRun={exportRun}
        hasRun={lastRun.length > 0}
      />

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-14 flex-shrink-0 items-center gap-3 border-b border-border-1 bg-surface-1 px-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[15px] font-bold text-text-1">{flowName}</h1>
              <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-text-3">Draft</span>
              <span className="inline-flex items-center gap-1 text-[11px] text-text-4"><CheckCircle2 size={12} className="text-success" /> Local autosave ready</span>
            </div>
            <div className="mt-0.5 text-[10px] text-text-4">{requestCount} API steps from {catalog.length} catalog requests</div>
          </div>

          {firstProblem && (
            <div className="hidden max-w-[420px] items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning xl:flex">
              <AlertTriangle size={14} />
              <span className="truncate">{firstProblem}</span>
            </div>
          )}

          <button className="flex h-9 items-center gap-2 rounded-lg border border-border-2 bg-surface-0 px-3 text-xs font-semibold text-text-2 hover:bg-surface-2 hover:text-text-1">
            <span className={cn('h-2 w-2 rounded-full', activeEnv ? 'bg-success' : 'bg-warning')} />
            {activeEnv?.name ?? 'No environment'}
            <ChevronDown size={14} className="text-text-4" />
          </button>
          <button title="Settings" className="grid h-9 w-9 place-items-center rounded-lg border border-border-2 bg-surface-0 text-text-3 hover:bg-surface-2 hover:text-text-1"><Settings size={15} /></button>
          <div className="flex overflow-hidden rounded-lg shadow-[0_8px_22px_rgba(139,61,255,0.24)]">
            <button onClick={() => void runFlow()} disabled={running || validationErrors.length > 0} className="flex h-9 items-center gap-2 bg-accent px-4 text-xs font-bold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45">
              {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {running ? 'Running' : 'Run Flow'}
            </button>
            <button className="grid h-9 w-9 place-items-center bg-accent-hover text-white"><ChevronDown size={15} /></button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <FlowCanvas
              graph={graph}
              runtime={runtime}
              selectedNodeId={selectedNodeId}
              positions={positions}
              zoom={zoom}
              onZoom={setZoom}
              onSelect={setSelectedNodeId}
              onMove={(id, position) => setPositions((current) => ({ ...current, [id]: position }))}
            />
            <FlowRunTimeline entries={lastRun} running={running} selectedNodeId={selectedNodeId} onSelect={setSelectedNodeId} onClear={() => setLastRun([])} />
          </div>

          <FlowInspectorPanel
            node={selectedNode}
            graph={graph}
            runtime={selectedNode ? runtime[selectedNode.id] : undefined}
            lastEntry={selectedNode ? lastRun.find((entry) => entry.nodeId === selectedNode.id) : undefined}
            catalog={catalog}
            activeEnvName={activeEnv?.name ?? 'No environment'}
            search={catalogSearch}
            setSearch={setCatalogSearch}
            onBindRequest={updateNodeRequest}
            onPatchCondition={patchCondition}
            onRunStep={(nodeId) => void runFlow(nodeId)}
            onClose={() => setSelectedNodeId(null)}
          />
        </div>
      </section>

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
    </div>
  )
}
