import { useEffect, useMemo, useState } from 'react'
import { GitFork, Loader2, Search } from 'lucide-react'
import { CodeStudioModal } from './CodeStudioModal'
import { getJavaDependencyTree } from '@/lib/code-studio-api'
import type { TreeNode } from '../../../bindings/adomnia/internal/languages/java/models'

interface TreeRequest {
  sessionId: string
  module: string
}

let openRequest: ((request: TreeRequest) => void) | null = null

/** Apre l'albero delle dipendenze Maven di un modulo (cartella relativa al progetto). */
export function openJavaDependencyTree(sessionId: string, module: string): void {
  openRequest?.({ sessionId, module })
}

const BADGES: Record<string, { text: string; className: string }> = {
  omittedDuplicate: { text: 'duplicate', className: 'text-text-4' },
  omittedConflict: { text: 'conflict', className: 'text-warning' },
}

/**
 * Cosa il build risolve davvero (mvn dependency:tree): le versioni scartate per conflitto sono in evidenza,
 * perché è lì che si scopre chi porta una libreria vecchia.
 */
export function CodeStudioJavaTree() {
  const [request, setRequest] = useState<TreeRequest | null>(null)
  const [nodes, setNodes] = useState<TreeNode[] | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [conflictsOnly, setConflictsOnly] = useState(false)

  useEffect(() => {
    openRequest = (next) => {
      setRequest(next)
      setNodes(null)
      setError('')
      setQuery('')
      setConflictsOnly(false)
      getJavaDependencyTree(next.sessionId, next.module)
        .then(setNodes)
        .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
    }
    return () => { openRequest = null }
  }, [])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (nodes ?? []).filter((node) => (!conflictsOnly || node.status === 'omittedConflict') && (!needle || `${node.groupId}:${node.artifactId}:${node.version}`.toLowerCase().includes(needle)))
  }, [nodes, query, conflictsOnly])
  const conflicts = (nodes ?? []).filter((node) => node.status === 'omittedConflict').length

  return (
    <CodeStudioModal
      open={!!request}
      onClose={() => setRequest(null)}
      title="Maven dependency tree"
      subtitle={nodes ? `${nodes.length - 1} dependencies as the build resolves them${conflicts ? ` · ${conflicts} version conflict(s)` : ''}` : 'Running mvn dependency:tree…'}
      icon={GitFork}
      size="lg"
      tall
      divided
      flush
      top
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border-1 px-3 py-2">
          <Search size={14} className="text-text-3" />
          <input data-autofocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by group, artifact or version" className="gs-input flex-1" />
          <label className="flex shrink-0 items-center gap-1 text-[11px] text-text-3">
            <input type="checkbox" checked={conflictsOnly} onChange={(event) => setConflictsOnly(event.target.checked)} /> Conflicts only
          </label>
        </div>
        {!nodes && !error && <p className="flex items-center gap-2 px-3 py-3 text-[11px] text-text-3"><Loader2 size={12} className="animate-spin" /> Maven may download its dependency plugin the first time…</p>}
        {error && <p className="whitespace-pre-wrap px-3 py-3 text-[11px] text-danger">{error}</p>}
        <div className="gs-list min-h-0 flex-1 overflow-auto font-mono text-[11.5px]">
          {visible.map((node, position) => {
            const badge = BADGES[node.status]
            return (
              <div key={`${position}:${node.groupId}:${node.artifactId}`} className="gs-list-row" style={{ paddingLeft: 12 + node.depth * 14 }}>
                <span className={`min-w-0 flex-1 truncate ${node.status === 'resolved' ? 'text-text-1' : 'text-text-3'}`}>
                  {node.groupId}:{node.artifactId}:<span className="text-accent">{node.version}</span>
                  {node.classifier ? `:${node.classifier}` : ''}
                </span>
                {node.conflictWith && <span className="shrink-0 text-[10.5px] text-warning">lost to {node.conflictWith}</span>}
                {node.managedFrom && <span className="shrink-0 text-[10.5px] text-text-4">managed from {node.managedFrom}</span>}
                {node.scope && <span className="gs-badge shrink-0">{node.scope}</span>}
                {badge && <span className={`shrink-0 text-[10.5px] ${badge.className}`}>{badge.text}</span>}
              </div>
            )
          })}
          {nodes && visible.length === 0 && <p className="px-3 py-3 text-[11px] text-text-3">Nothing matches.</p>}
        </div>
      </div>
    </CodeStudioModal>
  )
}
