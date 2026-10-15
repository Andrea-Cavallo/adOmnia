import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronUp } from 'lucide-react'

export interface StatusMenuItem {
  id: string
  label: string
  title: string
  icon: ReactNode
  onSelect: () => void
}

interface GoStudioStatusMenuProps {
  label: string
  title: string
  items: readonly StatusMenuItem[]
  className: string
}

/**
 * A status-bar button that opens a small menu above it. The menu is `fixed`, placed from the
 * button's rectangle, so the bar's horizontal scrolling never clips it.
 */
export function GoStudioStatusMenu({ label, title, items, className }: GoStudioStatusMenuProps) {
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const open = anchor !== null

  useEffect(() => {
    if (!open) return
    const close = () => setAnchor(null)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { close(); buttonRef.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const toggle = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    setAnchor(open || !rect ? null : { left: rect.left, bottom: window.innerHeight - rect.top + 4 })
  }

  return (
    <>
      <button ref={buttonRef} type="button" aria-haspopup="menu" aria-expanded={open} onClick={toggle} title={title} className={className}>
        {label}<ChevronUp size={11} aria-hidden="true" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[300]" aria-hidden="true" onMouseDown={() => setAnchor(null)} />
          <div role="menu" aria-label={label} className="fixed z-[301] min-w-44 rounded-md border border-border-2 bg-surface-3 py-1 shadow-xl" style={{ left: anchor.left, bottom: anchor.bottom }}>
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                title={item.title}
                onClick={() => { setAnchor(null); item.onSelect() }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11.5px] text-text-2 hover:bg-surface-4 hover:text-text-1"
              >
                {item.icon}{item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  )
}
