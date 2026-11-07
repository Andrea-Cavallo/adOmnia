import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowLeftRight, Columns2, Columns3, Maximize2, Minimize2, PanelLeftClose, PanelRightClose, X } from 'lucide-react'
import { TitlebarWindowControls, useWindowTitlebar } from '@/components/layout/Titlebar'
import { useWorkspaceFocus } from '@/hooks/useWorkspaceFocus'
import { describeFocus } from '@/lib/workspaceFocus'
import { closeAuxiliary, layoutBack, useWorkspaceLayoutStore } from '@/lib/workspaceLayout'
import { useCodeStudioStore } from '@/stores/codeStudio'
import type { RailItem } from '@/stores/app'

const PANE_NAMES: Partial<Record<RailItem, string>> = { database: 'Database Studio', broker: 'Broker Studio', loginspector: 'Logs' }

export interface SplitViewHeaderProps {
  side: 'code-left' | 'code-right'
  /** Third pane, when one is open beside code and request. */
  auxiliary: RailItem | null
  maximizedPane: RailItem | null
  hiddenPane: RailItem | null
  onReverse: () => void
  onMaximize: (rail: RailItem | null) => void
  onHide: (rail: RailItem | null) => void
  onClose: () => void
}

/** Header of the shared API ↔ code window: layout controls stay in one compact menu. */
export function SplitViewHeader({ side, auxiliary, maximizedPane, hiddenPane, onReverse, onMaximize, onHide, onClose }: SplitViewHeaderProps) {
  const titlebar = useWindowTitlebar()
  const focus = useWorkspaceFocus()
  const stale = !!focus.stale
  const project = useCodeStudioStore((s) => s.sessions.find((session) => session.id === focus.sessionId)?.project.name)
  const summary = [project, describeFocus(focus)].filter(Boolean).join(' · ')
  const back = useWorkspaceLayoutStore((s) => s.history[s.history.length - 1])
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
  const auxName = auxiliary ? PANE_NAMES[auxiliary] ?? auxiliary : ''
  const run = (action: () => void) => { setMenuOpen(false); action() }
  const items = [
    { id: 'reverse', label: side === 'code-left' ? 'Move Code Studio to the Right' : 'Move Code Studio to the Left', icon: ArrowLeftRight, run: onReverse },
    { id: 'max-code', label: maximizedPane === 'codestudio' ? 'Restore Both Panels' : 'Maximize Code Studio', icon: maximizedPane === 'codestudio' ? Minimize2 : Maximize2, run: () => { onHide(null); onMaximize(maximizedPane === 'codestudio' ? null : 'codestudio') } },
    { id: 'max-api', label: maximizedPane === 'collections' ? 'Restore Both Panels' : 'Maximize API Workspace', icon: maximizedPane === 'collections' ? Minimize2 : Maximize2, run: () => { onHide(null); onMaximize(maximizedPane === 'collections' ? null : 'collections') } },
    { id: 'hide-code', label: hidden === 'code' ? 'Show Code Studio' : 'Hide Code Studio', icon: hidden === 'code' ? Columns2 : PanelRightClose, run: () => { onMaximize(null); onHide(hidden === 'code' ? null : 'codestudio') } },
    { id: 'hide-api', label: hidden === 'api' ? 'Show API Workspace' : 'Hide API Workspace', icon: hidden === 'api' ? Columns2 : PanelLeftClose, run: () => { onMaximize(null); onHide(hidden === 'api' ? null : 'collections') } },
    ...(auxiliary ? [
      { id: 'max-aux', label: maximizedPane === auxiliary ? 'Restore All Panels' : `Maximize ${auxName}`, icon: maximizedPane === auxiliary ? Minimize2 : Maximize2, run: () => { onHide(null); onMaximize(maximizedPane === auxiliary ? null : auxiliary) } },
      { id: 'close-aux', label: `Close ${auxName}`, icon: X, run: () => { onMaximize(null); onHide(null); closeAuxiliary() } },
    ] : []),
  ]
  return (
    <div {...titlebar.props} className={`h-10 flex items-center gap-2 pl-3 border-b border-border-1 bg-surface-1 flex-shrink-0 ${titlebar.active ? 'app-titlebar' : 'pr-3'}`}>
      {back && (
        <button type="button" onClick={() => layoutBack()} title={`${back.label} (Alt + ←)`}
          className="flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] text-text-2 transition-colors hover:bg-surface-3 hover:text-text-1">
          <ArrowLeft size={12} aria-hidden="true" />{back.label}
        </button>
      )}
      {auxiliary ? <Columns3 size={13} className="text-accent" aria-hidden="true" /> : <Columns2 size={13} className="text-accent" aria-hidden="true" />}
      <span className="flex-1 truncate px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-2" title={summary || undefined}>
        {summary || `Code Studio ↔ API request${auxiliary ? ` ↔ ${auxName}` : ''}`}
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
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11.5px] text-text-2 hover:bg-surface-3 hover:text-text-1 ${index === 1 || index === 3 || index === 5 ? 'mt-1 border-t border-border-1 pt-2' : ''}`}>
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
