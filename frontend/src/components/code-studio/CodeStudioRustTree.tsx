import { useEffect, useMemo, useState } from 'react'
import { GitFork, Loader2, Search } from 'lucide-react'
import { CodeStudioModal } from './CodeStudioModal'
import { getRustDependencyTree } from '@/lib/code-studio-api'
import type { CargoTreeNode } from '../../../bindings/adomnia/internal/languages/rust/models'

interface TreeRequest {
  sessionId: string
}

let openRequest: ((request: TreeRequest) => void) | null = null

/** Apre l'albero delle dipendenze Rust (Cargo.lock) del progetto. */
export function openRustDependencyTree(sessionId: string): void {
  openRequest?.({ sessionId })
}

/**
 * Cosa il lock risolve davvero (Cargo.lock, offline): le crate presenti in più versioni sono in
 * evidenza, perché è lì che si scopre chi porta una libreria vecchia. La risoluzione esatta
 * (quale versione usa un nome duplicato) arriva solo da `cargo tree`, azione esplicita.
 */
export function CodeStudioRustTree() {
  const [request, setRequest] = useState<TreeRequest | null>(null)
  const [nodes, setNodes] = useState<CargoTreeNode[] | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [duplicatesOnly, setDuplicatesOnly] = useState(false)

  useEffect(() => {
    // Una richiesta più vecchia che risolve per ultima non deve sovrascrivere l'albero corrente.
    let active = 0
    openRequest = (next) => {
      const token = ++active
      setRequest(next)
      setNodes(null)
      setError('')
      setQuery('')
      setDuplicatesOnly(false)
      getRustDependencyTree(next.sessionId)
        .then((tree) => {
          if (token === active) setNodes(tree)
        })
        .catch((reason: unknown) => {
          if (token === active) setError(reason instanceof Error ? reason.message : String(reason))
        })
    }
    return () => {
      active++
      openRequest = null
    }
  }, [])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (nodes ?? []).filter((node) => (!duplicatesOnly || node.status === 'duplicate') && (!needle || `${node.name} ${node.version}`.toLowerCase().includes(needle)))
  }, [nodes, query, duplicatesOnly])
  const duplicates = (nodes ?? []).filter((node) => node.status === 'duplicate').length

  return (
    <CodeStudioModal
      open={!!request}
      onClose={() => setRequest(null)}
      title="Cargo.lock dependency tree"
      subtitle={nodes ? `${nodes.length} crates as the lock resolves them${duplicates ? ` · ${duplicates} duplicate version(s)` : ''}` : error ? 'Cargo.lock could not be read' : 'Reading Cargo.lock…'}
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
          <input data-autofocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by crate or version" className="gs-input flex-1" />
          <label className="flex shrink-0 items-center gap-1 text-[11px] text-text-3">
            <input type="checkbox" checked={duplicatesOnly} onChange={(event) => setDuplicatesOnly(event.target.checked)} /> Duplicates only
          </label>
        </div>
        {!nodes && !error && <p className="flex items-center gap-2 px-3 py-3 text-[11px] text-text-3"><Loader2 size={12} className="animate-spin" /> Reading the lockfile, no cargo run…</p>}
        {error && <p className="whitespace-pre-wrap px-3 py-3 text-[11px] text-danger">{error}</p>}
        <div className="gs-list min-h-0 flex-1 overflow-auto font-mono text-[11.5px]">
          {visible.map((node, position) => (
            <div key={`${position}:${node.name}:${node.version}`} className="gs-list-row" style={{ paddingLeft: 12 + node.depth * 14 }}>
              <span className={`min-w-0 flex-1 truncate ${node.status === 'resolved' ? 'text-text-1' : 'text-text-3'}`}>
                {node.name}:<span className="text-accent">{node.version}</span>
              </span>
              {node.status === 'duplicate' && <span className="gs-badge shrink-0 text-warning">duplicate</span>}
            </div>
          ))}
          {nodes && visible.length === 0 && <p className="px-3 py-3 text-[11px] text-text-3">Nothing matches.</p>}
        </div>
      </div>
    </CodeStudioModal>
  )
}
