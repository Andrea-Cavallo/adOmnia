import { Bookmark, GitBranch, History, MoreHorizontal, Search } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { ContextMenu } from '@/components/ui/ContextMenu'
import type { CodeStudioCommandId } from './codeStudioCommands'

const LINKS = [
  { title: 'Find in files', command: 'nav.findInFiles', icon: Search },
  { title: 'Open Project Git', command: 'vcs.gitStudio', icon: GitBranch },
  { title: 'Recent locations', command: 'nav.recentLocations', icon: History },
] as const

export function CodeStudioProjectNavigation({ onCommand, onBookmarks, children }: { onBookmarks?: () => void; onCommand: (id: CodeStudioCommandId) => void; children: ReactNode }) {
  const [menu, setMenu] = useState<{x: number; y: number} | null>(null)
  return (
    <nav className="code-studio-project-navigation" aria-label="Project navigation">
      <span aria-current="page">Files</span>
      <button type="button" aria-label="Bookmarks" title="Bookmarks · Shift+F11" onClick={() => onBookmarks ? onBookmarks() : onCommand('nav.bookmarks')}><Bookmark size={15} /></button>
      <button type="button" aria-label="File navigation actions" title="Search, Git and recent locations" aria-haspopup="menu" aria-expanded={!!menu} onClick={event => {
        const rect = event.currentTarget.getBoundingClientRect()
        setMenu(menu ? null : {x:rect.left,y:rect.bottom+4})
      }}><MoreHorizontal size={15} /></button>
      {children}
      {menu && <ContextMenu appearance="studio" x={menu.x} y={menu.y} items={LINKS.map(({title,command,icon})=>({id:command,label:title,icon}))} onSelect={id=>{setMenu(null);onCommand(id as CodeStudioCommandId)}} onClose={()=>setMenu(null)}/>}
    </nav>
  )
}
