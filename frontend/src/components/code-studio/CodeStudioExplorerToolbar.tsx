import { useState } from 'react'
import { ChevronsDownUp, Plus } from 'lucide-react'
import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu'
import type { CodeStudioPathAction } from './codeStudioFileActions'

const BASE_ITEMS: ContextMenuItem[] = [
  { id: 'newFile', label: 'File…' },
  { id: 'newFolder', label: 'Folder…' },
  { id: 'newGoFile', label: 'Go File…', separatorBefore: true },
  { id: 'newMarkdownFile', label: 'Markdown File…' },
  { id: 'newTextFile', label: 'Text File…' },
]
const JAVA_ITEMS: ContextMenuItem[] = [
  { id: 'newJavaClass', label: 'Java Class…', separatorBefore: true },
  { id: 'newJavaInterface', label: 'Java Interface…' },
  { id: 'newJavaEnum', label: 'Java Enum…' },
  { id: 'newJavaRecord', label: 'Java Record…' },
  { id: 'newJavaPackage', label: 'Java Package…' },
]
const ICON_SIZE = 14
const button = 'code-studio-icon-button h-6 w-6'

/** Azioni dell'intestazione Project, applicate alla cartella selezionata nell'albero. */
export function CodeStudioExplorerToolbar({ folder, hasJava, onCreate, onCollapse }: { folder: string; hasJava: boolean; onCreate: (action: CodeStudioPathAction) => void; onCollapse: () => void }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const target = folder || 'project root'
  return (
    <div role="toolbar" aria-label="Create files and folders" className="flex items-center gap-1">
      <button type="button" aria-label="New" title={`New file or folder in ${target}`} aria-haspopup="menu" aria-expanded={!!menu} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setMenu({ x: rect.left, y: rect.bottom + 4 }) }} className={`${button} ${menu ? 'is-active' : ''}`}><Plus size={ICON_SIZE} /></button>
      <button type="button" aria-label="Collapse all folders" title="Collapse all folders" onClick={onCollapse} className={button}><ChevronsDownUp size={ICON_SIZE} /></button>
      {menu && <ContextMenu appearance="studio" x={menu.x} y={menu.y} items={hasJava ? [...BASE_ITEMS, ...JAVA_ITEMS] : BASE_ITEMS} onSelect={(id) => { setMenu(null); onCreate(id as CodeStudioPathAction) }} onClose={() => setMenu(null)} />}
    </div>
  )
}
