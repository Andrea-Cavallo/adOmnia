import {
  CheckCircle2,
  ChevronRight,
  GitFork,
  Loader2,
  Square,
  XCircle,
} from 'lucide-react'
import { conditionOperators, type ApiCatalogRequest } from '@/lib/flowMermaid'
import {
  type ConditionOperator,
  type FlowCondition,
  type FlowGraphDefinition,
  type FlowNodeDefinition,
  type FlowRunStatus,
} from '@/lib/flowStorage'
import { type RequestItem } from '@/lib/types'
import { cn } from '@/lib/utils'
import { type RuntimeByNode } from '@/lib/flowRunner'

function statusTone(status?: FlowRunStatus) {
  if (status === 'success') return 'border-success/35 bg-success/10 text-success'
  if (status === 'failed') return 'border-error/35 bg-error/10 text-error'
  if (status === 'running') return 'border-accent/40 bg-accent/10 text-accent'
  if (status === 'skipped') return 'border-warning/35 bg-warning/10 text-warning'
  return 'border-border-1 bg-surface-1 text-text-3'
}

export function methodTone(method: string) {
  if (method === 'GET') return 'text-[var(--color-method-get)]'
  if (method === 'POST') return 'text-[var(--color-method-post)]'
  if (method === 'PUT') return 'text-[var(--color-method-put)]'
  if (method === 'PATCH') return 'text-[var(--color-method-patch)]'
  if (method === 'DELETE') return 'text-[var(--color-method-delete)]'
  return 'text-info'
}

function requestSummary(request?: RequestItem) {
  if (!request) return 'No request'
  return request.url || 'Missing URL'
}

export function FlowConnector({ graph, node }: { graph: FlowGraphDefinition; node: FlowNodeDefinition }) {
  const outgoing = graph.edges.filter((edge) => edge.source === node.id)
  if (outgoing.length > 1) {
    return (
      <div className="flex flex-col gap-1 text-[10px] text-text-4">
        {outgoing.map((edge) => (
          <div key={edge.id} className="flex items-center gap-1">
            <span className="rounded border border-border-1 bg-surface-1 px-1.5 py-0.5">{edge.label || edge.branch}</span>
            <ChevronRight size={12} />
          </div>
        ))}
      </div>
    )
  }
  return <ChevronRight size={18} className="text-text-4" />
}

export function FlowNodeCard({ node, runtime, selected, match, onSelect, onShiftClick }: {
  node: FlowNodeDefinition
  runtime?: RuntimeByNode[string]
  selected: boolean
  match: ApiCatalogRequest | null
  onSelect: () => void
  onShiftClick?: () => void
}) {
  const request = node.config.request
  const status = runtime?.status ?? 'pending'
  const isCondition = node.type === 'condition'
  const isEnd = node.type === 'end'
  return (
    <button
      onClick={(e) => {
        if (e.shiftKey && onShiftClick) {
          onShiftClick()
        } else {
          onSelect()
        }
      }}
      className={cn(
        'relative w-[232px] rounded-md border p-3 text-left shadow-sm transition-colors',
        statusTone(status),
        selected && 'ring-1 ring-accent',
        isCondition && 'w-[190px]',
        isEnd && 'w-[170px]',
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        {isCondition ? <GitFork size={14} /> : isEnd ? (status === 'failed' ? <XCircle size={14} /> : <CheckCircle2 size={14} />) : <Square size={13} />}
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">{node.label}</span>
      </div>
      {node.type === 'request' && (
        <>
          <div className="flex items-center gap-2">
            <span className={cn('font-mono text-[10px] font-bold', methodTone(request?.method ?? 'GET'))}>{request?.method ?? 'GET'}</span>
            <span className="truncate font-mono text-[10px] text-text-3">{requestSummary(request)}</span>
          </div>
          <div className="mt-2 truncate text-[10px] text-text-4">{match ? `Matched: ${match.label}` : 'No catalog match yet'}</div>
        </>
      )}
      {node.type === 'condition' && (
        <div className="font-mono text-[10px] leading-4 text-text-3">
          {node.config.condition?.source}.{node.config.condition?.path} {node.config.condition?.operator} {node.config.condition?.value || '(value)'}
        </div>
      )}
      {runtime?.message && <div className="mt-2 truncate text-[10px] text-text-3">{runtime.message}</div>}
      {/* Run-state indicator */}
      {status === 'running' && (
        <div className="absolute top-1.5 right-1.5">
          <Loader2 size={11} className="animate-spin text-accent" />
        </div>
      )}
      {status === 'success' && (
        <div className="absolute top-1.5 right-1.5">
          <CheckCircle2 size={11} className="text-success" />
        </div>
      )}
      {status === 'failed' && (
        <div className="absolute top-1.5 right-1.5">
          <XCircle size={11} className="text-error" />
        </div>
      )}
    </button>
  )
}

export function FlowInspector({ node, runtime, onCondition }: {
  node: FlowNodeDefinition
  runtime?: RuntimeByNode[string]
  onCondition: (nodeId: string, patch: Partial<FlowCondition>) => void
}) {
  const condition = node.config.condition
  return (
    <div className="rounded-md border border-border-1 bg-surface-0 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-1">{node.label}</span>
        <span className={cn('rounded border px-1.5 py-0.5 text-[10px]', statusTone(runtime?.status ?? 'pending'))}>{runtime?.status ?? 'pending'}</span>
      </div>
      <div className="space-y-2 text-[11px] text-text-3">
        <div><span className="text-text-4">Type:</span> {node.type}</div>
        {node.type === 'request' && (
          <>
            <div><span className="text-text-4">Request:</span> {node.config.request?.name ?? 'Unbound'}</div>
            <div className="break-all"><span className="text-text-4">URL:</span> {node.config.request?.url || 'Missing URL'}</div>
          </>
        )}
        {node.type === 'condition' && condition && (
          <div className="space-y-2">
            <select value={condition.source} onChange={(event) => onCondition(node.id, { source: event.target.value as FlowCondition['source'] })} className="h-8 w-full rounded border border-border-2 bg-surface-2 px-2 text-xs text-text-1">
              <option value="body">response body</option>
              <option value="status">status</option>
              <option value="header">header</option>
              <option value="variable">variable</option>
              <option value="expression">expression</option>
            </select>
            <input value={condition.path} onChange={(event) => onCondition(node.id, { path: event.target.value })} className="h-8 w-full rounded border border-border-2 bg-surface-2 px-2 font-mono text-xs text-text-1" placeholder="active or response.body.active" />
            <div className="grid grid-cols-[1fr_1fr] gap-2">
              <select value={condition.operator} onChange={(event) => onCondition(node.id, { operator: event.target.value as ConditionOperator })} className="h-8 rounded border border-border-2 bg-surface-2 px-2 text-xs text-text-1">
                {conditionOperators().map((op) => <option key={op} value={op}>{op}</option>)}
              </select>
              <input value={condition.value} onChange={(event) => onCondition(node.id, { value: event.target.value })} className="h-8 rounded border border-border-2 bg-surface-2 px-2 font-mono text-xs text-text-1" placeholder="true" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
