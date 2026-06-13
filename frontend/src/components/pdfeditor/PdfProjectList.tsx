import { FileText, Trash2, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PdfProjectSummary } from '@/lib/pdf/pdfProjects'

interface PdfProjectListProps {
  projects: PdfProjectSummary[]
  activeId: string | null
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onNew: () => void
}

export function PdfProjectList({ projects, activeId, onOpen, onDelete, onNew }: PdfProjectListProps) {
  return (
    <aside className="flex w-56 flex-shrink-0 flex-col border-r border-border-1 bg-surface-1">
      <div className="flex items-center justify-between border-b border-border-1 px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-3">Projects</span>
        <button onClick={onNew} title="Open a PDF" className="grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1">
          <Plus size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-1.5">
        {projects.length === 0 ? (
          <p className="px-2 py-3 text-[11px] leading-relaxed text-text-4">
            No saved projects. Open a PDF to start, then Save to keep it here.
          </p>
        ) : (
          projects.map((p) => {
            const active = p.id === activeId
            return (
              <div
                key={p.id}
                className={cn(
                  'group mb-0.5 flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                  active ? 'bg-accent/10 text-text-1' : 'text-text-3 hover:bg-surface-2 hover:text-text-1',
                )}
              >
                <button onClick={() => onOpen(p.id)} className="flex min-w-0 flex-1 items-center gap-2">
                  <FileText size={13} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-[12px]">{p.name}</span>
                  <span className="shrink-0 text-[10px] text-text-4">{p.pageCount}p</span>
                </button>
                <button
                  onClick={() => onDelete(p.id)}
                  title="Delete project"
                  className="opacity-0 transition-opacity hover:text-error group-hover:opacity-100"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}
