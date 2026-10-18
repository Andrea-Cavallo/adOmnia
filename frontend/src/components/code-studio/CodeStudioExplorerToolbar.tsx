import { useState } from 'react'
import { ChevronDown, ChevronsDownUp, FilePlus2, FolderPlus } from 'lucide-react'
import { ContextMenu } from '@/components/ui/ContextMenu'
import type { CodeStudioPathAction } from './codeStudioFileActions'

const FILE_TYPES: Array<{ action: CodeStudioPathAction; label: string; short: string }> = [
  { action: 'newJavaClass', label: 'Java Class', short: 'Java' },
  { action: 'newGoFile', label: 'Go File', short: 'Go' },
  { action: 'newMarkdownFile', label: 'Markdown File', short: 'MD' },
  { action: 'newTextFile', label: 'Text File', short: 'TXT' },
]
const button = 'code-studio-icon-button h-6 w-6 shrink-0 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent'

/** Azioni sempre visibili, applicate alla cartella selezionata nell’albero. */
export function CodeStudioExplorerToolbar({ folder, onCreate, onCollapse }: { folder: string; onCreate: (action: CodeStudioPathAction) => void; onCollapse: () => void }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  return (
    <div className="shrink-0 border-b border-border-1 px-2 pb-2">
      <div role="toolbar" aria-label="Create files and folders" className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-text-4" title={folder || '(project root)'}>{folder || '/'}</span>
        <button type="button" aria-label="New file" title="New file in selected folder" onClick={() => onCreate('newFile')} className={button}><FilePlus2 size={14} /></button>
        <button type="button" aria-label="New folder" title="New folder in selected folder" onClick={() => onCreate('newFolder')} className={button}><FolderPlus size={14} /></button>
        <button type="button" aria-label="New from template" title="More file types" aria-haspopup="menu" aria-expanded={!!menu} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setMenu({ x: rect.left, y: rect.bottom + 4 }) }} className={button}><ChevronDown size={12} /></button>
        <button type="button" aria-label="Collapse all folders" title="Collapse all folders" onClick={onCollapse} className={button}><ChevronsDownUp size={14} /></button>
      </div>
      <div role="group" aria-label="Quick file templates" className="mt-1 flex gap-1">
        {FILE_TYPES.map((type) => <button key={type.action} type="button" aria-label={`New ${type.label}`} title={`New ${type.label} in ${folder || 'project root'}`} onClick={() => onCreate(type.action)} className="flex h-6 min-w-0 flex-1 items-center justify-center gap-1 rounded border border-border-1 text-[10px] text-text-3 hover:bg-surface-3 hover:text-text-1 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"><span className="font-mono">{type.short}</span><span aria-hidden="true" className="text-text-4">+</span></button>)}
      </div>
      {menu && <ContextMenu appearance="studio" x={menu.x} y={menu.y} items={[
        ...FILE_TYPES.map((type) => ({ id: type.action, label: type.label })),
        { id: 'newJavaInterface', label: 'Java Interface' },
        { id: 'newJavaEnum', label: 'Java Enum' },
        { id: 'newJavaRecord', label: 'Java Record' },
        { id: 'newJavaPackage', label: 'Java Package' },
      ]} onSelect={(id) => { setMenu(null); onCreate(id as CodeStudioPathAction) }} onClose={() => setMenu(null)} />}
    </div>
  )
}
