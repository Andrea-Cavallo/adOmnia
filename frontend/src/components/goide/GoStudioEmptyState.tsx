import { FolderOpen, Plus, ShieldCheck, X } from 'lucide-react'
import type { GoIDERecentProject } from '@/lib/goide-api'

interface GoStudioEmptyStateProps {
  loading: boolean
  recentProjects: GoIDERecentProject[]
  onOpenProject: () => void
  onCreateProject: () => void
  onOpenRecent: (path: string) => void
  onRemoveRecent: (path: string) => void
}

export function GoStudioEmptyState({ loading, recentProjects, onOpenProject, onCreateProject, onOpenRecent, onRemoveRecent }: GoStudioEmptyStateProps) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-xl border border-border-1 bg-surface-1 p-6 shadow-lg">
        <div className="mb-5 flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-md border border-accent/30 bg-accent/10 text-accent">
            <FolderOpen size={18} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-text-1">Open a Go project</h2>
            <p className="mt-0.5 text-[11px] text-text-3">The folder remains in place on this machine.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={onOpenProject} disabled={loading} className="flex h-8 items-center justify-center gap-2 rounded-md bg-accent px-3 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-50"><FolderOpen size={13} /> {loading ? 'Opening…' : 'Open Project…'}</button>
          <button type="button" onClick={onCreateProject} disabled={loading} className="flex h-8 items-center justify-center gap-2 rounded-md border border-border-2 px-3 text-xs font-semibold text-text-2 hover:border-accent hover:text-text-1 disabled:opacity-50"><Plus size={13} /> Create Project…</button>
        </div>
        {recentProjects.length > 0 && <div className="mt-5 border-t border-border-1 pt-3"><p className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-text-4">Recent projects</p>{recentProjects.slice(0, 8).map((project) => <div key={project.realPath} className="group flex items-center"><button type="button" disabled={!project.available || loading} onClick={() => onOpenRecent(project.rootPath)} className="min-w-0 flex-1 rounded px-2 py-1.5 text-left hover:bg-surface-2 disabled:opacity-45"><span className="block truncate text-[11px] font-medium text-text-2">{project.name}</span><span className="block truncate font-mono text-[9px] text-text-4">{project.available ? project.rootPath : 'Folder no longer available'}</span></button><button type="button" onClick={() => onRemoveRecent(project.realPath)} title="Remove from recent projects" className="grid h-6 w-6 place-items-center rounded text-text-4 opacity-0 hover:bg-surface-3 hover:text-text-1 group-hover:opacity-100"><X size={10} /></button></div>)}</div>}
        <div className="mt-4 flex gap-2 border-t border-border-1 pt-4 text-[10px] leading-4 text-text-4">
          <ShieldCheck size={13} className="mt-0.5 shrink-0 text-success" />
          Opening only inspects project metadata. It never runs source code, tests, scripts, or tools.
        </div>
      </div>
    </div>
  )
}
