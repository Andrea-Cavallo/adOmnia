import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ContextMenuItem {
  id: string
  label: string
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  disabledReason?: string
  submenu?: ContextMenuItem[]
  separatorBefore?: boolean
  /** Icona a sinistra dell'etichetta (lucide o compatibile). */
  icon?: ComponentType<{ size?: number; className?: string }>
  /** Colore semantico dell'icona, es. `text-success` per Run. */
  iconClassName?: string
  /** Opzione attiva: mostra un segno di spunta a destra. */
  checked?: boolean
}

/** `studio`: menu arrotondato con icone e scorciatoie a tasto, usato da Go Studio. */
export type ContextMenuAppearance = 'default' | 'studio'

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onSelect: (id: string) => void
  onClose: () => void
  appearance?: ContextMenuAppearance
}

const MENU_WIDTH = 232
const MENU_MAX_WIDTH = 360
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
  }
  left = Math.max(VIEWPORT_GUTTER, left)
  if (top + height > viewportHeight - VIEWPORT_GUTTER) {
    top = Math.max(VIEWPORT_GUTTER, viewportHeight - height - VIEWPORT_GUTTER)
  }

  return { left, top }
}

export function isContextMenuBackdrop(target: EventTarget | null, currentTarget: EventTarget | null): boolean {
  return target === currentTarget
}

/**
 * Reusable, keyboard-navigable context menu with nested submenus that stays
 * inside the viewport. Used by the Git Sync commit/file menus. Styling matches
 * the existing adOmnia menu (compact, dark, thin borders, purple accent).
 *
 * Keyboard: ↑/↓ move, → open submenu, ← close submenu, Enter activate,
 * Escape close, and disabled items are skipped.
 */
export function ContextMenu({ x, y, items, onSelect, onClose, appearance = 'default' }: ContextMenuProps) {
  // Close when focus leaves the app or the viewport changes. Backdrop clicks
  // are handled by the portal overlay because it covers the full viewport.
  useEffect(() => {
    const onScrollOrResize = () => onClose()
    window.addEventListener('resize', onScrollOrResize)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('resize', onScrollOrResize)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-[300]"
      onPointerDown={(event) => {
        if (isContextMenuBackdrop(event.target, event.currentTarget)) onClose()
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        if (isContextMenuBackdrop(event.target, event.currentTarget)) onClose()
      }}
    >
      <MenuLevel
        items={items}
        x={x}
        y={y}
        depth={0}
        autoFocus
        appearance={appearance}
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
  appearance: ContextMenuAppearance
  onSelect: (id: string) => void
  onClose: () => void
}

function MenuLevel({ items, x, y, depth, autoFocus, appearance, onSelect, onClose }: MenuLevelProps) {
  const studio = appearance === 'studio'
  const hasIcons = items.some((item) => item.icon)
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
        style={{ left: pos?.left ?? x, top: pos?.top ?? y, minWidth: MENU_WIDTH, maxWidth: MENU_MAX_WIDTH, visibility: pos ? 'visible' : 'hidden' }}
        className={studio
          ? 'fixed max-h-[80vh] overflow-y-auto rounded-xl border border-border-2 bg-surface-1 p-1 shadow-[0_18px_48px_-12px_rgb(0_0_0/0.65)] outline-none'
          : 'fixed max-h-[78vh] overflow-y-auto rounded-md border border-border-1 bg-surface-1 py-1 shadow-2xl outline-none'}
      >
        {items.map((it, index) => (
          <div key={it.id} data-mi>
            {it.separatorBefore && <div className={studio ? 'mx-2 my-1 h-px bg-border-1' : 'my-1 h-px bg-border-1/70'} />}
            <button
              role="menuitem"
              type="button"
              title={it.disabled ? it.disabledReason : undefined}
              disabled={it.disabled}
              aria-haspopup={it.submenu?.length ? 'menu' : undefined}
              aria-expanded={it.submenu?.length ? openIndex === index : undefined}
              aria-checked={it.checked === undefined ? undefined : it.checked}
              onMouseEnter={() => { setActive(index); if (it.submenu) setOpenIndex(index); else setOpenIndex(-1) }}
              onClick={() => activate(index)}
              className={studio ? studioItemClass(it, active === index || openIndex === index) : cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
                it.disabled
                  ? 'cursor-not-allowed text-text-4/60'
                  : it.danger
                    ? 'text-error hover:bg-error/10'
                    : 'text-text-2 hover:bg-surface-2 hover:text-text-1',
                active === index && !it.disabled && (it.danger ? 'bg-error/10' : 'bg-surface-2 text-text-1'),
              )}
            >
              {hasIcons && <MenuIcon item={it} studio={studio} />}
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
              {it.checked && <Check size={studio ? 14 : 12} className="shrink-0 text-accent" aria-hidden="true" />}
              {it.shortcut && (studio
                ? <kbd className={cn('shrink-0 rounded-[5px] border border-border-2 bg-surface-0/60 px-1.5 py-px font-mono text-[10.5px] leading-4 text-text-3', it.disabled && 'opacity-40')}>{it.shortcut}</kbd>
                : <span className="shrink-0 font-mono text-[10px] text-text-4">{it.shortcut}</span>)}
              {it.submenu && it.submenu.length > 0 && <ChevronRight size={studio ? 14 : 12} className="shrink-0 opacity-60" />}
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
          appearance={appearance}
          onSelect={onSelect}
          onClose={() => setOpenIndex(-1)}
        />
      )}
    </>
  )
}

function studioItemClass(item: ContextMenuItem, highlighted: boolean): string {
  if (item.disabled) return 'flex h-8 w-full cursor-not-allowed items-center gap-2.5 rounded-lg px-2.5 text-left text-[12.5px] text-text-4/70'
  return cn(
    'flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[12.5px] transition-colors',
    item.danger ? 'text-error' : 'text-text-2',
    highlighted && (item.danger
      ? 'bg-error/10'
      : 'bg-accent/15 text-text-1 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_45%,transparent)]'),
  )
}

/** Colonna icone: resta vuota per le voci senza icona, così le etichette restano allineate. */
function MenuIcon({ item, studio }: { item: ContextMenuItem; studio: boolean }) {
  const Icon = item.icon
  if (!Icon) return <span className={studio ? 'w-4 shrink-0' : 'w-3.5 shrink-0'} aria-hidden="true" />
  const tone = item.disabled ? 'opacity-50' : item.iconClassName ?? 'text-text-3'
  return <span className={cn('grid shrink-0 place-items-center', studio ? 'w-4' : 'w-3.5', tone)} aria-hidden="true"><Icon size={studio ? 15 : 13} /></span>
}
