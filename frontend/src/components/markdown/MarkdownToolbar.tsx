import { Bold, Code, Columns, Eye, FilePlus, FolderOpen, Heading, Image, Italic, Link, Save, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MarkdownFileEntry } from '@/lib/markdown-api'
import type { MarkdownViewMode } from '@/lib/markdownDoc'

interface MarkdownToolbarProps {
  activeFile: MarkdownFileEntry | null
  contentStatus: string
  dirty: boolean
  mode: MarkdownViewMode
  onOpenFolder: () => void
  onImportFolder: () => void
  onToggleCreate: () => void
  onSave: () => void
  onSaveAs: () => void
  onInsert: (wrapper: (selected: string) => string) => void
  onModeChange: (mode: MarkdownViewMode) => void
}

export function MarkdownToolbar({
  activeFile,
  contentStatus,
  dirty,
  mode,
  onOpenFolder,
  onImportFolder,
  onToggleCreate,
  onSave,
  onSaveAs,
  onInsert,
  onModeChange,
}: MarkdownToolbarProps) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto px-3 py-2 border-b border-border-1 bg-surface-1 flex-shrink-0 no-scrollbar">
      <button onClick={onOpenFolder} className="h-7 px-2 flex items-center gap-1.5 text-[11px] text-text-2 hover:text-text-1 rounded hover:bg-surface-2 transition-colors" title="Open Markdown folder"><FolderOpen size={13} /> Open</button>
      <button onClick={onImportFolder} className="h-7 px-2 flex items-center gap-1.5 text-[11px] text-text-2 hover:text-text-1 rounded hover:bg-surface-2 transition-colors" title="Copy a Markdown folder into adOmnia workspace"><Upload size={13} /> Import</button>
      <button onClick={onToggleCreate} className="h-7 px-2 flex items-center gap-1.5 text-[11px] text-text-2 hover:text-text-1 rounded hover:bg-surface-2 transition-colors" title="New Markdown note"><FilePlus size={13} /> New</button>
      <button onClick={onSave} disabled={!activeFile || !dirty} className={cn('h-7 px-2 flex items-center gap-1.5 text-[11px] rounded transition-colors', activeFile && dirty ? 'text-accent hover:bg-surface-2' : 'text-text-4 opacity-60')} title="Save Markdown note"><Save size={13} /> Save</button>
      <button onClick={onSaveAs} className="h-7 px-2 flex items-center gap-1.5 text-[11px] text-text-2 hover:text-text-1 rounded hover:bg-surface-2 transition-colors" title="Save Markdown note as"><Save size={13} /> As</button>

      <div className="w-px h-4 bg-border-1 mx-1" />
      <button onClick={() => onInsert((s) => s ? `**${s}**` : '**bold**')} className="w-6 h-6 flex items-center justify-center text-text-3 hover:text-text-1 rounded hover:bg-surface-2 transition-colors" title="Bold"><Bold size={13} /></button>
      <button onClick={() => onInsert((s) => s ? `*${s}*` : '*italic*')} className="w-6 h-6 flex items-center justify-center text-text-3 hover:text-text-1 rounded hover:bg-surface-2 transition-colors" title="Italic"><Italic size={13} /></button>
      <button onClick={() => onInsert((s) => s ? `\`${s}\`` : '`code`')} className="w-6 h-6 flex items-center justify-center text-text-3 hover:text-text-1 rounded hover:bg-surface-2 transition-colors" title="Inline code"><Code size={13} /></button>
      <button onClick={() => onInsert((s) => s ? `[${s}](note.md)` : '[text](note.md)')} className="w-6 h-6 flex items-center justify-center text-text-3 hover:text-text-1 rounded hover:bg-surface-2 transition-colors" title="Link"><Link size={13} /></button>
      <button onClick={() => onInsert((s) => s ? `![${s}](image.png)` : '![alt](image.png)')} className="w-6 h-6 flex items-center justify-center text-text-3 hover:text-text-1 rounded hover:bg-surface-2 transition-colors" title="Image"><Image size={13} /></button>
      <button onClick={() => onInsert((s) => s ? `## ${s}` : '## Heading')} className="w-6 h-6 flex items-center justify-center text-text-3 hover:text-text-1 rounded hover:bg-surface-2 transition-colors" title="Heading"><Heading size={13} /></button>
      <button onClick={() => onInsert(() => '```\n\n```')} className="w-6 h-6 flex items-center justify-center text-text-3 hover:text-text-1 rounded hover:bg-surface-2 transition-colors font-mono text-[9px]" title="Code block">{'{ }'}</button>

      <div className="min-w-[160px] flex-1 truncate px-2 text-[11px] text-text-4">{contentStatus}{dirty ? ' - unsaved' : ''}</div>

      <div className="flex items-center gap-0.5 bg-surface-2 rounded p-0.5">
        <button onClick={() => onModeChange('edit')} className={cn('px-2 py-0.5 text-[10px] rounded transition-colors', mode === 'edit' ? 'bg-surface-3 text-text-1' : 'text-text-4 hover:text-text-2')} title="Edit only">Edit</button>
        <button onClick={() => onModeChange('split')} className={cn('px-2 py-0.5 text-[10px] rounded transition-colors', mode === 'split' ? 'bg-surface-3 text-text-1' : 'text-text-4 hover:text-text-2')} title="Split view"><Columns size={11} /></button>
        <button onClick={() => onModeChange('preview')} className={cn('px-2 py-0.5 text-[10px] rounded transition-colors', mode === 'preview' ? 'bg-surface-3 text-text-1' : 'text-text-4 hover:text-text-2')} title="Preview only"><Eye size={11} /></button>
      </div>
    </div>
  )
}
