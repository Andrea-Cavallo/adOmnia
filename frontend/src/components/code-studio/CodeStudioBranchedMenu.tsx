import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import type { ContextMenuItem } from '@/components/ui/ContextMenu'
import './codeStudioBranchedMenu.css'

interface Props {
  items: ContextMenuItem[]
  activeId: string
  x: number
  y: number
  trigger: RefObject<HTMLButtonElement | null>
  onSelect: (id: string) => void
  onClose: (restoreFocus?: boolean) => void
}

export function branchAncestors(items: ContextMenuItem[], id: string): string[] {
  for (const item of items) {
    if (item.id === id) return []
    const nested = item.submenu ? branchAncestors(item.submenu, id) : []
    if (item.submenu?.some(child => child.id === id) || nested.length) return [item.id, ...nested]
  }
  return []
}

/** React adaptation of the user-provided Vue Bits BranchedMenu; existing command data stays intact. */
export function CodeStudioBranchedMenu({ items, activeId, x, y, trigger, onSelect, onClose }: Props) {
  const panel = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(() => new Set(activeId ? branchAncestors(items, activeId) : []))
  const [focused, setFocused] = useState(activeId)
  const toggle = (id: string, expanded?: boolean) => setOpen(previous => {
    const next = new Set(previous)
    if (expanded ?? !next.has(id)) next.add(id); else next.delete(id)
    return next
  })
  useEffect(() => {
    const root = panel.current
    const selected = Array.from(root?.querySelectorAll<HTMLButtonElement>('[role=treeitem]') ?? []).find(element => element.dataset.node === activeId && !element.closest('[inert]'))
    ;(selected ?? root?.querySelector<HTMLButtonElement>('[role=treeitem]'))?.focus()
    const outside = (event: PointerEvent) => { if (!root?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) onClose(false) }
    const leave = (event: FocusEvent) => { if (!root?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) onClose(false) }
    const resize = () => onClose(false)
    document.addEventListener('pointerdown', outside); document.addEventListener('focusin', leave); window.addEventListener('resize', resize)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', leave); window.removeEventListener('resize', resize) }
  // The popup takes focus once; command-state updates must not reset keyboard navigation.
  // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [])

  const onKeyDown = (event: KeyboardEvent) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[role=treeitem]')
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return }
    if (!target) return
    const rows = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('[role=treeitem]') ?? []).filter(element => !element.closest('[inert]'))
    const index = rows.indexOf(target)
    let next: HTMLButtonElement | undefined
    if (event.key === 'ArrowDown') next = rows[Math.min(index + 1, rows.length - 1)]
    else if (event.key === 'ArrowUp') next = rows[Math.max(index - 1, 0)]
    else if (event.key === 'Home') next = rows[0]
    else if (event.key === 'End') next = rows[rows.length - 1]
    else if (event.key === 'ArrowRight' && target.hasAttribute('aria-expanded')) {
      if (!open.has(target.dataset.node!)) toggle(target.dataset.node!, true); else next = rows[index + 1]
    } else if (event.key === 'ArrowLeft') {
      if (open.has(target.dataset.node!)) toggle(target.dataset.node!, false)
      else next = rows.find(element => element.dataset.node === target.dataset.parent)
    } else return
    event.preventDefault(); next?.focus(); next?.scrollIntoView({ block: 'nearest' })
  }

  const render = (nodes: ContextMenuItem[], parent?: string, level = 1) => nodes.map(item => {
    const expanded = open.has(item.id), Icon = item.icon
    const selected = focused === item.id || activeId === item.id
    return <div key={item.id} className={`studio-branch-node ${parent ? 'is-child' : 'is-root'} ${item.separatorBefore ? 'has-separator' : ''}`}>
      {parent && <svg className="studio-branch-curve" viewBox="0 0 28 36" aria-hidden="true"><path d="M 0 0 V 8 Q 0 18 10 18 H 24" /><path className={selected ? 'is-selected' : ''} d="M 0 0 V 8 Q 0 18 10 18 H 24" /></svg>}
      <button type="button" role="treeitem" aria-level={level} aria-expanded={item.submenu ? expanded : undefined} aria-disabled={item.disabled || undefined} aria-current={activeId === item.id ? 'true' : undefined} data-node={item.id} data-parent={parent} data-active={selected || undefined} title={item.disabled ? item.disabledReason : item.label} aria-description={item.disabled ? item.disabledReason : undefined} tabIndex={focused === item.id ? 0 : -1} onFocus={() => setFocused(item.id)} onClick={() => {
        if (item.disabled) return
        if (item.submenu) toggle(item.id); else onSelect(item.id)
      }}>
        {item.iconElement ?? (Icon && <Icon size={15} className="studio-branch-icon" />)}
        <span className="studio-branch-label">{item.label}</span>
        {item.checked && <Check size={13} aria-label="Enabled" />}
        {item.shortcut && <kbd>{item.shortcut}</kbd>}
        {item.submenu && <ChevronDown size={13} className={`studio-branch-chevron ${expanded ? 'is-open' : ''}`} aria-hidden="true" />}
      </button>
      {item.submenu && <div className={`studio-branch-fold ${expanded ? 'is-open' : ''}`} inert={!expanded} aria-hidden={!expanded || undefined}><div><div role="group" className="studio-branch-children">{render(item.submenu, item.id, level + 1)}</div></div></div>}
    </div>
  })

  return createPortal(<div ref={panel} className="studio-branched-menu" style={{ left: Math.max(8, Math.min(x, window.innerWidth - Math.min(440, window.innerWidth - 16) - 8)), top: Math.max(8, Math.min(y, window.innerHeight - 160)), maxHeight: Math.max(120, window.innerHeight - Math.max(8, Math.min(y, window.innerHeight - 160)) - 12) }} onKeyDown={onKeyDown}>
    <div className="studio-branched-caption">Code Studio</div>
    <div role="tree" aria-label="IDE main menu">{render(items)}</div>
  </div>, document.body)
}
