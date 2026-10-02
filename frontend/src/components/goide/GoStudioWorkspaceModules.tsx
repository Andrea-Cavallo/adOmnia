import { useEffect, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import * as GoIDEBindings from '../../../bindings/adomnia/goide'
import type { WorkspaceModule } from '../../../bindings/adomnia/internal/goide/models'

/** Moduli che dipendono da un modulo (archi inversi), per vedere l'impatto di una modifica. */
export function workspaceDependents(modules: readonly WorkspaceModule[]): Map<string, string[]> {
  const dependents = new Map<string, string[]>()
  for (const module of modules) {
    for (const required of module.requires ?? []) dependents.set(required, [...(dependents.get(required) ?? []), module.modulePath])
  }
  return dependents
}

/** Grafo tra i moduli del progetto (multi-modulo o go.work), letto dai go.mod senza processi. */
export function GoStudioWorkspaceModules({ sessionId, onSelect }: { sessionId: string; onSelect: (directory: string) => void }) {
  const [modules, setModules] = useState<WorkspaceModule[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    GoIDEBindings.WorkspaceModuleGraph(sessionId)
      .then((value) => { if (!cancelled) setModules(value) })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { cancelled = true }
  }, [sessionId])
  if (error) return <div className="gs-list-empty text-danger">{error}</div>
  if (!modules) return <div className="gs-list-empty">Reading go.mod files…</div>
  const dependents = workspaceDependents(modules)
  return (
    <div className="gs-list min-h-0 flex-1">
      {modules.map((module) => (
        <div key={module.modulePath || module.directory} className="flex flex-col gap-1 border-b border-border-1 px-3 py-2 text-[12px] last:border-b-0">
          <button type="button" onClick={() => onSelect(module.directory)} className="self-start font-mono text-[12.5px] font-medium text-text-1 hover:text-accent" title="Show this module's requirements">
            {module.modulePath || module.directory} <span className="font-sans text-[11px] font-normal text-text-4">{module.directory || '.'}</span>
          </button>
          {module.error && <span className="text-[11px] text-danger">{module.error}</span>}
          {(module.requires ?? []).map((required) => (
            <span key={required} className="flex items-center gap-1.5 pl-3 text-text-3">
              <ArrowRight size={12} aria-hidden="true" /><span className="font-mono text-[11.5px]">{required}</span>
              {module.replaced?.includes(required) && <span className="gs-badge h-[16px] text-[10px]">local replace</span>}
            </span>
          ))}
          {(dependents.get(module.modulePath) ?? []).length > 0 && <span className="pl-3 text-[11px] text-text-4">Used by {dependents.get(module.modulePath)!.join(', ')}</span>}
          {!(module.requires ?? []).length && !dependents.get(module.modulePath) && !module.error && <span className="pl-3 text-[11px] text-text-4">Independent of the other project modules.</span>}
        </div>
      ))}
    </div>
  )
}
