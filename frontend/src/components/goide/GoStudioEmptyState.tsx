import { FolderOpen, ShieldCheck } from 'lucide-react'

interface GoStudioEmptyStateProps {
  loading: boolean
  onOpenProject: () => void
}

export function GoStudioEmptyState({ loading, onOpenProject }: GoStudioEmptyStateProps) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-md border border-border-1 bg-surface-1 p-6 shadow-lg">
        <div className="mb-5 flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-md border border-accent/30 bg-accent/10 text-accent">
            <FolderOpen size={18} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-text-1">Open a Go project</h2>
            <p className="mt-0.5 text-[11px] text-text-3">The folder remains in place on this machine.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenProject}
          disabled={loading}
          className="flex h-8 w-full items-center justify-center gap-2 rounded-md bg-accent px-3 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-50"
        >
          <FolderOpen size={13} /> {loading ? 'Opening…' : 'Open Project…'}
        </button>
        <div className="mt-4 flex gap-2 border-t border-border-1 pt-4 text-[10px] leading-4 text-text-4">
          <ShieldCheck size={13} className="mt-0.5 shrink-0 text-success" />
          Opening only inspects project metadata. It never runs source code, tests, scripts, or tools.
        </div>
      </div>
    </div>
  )
}
