import { useEffect, useRef, useState } from 'react'
import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu'
import type { GoIDERecentProject } from '@/lib/goide-api'
import { GO_STUDIO_COMMANDS, GO_STUDIO_MENUS, formatBinding, type GoStudioCommandId, type GoStudioMenuId } from './goStudioCommands'
import { GoStudioWorkspaceSwitcher } from './GoStudioWorkspaceSwitcher'

const RECENT_PREFIX = 'recent:'
const MAX_RECENT_ITEMS = 10

interface OpenMenu {
  menu: GoStudioMenuId
  x: number
  y: number
}

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
      label: state.checked(command.id) ? `✓  ${command.label}` : command.label,
      shortcut: formatBinding(command.binding),
      disabled: availability !== true,
      disabledReason: availability === true ? undefined : availability,
      separatorBefore: command.separatorBefore,
    }
  })
}

export function GoStudioMenuBar({ state, recentProjects, openProjectPaths, onCommand, onOpenRecent }: GoStudioMenuBarProps) {
  const [open, setOpen] = useState<OpenMenu | null>(null)
  const buttons = useRef<Partial<Record<GoStudioMenuId, HTMLButtonElement | null>>>({})
  const openMenu = (menu: GoStudioMenuId) => {
    const rect = buttons.current[menu]?.getBoundingClientRect()
    if (rect) setOpen({ menu, x: rect.left, y: rect.bottom + 2 })
  }

  // Con un menu aperto il backdrop copre la barra: intercettiamo il puntatore per passare da un menu all'altro.
  useEffect(() => {
    if (!open) return
    const menuAt = (x: number, y: number) => GO_STUDIO_MENUS.find(({ id }) => {
      const rect = buttons.current[id]?.getBoundingClientRect()
      return !!rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    })?.id
    const onMove = (event: PointerEvent) => {
      const menu = menuAt(event.clientX, event.clientY)
      if (menu && menu !== open.menu) openMenu(menu)
    }
    const onDown = (event: PointerEvent) => {
      const menu = menuAt(event.clientX, event.clientY)
      if (!menu) return
      event.preventDefault()
      event.stopPropagation()
      if (menu === open.menu) setOpen(null)
      else openMenu(menu)
    }
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [open])

  const items = (menu: GoStudioMenuId): ContextMenuItem[] => {
    const base = menuItems(menu, state)
    if (menu !== 'file') return base
    const insertAt = base.findIndex((item) => item.id === 'file.save')
    return [...base.slice(0, insertAt), recentSubmenu(recentProjects, openProjectPaths), ...base.slice(insertAt)]
  }

  const select = (id: string) => {
    setOpen(null)
    if (id.startsWith(RECENT_PREFIX)) onOpenRecent(id.slice(RECENT_PREFIX.length))
    else onCommand(id as GoStudioCommandId)
  }

  return (
    <nav aria-label="Go Studio menu" className="flex h-7 shrink-0 items-center gap-0.5 border-b border-border-1 bg-surface-1 px-1.5">
      {/* Identità del mock approvato: all'ingresso "aO" diventa "gO" in 400 ms; con reduced motion resta statico. */}
      <span className="go-studio-mark mr-1.5 select-none px-1 font-mono text-[11px] font-bold text-accent" aria-hidden="true">
        <span className="go-studio-mark-letter"><span className="go-studio-mark-from">a</span><span className="go-studio-mark-to">g</span></span>O
      </span>
      {GO_STUDIO_MENUS.map((menu) => (
        <button
          key={menu.id}
          ref={(element) => { buttons.current[menu.id] = element }}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open?.menu === menu.id}
          onClick={() => (open?.menu === menu.id ? setOpen(null) : openMenu(menu.id))}
          className={`h-6 rounded px-2 text-[11px] transition-colors ${open?.menu === menu.id ? 'bg-accent/15 text-text-1' : 'text-text-2 hover:bg-surface-3 hover:text-text-1'}`}
        >
          {menu.label}
        </button>
      ))}
      <GoStudioWorkspaceSwitcher />
      {open && <ContextMenu x={open.x} y={open.y} items={items(open.menu)} onSelect={select} onClose={() => setOpen(null)} />}
    </nav>
  )
}
