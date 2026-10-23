import { useEffect, useMemo, useState } from 'react'
import { withContentKeys } from '@/lib/contentKeys'
import { AlertTriangle, Loader2, Network } from 'lucide-react'
import { CodeStudioModal } from './CodeStudioModal'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { useSpringStore } from '@/stores/codeStudioSpring'
import { BEAN_BOX, buildBeanGraph, edgePath, shortType, type BeanNode } from '@/lib/code-studio/beanGraph'

let openRequest: ((sessionId: string) => void) | null = null

/** Apre il grafo dei bean Spring del progetto. */
export function openSpringBeanGraph(sessionId: string): void {
  openRequest?.(sessionId)
}

const KIND_CLASS: Record<string, string> = {
  controller: 'fill-accent/15 stroke-accent',
  service: 'fill-success/15 stroke-success',
  repository: 'fill-info/15 stroke-info',
  configuration: 'fill-warning/15 stroke-warning',
}

/**
 * I bean dell'applicazione e chi inietta chi, letti dai sorgenti senza avviare Spring: controller a sinistra,
 * repository a destra. Le iniezioni senza bean sono elencate sotto, perché a runtime sono un errore d'avvio.
 */
export function CodeStudioSpringGraph() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const index = useSpringStore((state) => (sessionId ? state.bySession[sessionId]?.index ?? null : null))
  const refreshing = useSpringStore((state) => (sessionId ? state.bySession[sessionId]?.refreshing ?? false : false))

  useEffect(() => {
    openRequest = (id) => {
      setSessionId(id)
      setHovered(null)
      void useSpringStore.getState().refresh(id)
    }
    return () => { openRequest = null }
  }, [])

  const graph = useMemo(() => (index ? buildBeanGraph(index) : null), [index])
  const byId = useMemo(() => new Map((graph?.nodes ?? []).map((node) => [node.id, node])), [graph])
  const related = useMemo(() => {
    const ids = new Set<string>()
    if (hovered) {
      ids.add(hovered)
      for (const edge of graph?.edges ?? []) if (edge.from === hovered || edge.to === hovered) { ids.add(edge.from); ids.add(edge.to) }
    }
    return ids
  }, [graph, hovered])

  const open = (node: BeanNode) => {
    if (!node.bean.file) return
    void useCodeStudioStore.getState().openLocation(node.bean.file, node.bean.line || 1, node.bean.startColumn || 1)
    setSessionId(null)
  }

  return (
    <CodeStudioModal
      open={!!sessionId}
      onClose={() => setSessionId(null)}
      title="Spring bean graph"
      subtitle={graph ? `${graph.nodes.length} bean(s), ${graph.edges.length} injection(s) read from the sources` : undefined}
      icon={Network}
      size="lg"
      tall
      divided
      flush
      top
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {refreshing && !graph && <p className="flex items-center gap-2 px-3 py-3 text-[11px] text-text-3"><Loader2 size={12} className="animate-spin" /> Reading the project…</p>}
        {graph && graph.nodes.length === 0 && <p className="px-3 py-3 text-[11px] text-text-3">No Spring bean found in this project.</p>}
        {graph && graph.nodes.length > 0 && (
          <svg width={graph.width + 24} height={graph.height + 24} viewBox={`-12 -12 ${graph.width + 24} ${graph.height + 24}`} className="shrink-0" role="img" aria-label="Spring beans and their injections">
            {withContentKeys(graph.edges, (edge) => `${edge.from}->${edge.to}`).map(({ key, item: edge }) => {
              const from = byId.get(edge.from)
              const to = byId.get(edge.to)
              if (!from || !to) return null
              const dim = hovered !== null && !(edge.from === hovered || edge.to === hovered)
              return <path key={key} d={edgePath(from, to)} fill="none" className="stroke-text-4" strokeWidth={1.4} opacity={dim ? 0.12 : 0.75} />
            })}
            {graph.nodes.map((node) => {
              const dim = hovered !== null && !related.has(node.id)
              return (
                <g key={node.id} transform={`translate(${node.x} ${node.y})`} opacity={dim ? 0.3 : 1} className="cursor-pointer" onMouseEnter={() => setHovered(node.id)} onMouseLeave={() => setHovered(null)} onClick={() => open(node)}>
                  <rect width={BEAN_BOX.width} height={BEAN_BOX.height} rx={6} className={KIND_CLASS[node.bean.kind] ?? 'fill-surface-2 stroke-border-1'} strokeWidth={1.2} />
                  <text x={10} y={19} className="fill-text-1 text-[12px] font-medium">{shortType(node.bean.type).slice(0, 24)}</text>
                  <text x={10} y={34} className="fill-text-3 text-[10px]">{node.bean.kind}{node.bean.member ? ` · ${node.bean.member}()` : ''}</text>
                </g>
              )
            })}
          </svg>
        )}
        {graph && graph.unresolved.length > 0 && (
          <div className="border-t border-border-1 px-3 py-2">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-warning"><AlertTriangle size={12} /> {graph.unresolved.length} injection(s) without a matching bean</p>
            <ul className="mt-1 space-y-0.5 text-[11px] text-text-3">
              {withContentKeys(graph.unresolved.slice(0, 30), (injection) => `${injection.file ?? ''}:${injection.line}:${injection.class ?? ''}:${injection.type}`).map(({ key, item: injection }) => (
                <li key={key}>
                  <button type="button" className="text-left hover:text-text-1" onClick={() => { if (injection.file) void useCodeStudioStore.getState().openLocation(injection.file, injection.line || 1, injection.startColumn || 1); setSessionId(null) }}>
                    {shortType(injection.class ?? '')} needs <span className="font-mono text-text-2">{injection.type}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </CodeStudioModal>
  )
}
