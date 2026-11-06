import { useEffect, useRef, useState } from 'react'
import { ArrowLeftRight, Columns2, Maximize2, Minimize2, PanelLeftClose, PanelRightClose, X } from 'lucide-react'
import { TitlebarWindowControls, useWindowTitlebar } from '@/components/layout/Titlebar'
import { useApiCodeLinkStore } from '@/lib/api-code-link/linkStore'
import type { RailItem } from '@/stores/app'

export interface SplitViewHeaderProps {
  side: 'code-left' | 'code-right'
  maximizedPane: RailItem | null
  hiddenPane: RailItem | null
  onReverse: () => void
  onMaximize: (rail: RailItem | null) => void
  onHide: (rail: RailItem | null) => void
  onClose: () => void
}

/** Header of the shared API ↔ code window: layout controls stay in one compact menu. */
export function SplitViewHeader({ side, maximizedPane, hiddenPane, onReverse, onMaximize, onHide, onClose }: SplitViewHeaderProps) {
  const titlebar = useWindowTitlebar()
  const link = useApiCodeLinkStore((s) => s.link)
  const stale = useApiCodeLinkStore((s) => s.stale)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) { if (event.key === 'Escape') setMenuOpen(false); return }
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close) }
  }, [menuOpen])
  const hidden = hiddenPane === 'codestudio' ? 'code' : hiddenPane === 'collections' ? 'api' : null
  const run = (action: () => void) => { setMenuOpen(false); action() }
  const items = [
    { id: 'reverse', label: side === 'code-left' ? 'Move Code Studio to the Right' : 'Move Code Studio to the Left', icon: ArrowLeftRight, run: onReverse },
    { id: 'max-code', label: maximizedPane === 'codestudio' ? 'Restore Both Panels' : 'Maximize Code Studio', icon: maximizedPane === 'codestudio' ? Minimize2 : Maximize2, run: () => { onHide(null); onMaximize(maximizedPane === 'codestudio' ? null : 'codestudio') } },
    { id: 'max-api', label: maximizedPane === 'collections' ? 'Restore Both Panels' : 'Maximize API Workspace', icon: maximizedPane === 'collections' ? Minimize2 : Maximize2, run: () => { onHide(null); onMaximize(maximizedPane === 'collections' ? null : 'collections') } },
    { id: 'hide-code', label: hidden === 'code' ? 'Show Code Studio' : 'Hide Code Studio', icon: hidden === 'code' ? Columns2 : PanelRightClose, run: () => { onMaximize(null); onHide(hidden === 'code' ? null : 'codestudio') } },
    { id: 'hide-api', label: hidden === 'api' ? 'Show API Workspace' : 'Hide API Workspace', icon: hidden === 'api' ? Columns2 : PanelLeftClose, run: () => { onMaximize(null); onHide(hidden === 'api' ? null : 'collections') } },
  ]
  return (
    <div {...titlebar.props} className={`h-10 flex items-center gap-2 pl-3 border-b border-border-1 bg-surface-1 flex-shrink-0 ${titlebar.active ? 'app-titlebar' : 'pr-3'}`}>
      <Columns2 size={13} className="text-accent" aria-hidden="true" />
      <span className="flex-1 truncate px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-2">
        {link ? `${link.handler || link.path} · ` : ''}Code Studio ↔ API request
      </span>
      {stale && <span title="The linked handler changed. Open the endpoint again to refresh the link." className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-label="Stale link" />}
      {hidden && (
        <button type="button" onClick={() => onHide(null)} title={`Show ${hidden === 'code' ? 'Code Studio' : 'API Workspace'}`}
          className="h-6 shrink-0 rounded px-2 text-[11px] text-accent hover:bg-accent/10">
          Show {hidden === 'code' ? 'Code Studio' : 'API'}
        </button>
      )}
      <div ref={menuRef} className="relative shrink-0">
        <button type="button" aria-haspopup="menu" aria-expanded={menuOpen} title="Split view layout" aria-label="Split view layout"
          onClick={() => setMenuOpen((open) => !open)}
          className="grid h-6 w-6 place-items-center rounded text-text-3 transition-colors hover:bg-surface-3 hover:text-text-1">
          <ArrowLeftRight size={13} />
        </button>
        {menuOpen && (
          <div role="menu" className="absolute right-0 top-full z-50 mt-1 w-56 rounded-md border border-border-2 bg-surface-2 py-1 shadow-lg shadow-black/40">
            {items.map((item, index) => (
              <button key={item.id} type="button" role="menuitem" onClick={() => run(item.run)}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11.5px] text-text-2 hover:bg-surface-3 hover:text-text-1 ${index === 1 || index === 3 ? 'mt-1 border-t border-border-1 pt-2' : ''}`}>
                <item.icon size={12} className="shrink-0 text-text-3" aria-hidden="true" />
                <span className="truncate">{item.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <button onClick={onClose} title="Close split view" aria-label="Close split view"
        className="h-6 w-6 flex items-center justify-center rounded text-text-3 hover:text-text-1 hover:bg-surface-3 transition-colors">
        <X size={12} />
      </button>
      <TitlebarWindowControls />
    </div>
  )
}
