import { forwardRef, type ReactNode } from 'react'
import { ChevronRight, FileText, Folder, Pencil, Search, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MarkdownFileEntry } from '@/lib/markdown-api'
import type { MarkdownTreeNode } from '@/lib/markdownDoc'

interface MarkdownFileTreeProps {
  activeFile: MarkdownFileEntry | null
  expandedDirs: Set<string>
  query: string
  renamingPath: string
  renameValue: string
  root: string
  tree: MarkdownTreeNode[]
  onCommitRename: () => void
  onDeleteNote: (file: MarkdownFileEntry) => void
  onOpenFile: (file: MarkdownFileEntry) => void
  onQueryChange: (value: string) => void
  onRenameValueChange: (value: string) => void
  onStartRename: (file: MarkdownFileEntry) => void
  onToggleDir: (relPath: string) => void
  onCancelRename: () => void
}

export const MarkdownFileTree = forwardRef<HTMLInputElement, MarkdownFileTreeProps>(function MarkdownFileTree({
  activeFile,
  expandedDirs,
  query,
  renamingPath,
  renameValue,
  root,
  tree,
  onCommitRename,
  onDeleteNote,
  onOpenFile,
  onQueryChange,
  onRenameValueChange,
  onStartRename,
  onToggleDir,
  onCancelRename,
}, ref) {
  const renderTreeNode = (node: MarkdownTreeNode, depth = 0): ReactNode => {
    const isDir = !node.file
    const expanded = expandedDirs.has(node.relPath)
    if (isDir) {
      return (
        <div key={node.relPath || node.name}>
          <button
            onClick={() => onToggleDir(node.relPath)}
            className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-[11px] text-text-3 hover:bg-surface-1 hover:text-text-1"
            style={{ paddingLeft: 6 + depth * 12 }}
            title={node.relPath}
          >
            <ChevronRight size={12} className={cn('shrink-0 transition-transform', expanded && 'rotate-90')} />
            <Folder size={12} className="shrink-0 text-accent" />
            <span className="min-w-0 flex-1 truncate">{node.name}</span>
          </button>
          {expanded && node.children.map((child) => renderTreeNode(child, depth + 1))}
        </div>
      )
    }

    const file = node.file
    if (!file) return null
    const active = activeFile?.path === file.path
    return (
      <div
        key={file.path}
        className={cn(
          'group flex items-center gap-1 rounded pr-1 transition-colors',
          active ? 'bg-surface-2 text-text-1' : 'text-text-3 hover:bg-surface-1 hover:text-text-1',
        )}
        style={{ paddingLeft: 6 + depth * 12 }}
      >
        <button
          onClick={() => onOpenFile(file)}
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-[11px]"
          title={file.relPath}
        >
          <FileText size={12} className="shrink-0 text-text-4 group-hover:text-accent" />
          {renamingPath === file.relPath ? (
            <input
              value={renameValue}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => onRenameValueChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onCommitRename()
                if (event.key === 'Escape') onCancelRename()
              }}
              className="h-6 min-w-0 flex-1 rounded border border-border-2 bg-surface-0 px-1.5 text-[11px] text-text-1 outline-none focus:border-accent"
              autoFocus
            />
          ) : (
            <span className="min-w-0 flex-1 truncate">{file.name}</span>
          )}
        </button>
        {renamingPath !== file.relPath && (
          <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
            <button onClick={() => onStartRename(file)} className="grid h-5 w-5 place-items-center rounded text-text-4 hover:bg-surface-2 hover:text-text-1" title="Rename note">
              <Pencil size={11} />
            </button>
            <button onClick={() => onDeleteNote(file)} className="grid h-5 w-5 place-items-center rounded text-text-4 hover:bg-danger/15 hover:text-danger" title="Delete note">
              <Trash2 size={11} />
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <aside className="w-48 shrink-0 border-r border-border-1 bg-surface-0 flex flex-col min-h-0 lg:w-56 xl:w-60">
      <div className="p-2 border-b border-border-1">
        <div className="flex items-center gap-1.5 rounded border border-border-2 bg-surface-1 px-2 h-7">
          <Search size={12} className="text-text-4" />
          <input
            ref={ref}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[11px] text-text-2 outline-none placeholder:text-text-4"
            placeholder="Quick open..."
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-1.5">
        {tree.length === 0 ? (
          <div className="px-2 py-4 text-[11px] leading-relaxed text-text-4">
            {root ? 'No markdown notes found.' : 'Open a folder or create a note.'}
          </div>
        ) : tree.map((node) => renderTreeNode(node))}
      </div>
    </aside>
  )
})
