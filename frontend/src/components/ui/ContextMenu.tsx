import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ContextMenuItem {
  id: string
  label: string
  danger?: boolean
  disabled?: boolean
  disabledReason?: string
  submenu?: ContextMenuItem[]
  separatorBefore?: boolean
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onSelect: (id: string) => void
  onClose: () => void
}

const MENU_WIDTH = 232
const VIEWPORT_GUTTER = 8
const SUBMENU_OVERLAP = 1

interface MenuPositionInput {
  x: number
  y: number
  width: number
  height: number
  depth: number
  viewportWidth: number
  viewportHeight: number
}

export function resolveContextMenuPosition(input: MenuPositionInput): { left: number; top: number } {
  const { x, y, width, height, depth, viewportWidth, viewportHeight } = input
  let left = x
  let top = y

  if (left + width > viewportWidth - VIEWPORT_GUTTER) {
    left = depth > 0
      ? x - width - MENU_WIDTH + SUBMENU_OVERLAP
      : viewportWidth - width - VIEWPORT_GUTTER
    if (left < VIEWPORT_GUTTER) left = VIEWPORT_GUTTER
  }
  if (top + height > viewportHeight - VIEWPORT_GUTTER) {
    top = Math.max(VIEWPORT_GUTTER, viewportHeight - height - VIEWPORT_GUTTER)
  }

  return { left, top }
}

/**
 * Reusable, keyboard-navigable context menu with nested submenus that stays
 * inside the viewport. Used by the Git Sync commit/file menus. Styling matches
 * the existing adOmnia menu (compact, dark, thin borders, cyan accent).
 *
 * Keyboard: ↑/↓ move, → open submenu, ← close submenu, Enter activate,
 * Escape close, and disabled items are skipped.
 */
export function ContextMenu({ x, y, items, onSelect, onClose }: ContextMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null)

  // Close on outside click / scroll / resize.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose()
    }
    const onScrollOrResize = () => onClose()
    document.addEventListener('mousedown', onDown)
    window.addEventListener('resize', onScrollOrResize)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('resize', onScrollOrResize)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return createPortal(
    <div ref={rootRef} className="fixed inset-0 z-[300]" onContextMenu={(e) => e.preventDefault()}>
      <MenuLevel
        items={items}
        x={x}
        y={y}
        depth={0}
        autoFocus
        onSelect={onSelect}
        onClose={onClose}
      />
    </div>,
    document.body,
  )
}

interface MenuLevelProps {
  items: ContextMenuItem[]
  x: number
  y: number
  depth: number
  autoFocus?: boolean
  onSelect: (id: string) => void
  onClose: () => void
}

function MenuLevel({ items, x, y, depth, autoFocus, onSelect, onClose }: MenuLevelProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [active, setActive] = useState<number>(-1)
  const [openIndex, setOpenIndex] = useState<number>(-1)

  // Clamp inside the viewport once measured; flip submenus beside their parent.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPos(resolveContextMenuPosition({
      x,
      y,
      width: rect.width,
      height: rect.height,
      depth,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    }))
  }, [x, y, depth, items])

  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])

  const move = useCallback((dir: 1 | -1) => {
    setActive((current) => {
      const count = items.length
      let next = current
      for (let i = 0; i < count; i++) {
        next = (next + dir + count) % count
        if (!items[next].disabled) return next
      }
      return current
    })
  }, [items])

  const activate = useCallback((index: number) => {
    const it = items[index]
    if (!it || it.disabled) return
    if (it.submenu && it.submenu.length > 0) {
      setOpenIndex((current) => current === index ? -1 : index)
      return
    }
    onSelect(it.id)
  }, [items, onSelect])

  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); move(1); break
      case 'ArrowUp': e.preventDefault(); move(-1); break
      case 'ArrowRight':
        e.preventDefault()
        if (active >= 0 && items[active]?.submenu) setOpenIndex(active)
        break
      case 'ArrowLeft':
        e.preventDefault()
        if (depth > 0) onClose()
        break
      case 'Enter':
        e.preventDefault()
        if (active >= 0) activate(active)
        break
      case 'Escape':
        e.preventDefault()
        onClose()
        break
    }
  }

  const openItem = openIndex >= 0 ? items[openIndex] : null
  const openRect = () => {
    const el = ref.current?.querySelectorAll('[data-mi]')[openIndex] as HTMLElement | undefined
    const r = el?.getBoundingClientRect()
    return r
      ? { x: r.right - SUBMENU_OVERLAP, y: r.top }
      : { x: (pos?.left ?? x) + MENU_WIDTH - SUBMENU_OVERLAP, y: pos?.top ?? y }
  }

  return (
    <>
      <div
        ref={ref}
        role="menu"
        aria-label={depth === 0 ? 'Context menu' : 'Submenu'}
        data-menu-depth={depth}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={{ left: pos?.left ?? x, top: pos?.top ?? y, width: MENU_WIDTH, visibility: pos ? 'visible' : 'hidden' }}
        className="fixed max-h-[78vh] overflow-y-auto rounded-md border border-border-1 bg-surface-1 py-1 shadow-2xl outline-none"
      >
        {items.map((it, index) => (
          <div key={it.id} data-mi>
            {it.separatorBefore && <div className="my-1 h-px bg-border-1/70" />}
            <button
              role="menuitem"
              type="button"
              title={it.disabled ? it.disabledReason : undefined}
              disabled={it.disabled}
              aria-haspopup={it.submenu?.length ? 'menu' : undefined}
              aria-expanded={it.submenu?.length ? openIndex === index : undefined}
              onMouseEnter={() => { setActive(index); if (it.submenu) setOpenIndex(index); else setOpenIndex(-1) }}
              onClick={() => activate(index)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
                it.disabled
                  ? 'cursor-not-allowed text-text-4/60'
                  : it.danger
                    ? 'text-error hover:bg-error/10'
                    : 'text-text-2 hover:bg-surface-2 hover:text-text-1',
                active === index && !it.disabled && (it.danger ? 'bg-error/10' : 'bg-surface-2 text-text-1'),
              )}
            >
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
              {it.submenu && it.submenu.length > 0 && <ChevronRight size={12} className="shrink-0 opacity-60" />}
            </button>
          </div>
        ))}
      </div>

      {openItem?.submenu && (
        <MenuLevel
          items={openItem.submenu}
          x={openRect().x}
          y={openRect().y}
          depth={depth + 1}
          onSelect={onSelect}
          onClose={() => setOpenIndex(-1)}
        />
      )}
    </>
  )
}
