import type { MarkdownFileEntry } from '@/lib/markdown-api'
import type { MarkdownEdge } from '@/lib/markdownDoc'

interface BacklinksPanelProps {
  backlinks: MarkdownEdge[]
  files: MarkdownFileEntry[]
  onOpenFile: (file: MarkdownFileEntry) => void
}

export function BacklinksPanel({ backlinks, files, onOpenFile }: BacklinksPanelProps) {
  return (
    <>
      <div className="px-3 py-2 border-b border-border-1">
        <div className="text-xs font-semibold text-text-2">Backlinks</div>
        <div className="mt-1 text-[10px] text-text-4">{backlinks.length} references to active note</div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {backlinks.length === 0 ? (
          <div className="px-1 py-3 text-[11px] text-text-4">No backlinks for this note.</div>
        ) : backlinks.map((edge, index) => {
          const fromFile = files.find((file) => file.relPath === edge.from)
          return (
            <button
              key={`${edge.from}-${index}`}
              onClick={() => fromFile && onOpenFile(fromFile)}
              className="mb-1 w-full rounded border border-border-2 bg-surface-1 px-2 py-1.5 text-left text-[11px] text-text-3 hover:border-accent/50 hover:text-text-1"
            >
              <span className="block truncate">{edge.from}</span>
              <span className="block truncate text-[10px] text-text-4">{edge.label}</span>
            </button>
          )
        })}
      </div>
    </>
  )
}
