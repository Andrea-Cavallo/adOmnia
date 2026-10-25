import { useState } from 'react'

import { showModule } from '@/lib/moduleRouting'
import { History, Menu } from 'lucide-react'
import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu'
import { AppLogo } from '@/components/ui/AppLogo'
import type { GoIDERecentProject } from '@/lib/code-studio-api'
import { CODE_STUDIO_COMMANDS, CODE_STUDIO_MENUS, commandShortcut, type CodeStudioCommandId, type CodeStudioMenuId } from './codeStudioCommands'
import { CODE_STUDIO_COMMAND_ICONS, CODE_STUDIO_MENU_ICONS } from './codeStudioCommandIcons'

const RECENT_PREFIX = 'recent:'
const MAX_RECENT_ITEMS = 10

export interface CodeStudioCommandState {
  /** `true` se eseguibile, altrimenti il motivo mostrato come tooltip. */
  availability: (id: CodeStudioCommandId) => true | string
  checked: (id: CodeStudioCommandId) => boolean
}

interface CodeStudioMenuBarProps {
  state: CodeStudioCommandState
  recentProjects: GoIDERecentProject[]
  openProjectPaths: string[]
  onCommand: (id: CodeStudioCommandId) => void
  onOpenRecent: (path: string) => void
}

function recentSubmenu(recentProjects: GoIDERecentProject[], openProjectPaths: string[]): ContextMenuItem {
  const items = recentProjects.slice(0, MAX_RECENT_ITEMS).map((project) => {
    const alreadyOpen = openProjectPaths.includes(project.realPath)
    return {
      id: `${RECENT_PREFIX}${project.rootPath}`,
      label: alreadyOpen ? `${project.name} (open)` : project.name,
      disabled: !project.available,
      disabledReason: 'Folder no longer available',
    }
  })
  return {
    id: 'file.recent',
    label: 'Open Recent',
    icon: History,
    disabled: items.length === 0,
    disabledReason: 'No recent projects yet',
    submenu: items,
  }
}

function menuItems(menu: CodeStudioMenuId, state: CodeStudioCommandState): ContextMenuItem[] {
  return CODE_STUDIO_COMMANDS.filter((command) => command.menu === menu).map((command) => {
    const availability = state.availability(command.id)
    return {
      id: command.id,
      label: command.label,
      icon: CODE_STUDIO_COMMAND_ICONS[command.id]?.icon,
      iconClassName: CODE_STUDIO_COMMAND_ICONS[command.id]?.tone,
      checked: state.checked(command.id) || undefined,
      shortcut: commandShortcut(command),
      disabled: availability !== true,
      disabledReason: availability === true ? undefined : availability,
      separatorBefore: command.separatorBefore,
    }
  })
}

export function compactFileMenu(items: ContextMenuItem[]): ContextMenuItem[] {
  const groups = [
    {id:'file.saveOptions',label:'Save options',ids:['file.autoSave','file.trimWhitespace'],icon:CODE_STUDIO_COMMAND_ICONS['file.save']?.icon},
    {id:'file.editorTabs',label:'Editor tabs',ids:['file.closeOthers','file.closeAll','file.pinTab','file.reopenClosed'],icon:CODE_STUDIO_COMMAND_ICONS['file.pinTab']?.icon},
    {id:'file.windows',label:'Project windows',ids:items.filter(item=>item.id.startsWith('window.')).map(item=>item.id),icon:CODE_STUDIO_COMMAND_ICONS['window.openInNewWindow']?.icon},
  ]
  const included = new Set<string>()
  return items.flatMap(item=>{
    const group = groups.find(candidate=>candidate.ids.includes(item.id))
    if(!group) return [item]
    if(included.has(group.id)) return []
    included.add(group.id)
    return [{id:group.id,label:group.label,icon:group.icon,separatorBefore:item.separatorBefore,submenu:items.filter(child=>group.ids.includes(child.id)).map(child=>({...child,separatorBefore:false}))}]
  })
}

const MENU_PREFIX = 'menu:'

/** Menu principale compresso nel pulsante ☰: ogni menu è un sottomenu. */
function mainMenuItems(state: CodeStudioCommandState, recentProjects: GoIDERecentProject[], openProjectPaths: string[]): ContextMenuItem[] {
  return CODE_STUDIO_MENUS.map((menu) => {
    const base = menu.id === 'file' ? compactFileMenu(menuItems(menu.id, state)) : menuItems(menu.id, state)
    const header = { id: `${MENU_PREFIX}${menu.id}`, label: menu.label, icon: CODE_STUDIO_MENU_ICONS[menu.id].icon, iconClassName: CODE_STUDIO_MENU_ICONS[menu.id].tone }
    if (menu.id !== 'file') return { ...header, submenu: base }
    const insertAt = base.findIndex((item) => item.id === 'file.save')
    return { ...header, submenu: [...base.slice(0, insertAt), recentSubmenu(recentProjects, openProjectPaths), ...base.slice(insertAt)] }
  })
}

export function CodeStudioMenuBar({ state, recentProjects, openProjectPaths, onCommand, onOpenRecent }: CodeStudioMenuBarProps) {
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null)

  const select = (id: string) => {
    setOpen(null)
    if (id.startsWith(MENU_PREFIX)) return
    if (id.startsWith(RECENT_PREFIX)) onOpenRecent(id.slice(RECENT_PREFIX.length))
    else onCommand(id as CodeStudioCommandId)
  }

  return (
    <>
      {/* Logo adOmnia: torna all'hub principale (la rail e il menu di adOmnia ricompaiono). */}
      <button type="button" onClick={() => showModule('welcome')} title="Back to the adOmnia hub" aria-label="Back to the adOmnia hub" className="code-studio-icon-button code-studio-brand-button h-9 w-9">
        <AppLogo decorative className="h-8 w-8 object-contain" />
      </button>
      <button
        type="button"
        aria-label="Main menu"
        title="Main menu: File, Edit, View, Navigate, Code, Go, Java, Run, Tools, Git, Help"
        aria-haspopup="menu"
        aria-expanded={!!open}
        onClick={(event) => {
          if (open) return setOpen(null)
          const rect = event.currentTarget.getBoundingClientRect()
          setOpen({ x: rect.left, y: rect.bottom + 4 })
        }}
        className={`code-studio-icon-button h-8 w-8 ${open ? 'is-active' : ''}`}
      >
        <Menu size={17} strokeWidth={1.8} />
      </button>
      {open && <ContextMenu appearance="studio" compact x={open.x} y={open.y} items={mainMenuItems(state, recentProjects, openProjectPaths)} onSelect={select} onClose={() => setOpen(null)} />}
    </>
  )
}
