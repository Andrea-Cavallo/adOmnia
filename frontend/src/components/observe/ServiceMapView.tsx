import { useMemo, useState } from 'react'
import { ArrowUpRight, Code2, Database, Globe, Radio, ScrollText, Server } from 'lucide-react'
import { openTraceLogs } from '@/lib/otlp-logs'
import { cn } from '@/lib/utils'
import { layoutLayered, type LayeredBox } from '@/lib/layeredGraph'
import { handoffToPanel } from '@/lib/entities/dispatch'
import { showModule } from '@/lib/moduleRouting'
import type { OtlpMapEdge, OtlpMapNode, OtlpServiceMap } from '@/lib/otlp-api'
import { serviceColor } from './traceStudioModel'
import { openSpanSource } from './openSpanSource'

const BOX: LayeredBox = { width: 168, height: 40, gapX: 36, gapY: 70, padding: 20 }
const KIND_ICON = { service: Server, database: Database, topic: Radio, external: Globe }
const EDGE_LABEL: Record<string, string> = { http: 'HTTP', rpc: 'gRPC', db: 'SQL', messaging: 'MSG' }

function ms(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : value >= 10 ? `${Math.round(value)} ms` : `${value.toFixed(1)} ms`
}

function nodeColor(node: OtlpMapNode): string {
  return node.kind === 'service' ? serviceColor(node.label) : 'var(--color-text-3)'
}

function EdgeDetail({ edge, nodes, onOpenTrace }: { edge: OtlpMapEdge; nodes: Map<string, OtlpMapNode>; onOpenTrace: (traceId: string) => void }) {
  const from = nodes.get(edge.from)
  const to = nodes.get(edge.to)
  const topic = [from, to].find((node) => node?.kind === 'topic')
  const database = [from, to].find((node) => node?.kind === 'database')
  return (
    <div className="space-y-2 text-[11px]">
      <p className="font-semibold text-text-1">{from?.label} → {to?.label}</p>
      <div className="flex flex-wrap gap-1.5 text-[10px]">
        <span className="rounded bg-accent/15 px-1.5 py-0.5 text-accent">{EDGE_LABEL[edge.kind] ?? edge.kind}</span>
        <span className="rounded bg-surface-3 px-1.5 py-0.5 text-text-2">{edge.calls} calls · {edge.ratePerMin.toFixed(1)}/min</span>
        <span className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-text-2">p50 {ms(edge.p50Ms)} · p95 {ms(edge.p95Ms)}</span>
        <span className={cn('rounded px-1.5 py-0.5', edge.errors ? 'bg-error/10 text-error' : 'bg-surface-3 text-text-3')}>{edge.errors} errors ({Math.round((edge.errors / edge.calls) * 100)}%)</span>
        {!!edge.retries && <span title="Calls that repeat an earlier attempt of the same operation" className="rounded bg-warning/10 px-1.5 py-0.5 text-warning">{edge.retries} retries</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {edge.sampleTraceId && <button type="button" onClick={() => onOpenTrace(edge.sampleTraceId!)} className="rounded border border-border-2 px-2 py-1 text-text-2 hover:border-accent hover:text-accent">Open a trace</button>}
        {edge.errorTraceId && <button type="button" onClick={() => onOpenTrace(edge.errorTraceId!)} className="rounded border border-error/40 px-2 py-1 text-error hover:bg-error/10">Open a failing trace</button>}
        {edge.errorTraceId && <button type="button" onClick={() => openTraceLogs(edge.errorTraceId!)} title="Log Inspector filtered on the failing trace id" className="flex items-center gap-1 rounded border border-error/40 px-2 py-1 text-error hover:bg-error/10"><ScrollText size={11} /> Logs of the failure</button>}
        {edge.sourceFile && (
          <button type="button" onClick={() => void openSpanSource(edge.sourceFile!, edge.sourceLine || 1)} title={`${edge.sourceFile}:${edge.sourceLine}`} className="flex items-center gap-1 rounded border border-accent/50 px-2 py-1 text-accent hover:bg-accent/10">
            <Code2 size={11} /> Calling code
          </button>
        )}
        {edge.handlerFile && (
          <button type="button" onClick={() => void openSpanSource(edge.handlerFile!, edge.handlerLine || 1)} title={`${edge.handlerFile}:${edge.handlerLine}`} className="flex items-center gap-1 rounded border border-accent/50 px-2 py-1 text-accent hover:bg-accent/10">
            <Code2 size={11} /> Handler
          </button>
        )}
        {topic && (
          <button type="button" onClick={() => handoffToPanel('broker', { kind: 'topic', id: `topic:${topic.label}`, label: topic.label, attrs: { broker: topic.system ?? 'kafka' } }, 'open')} className="flex items-center gap-1 rounded border border-border-2 px-2 py-1 text-text-2 hover:border-accent hover:text-accent">
            Topic in Broker Studio <ArrowUpRight size={10} />
          </button>
        )}
        {database && (
          <button type="button" onClick={() => showModule('database')} className="flex items-center gap-1 rounded border border-border-2 px-2 py-1 text-text-2 hover:border-accent hover:text-accent">
            Database Studio <ArrowUpRight size={10} />
          </button>
        )}
      </div>
    </div>
  )
}

/** Service Map: who calls whom, as observed in the received traces. */
export function ServiceMapView({ map, onOpenTrace }: { map: OtlpServiceMap | null; onOpenTrace: (traceId: string) => void }) {
  const [selected, setSelected] = useState<string>('')
  const nodes = useMemo(() => new Map((map?.nodes ?? []).map((node) => [node.id, node])), [map])
  const layout = useMemo(() => {
    if (!map) return null
    const weight = new Map<string, number>()
    for (const edge of map.edges) {
      weight.set(edge.from, (weight.get(edge.from) ?? 0) + edge.calls)
      weight.set(edge.to, (weight.get(edge.to) ?? 0) + edge.calls)
    }
    return layoutLayered(map.nodes.map((node) => ({ id: node.id, weight: weight.get(node.id) ?? 0, data: node })), map.edges.map((edge) => ({ from: edge.from, to: edge.to, value: edge.calls })), BOX)
  }, [map])
  if (!map || !layout || !map.nodes.length) {
    return <p className="p-4 text-[11px] text-text-4">The map appears once services export traces: calls between services, to databases, topics and external APIs.</p>
  }
  const edgeKey = (edge: OtlpMapEdge) => `${edge.from}→${edge.to}→${edge.kind}`
  const selectedEdge = map.edges.find((edge) => edgeKey(edge) === selected)
  const position = new Map(layout.nodes.map((node) => [node.id, node]))
  const maxCalls = Math.max(1, ...map.edges.map((edge) => edge.calls))
  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-h-0 min-w-0 flex-[3] overflow-auto">
        <svg width={layout.width} height={layout.height} className="block">
          <defs>
            <marker id="map-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--color-text-4)" /></marker>
          </defs>
          {map.edges.map((edge) => {
            const a = position.get(edge.from)
            const b = position.get(edge.to)
            if (!a || !b) return null
            const x1 = a.x + BOX.width / 2
            const y1 = a.y + BOX.height
            const x2 = b.x + BOX.width / 2
            const y2 = b.y
            const back = y2 <= y1
            const path = back
              ? `M${x1},${a.y} C${x1 + 60},${a.y - 40} ${x2 + 60},${y2 + BOX.height + 40} ${x2},${y2 + BOX.height}`
              : `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`
            const key = edgeKey(edge)
            const failing = edge.errors > 0
            const stroke = failing ? 'var(--color-error)' : key === selected ? 'var(--color-accent)' : 'var(--color-text-4)'
            return (
              <g key={key} className="cursor-pointer" onClick={() => setSelected(key)}>
                <path d={path} fill="none" stroke="transparent" strokeWidth={12} />
                <path d={path} fill="none" stroke={stroke} strokeWidth={1 + (edge.calls / maxCalls) * 3} markerEnd="url(#map-arrow)" opacity={key === selected ? 1 : 0.75} />
                {/* Labels sit near the target end, so siblings leaving the same node do not overlap. */}
                <text x={x1 * 0.3 + x2 * 0.7 + 6} y={back ? (a.y + y2 + BOX.height) / 2 : y1 * 0.3 + y2 * 0.7 - 4} className="fill-[var(--color-text-3)] font-mono text-[9.5px]">
                  {EDGE_LABEL[edge.kind]} {edge.ratePerMin.toFixed(1)}/min · p95 {ms(edge.p95Ms)}{failing ? ` · ${edge.errors} err` : ''}{edge.retries ? ` · ${edge.retries} retry` : ''}
                </text>
              </g>
            )
          })}
          {layout.nodes.map((placed) => {
            const node = placed.data
            const Icon = KIND_ICON[node.kind] ?? Server
            return (
              <foreignObject key={node.id} x={placed.x} y={placed.y} width={BOX.width} height={BOX.height}>
                <div className="flex h-full items-center gap-2 rounded-md border border-border-2 bg-surface-2 px-2 text-[11px] shadow-sm" style={{ borderLeft: `3px solid ${nodeColor(node)}` }} title={node.system ? `${node.label} (${node.system})` : node.label}>
                  <Icon size={13} className="flex-none text-text-3" />
                  <span className="truncate font-medium text-text-1">{node.label}</span>
                </div>
              </foreignObject>
            )
          })}
        </svg>
      </div>
      <div className="min-h-0 w-[300px] min-w-[220px] overflow-y-auto border-l border-border-1 p-3">
        {selectedEdge ? <EdgeDetail edge={selectedEdge} nodes={nodes} onOpenTrace={onOpenTrace} /> : (
          <div className="space-y-1 text-[11px] text-text-3">
            <p className="font-semibold text-text-1">{map.nodes.filter((node) => node.kind === 'service').length} services · {map.edges.length} connections</p>
            <p>Click a connection for its rate, latency and failures, the calling code and the topic or database behind it.</p>
            <p className="text-text-4">Rates over the last {Math.max(1, Math.round(map.windowMs / 60000))} min of received spans.</p>
          </div>
        )}
      </div>
    </div>
  )
}
