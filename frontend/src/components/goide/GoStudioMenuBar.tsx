import { useState } from 'react'
import { History, Menu } from 'lucide-react'
import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu'
import { useAppIcon } from '@/lib/brandAssets'
import { useAppStore } from '@/stores/app'
import type { GoIDERecentProject } from '@/lib/goide-api'
import { GO_STUDIO_COMMANDS, GO_STUDIO_MENUS, commandShortcut, type GoStudioCommandId, type GoStudioMenuId } from './goStudioCommands'
import { GO_STUDIO_COMMAND_ICONS, GO_STUDIO_MENU_ICONS } from './goStudioCommandIcons'

const RECENT_PREFIX = 'recent:'
const MAX_RECENT_ITEMS = 10

export interface GoStudioCommandState {
  /** `true` se eseguibile, altrimenti il motivo mostrato come tooltip. */
  availability: (id: GoStudioCommandId) => true | string
  checked: (id: GoStudioCommandId) => boolean
}

interface GoStudioMenuBarProps {
  state: GoStudioCommandState
  recentProjects: GoIDERecentProject[]
  openProjectPaths: string[]
  onCommand: (id: GoStudioCommandId) => void
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

function menuItems(menu: GoStudioMenuId, state: GoStudioCommandState): ContextMenuItem[] {
  return GO_STUDIO_COMMANDS.filter((command) => command.menu === menu).map((command) => {
    const availability = state.availability(command.id)
    return {
      id: command.id,
      label: command.label,
      icon: GO_STUDIO_COMMAND_ICONS[command.id]?.icon,
      iconClassName: GO_STUDIO_COMMAND_ICONS[command.id]?.tone,
      checked: state.checked(command.id) || undefined,
      shortcut: commandShortcut(command),
      disabled: availability !== true,
      disabledReason: availability === true ? undefined : availability,
      separatorBefore: command.separatorBefore,
    }
  })
}

const MENU_PREFIX = 'menu:'

/** Menu principale compresso nel pulsante ☰, come nella New UI di JetBrains: ogni menu è un sottomenu. */
function mainMenuItems(state: GoStudioCommandState, recentProjects: GoIDERecentProject[], openProjectPaths: string[]): ContextMenuItem[] {
  return GO_STUDIO_MENUS.map((menu) => {
    const base = menuItems(menu.id, state)
    const header = { id: `${MENU_PREFIX}${menu.id}`, label: menu.label, icon: GO_STUDIO_MENU_ICONS[menu.id].icon, iconClassName: GO_STUDIO_MENU_ICONS[menu.id].tone }
    if (menu.id !== 'file') return { ...header, submenu: base }
    const insertAt = base.findIndex((item) => item.id === 'file.save')
    return { ...header, submenu: [...base.slice(0, insertAt), recentSubmenu(recentProjects, openProjectPaths), ...base.slice(insertAt)] }
  })
}

export function GoStudioMenuBar({ state, recentProjects, openProjectPaths, onCommand, onOpenRecent }: GoStudioMenuBarProps) {
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null)
  const appIcon = useAppIcon()

  const select = (id: string) => {
    setOpen(null)
    if (id.startsWith(MENU_PREFIX)) return
    if (id.startsWith(RECENT_PREFIX)) onOpenRecent(id.slice(RECENT_PREFIX.length))
    else onCommand(id as GoStudioCommandId)
  }

  return (
    <>
      {/* Logo adOmnia: torna all'hub principale (la rail e il menu di adOmnia ricompaiono). */}
      <button type="button" onClick={() => useAppStore.getState().setActiveRail('welcome')} title="Back to the adOmnia hub" aria-label="Back to the adOmnia hub" className="go-studio-icon-button go-studio-brand-button h-9 w-9">
        <img src={appIcon} alt="" data-brand-mark className="h-7 w-7 object-contain" />
      </button>
      <button
        type="button"
        aria-label="Main menu"
        title="Main menu: File, Edit, View, Navigate, Code, Go, Run, Tools, Git, Help"
        aria-haspopup="menu"
        aria-expanded={!!open}
        onClick={(event) => {
          if (open) return setOpen(null)
          const rect = event.currentTarget.getBoundingClientRect()
          setOpen({ x: rect.left, y: rect.bottom + 4 })
        }}
        className={`go-studio-icon-button h-8 w-8 ${open ? 'is-active' : ''}`}
      >
        <Menu size={17} strokeWidth={1.8} />
      </button>
      {open && <ContextMenu appearance="studio" x={open.x} y={open.y} items={mainMenuItems(state, recentProjects, openProjectPaths)} onSelect={select} onClose={() => setOpen(null)} />}
    </>
  )
}
