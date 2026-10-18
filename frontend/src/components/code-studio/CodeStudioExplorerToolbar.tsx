import { useState } from 'react'
import { ChevronDown, ChevronsDownUp, FilePlus2, FolderPlus } from 'lucide-react'
import { ContextMenu } from '@/components/ui/ContextMenu'
import type { CodeStudioPathAction } from './codeStudioFileActions'

const FILE_TYPES: Array<{ action: CodeStudioPathAction; label: string }> = [
  { action: 'newGoFile', label: 'Go File' },
  { action: 'newJavaClass', label: 'Java Class' },
  { action: 'newJavaInterface', label: 'Java Interface' },
  { action: 'newJavaEnum', label: 'Java Enum' },
  { action: 'newJavaRecord', label: 'Java Record' },
  { action: 'newJavaPackage', label: 'Java Package' },
  { action: 'newMarkdownFile', label: 'Markdown File' },
  { action: 'newTextFile', label: 'Text File' },
]
const ICON_SIZE = 14
const button = 'code-studio-icon-button h-6 w-6'

/** Azioni dell'intestazione Project, applicate alla cartella selezionata nell'albero. */
export function CodeStudioExplorerToolbar({ folder, onCreate, onCollapse }: { folder: string; onCreate: (action: CodeStudioPathAction) => void; onCollapse: () => void }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const target = folder || 'project root'
  return (
    <div role="toolbar" aria-label="Create files and folders" className="flex items-center">
      <button type="button" aria-label="New file" title={`New file in ${target}`} onClick={() => onCreate('newFile')} className={button}><FilePlus2 size={ICON_SIZE} /></button>
      <button type="button" aria-label="New folder" title={`New folder in ${target}`} onClick={() => onCreate('newFolder')} className={button}><FolderPlus size={ICON_SIZE} /></button>
      <button type="button" aria-label="New from template" title={`More file types in ${target}`} aria-haspopup="menu" aria-expanded={!!menu} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setMenu({ x: rect.left, y: rect.bottom + 4 }) }} className={`${button} w-4`}><ChevronDown size={12} /></button>
      <button type="button" aria-label="Collapse all folders" title="Collapse all folders" onClick={onCollapse} className={button}><ChevronsDownUp size={ICON_SIZE} /></button>
      {menu && <ContextMenu appearance="studio" x={menu.x} y={menu.y} items={FILE_TYPES.map((type) => ({ id: type.action, label: type.label }))} onSelect={(id) => { setMenu(null); onCreate(id as CodeStudioPathAction) }} onClose={() => setMenu(null)} />}
    </div>
  )
}
