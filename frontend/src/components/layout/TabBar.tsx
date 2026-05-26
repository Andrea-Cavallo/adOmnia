import { useState, useRef, useEffect, useCallback } from 'react'
import { Plus, X, ChevronRight, ChevronLeft, Copy } from 'lucide-react'
import type { Tab } from '@/lib/types'
import { cn } from '@/lib/utils'

interface TabBarProps {
  tabs: Tab[]
  activeTabId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onCloseToRight: (id: string) => void
  onCloseToLeft: (id: string) => void
  onNewTab: () => void
  onDuplicate: (id: string) => void
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-method-get',
  POST: 'text-method-post',
  PUT: 'text-method-put',
  PATCH: 'text-method-patch',
  DELETE: 'text-method-delete',
  HEAD: 'text-method-head',
  OPTIONS: 'text-method-head',
}

interface ContextMenuState {
  open: boolean
  x: number
  y: number
  tabId: string
}

const MENU_W = 180
const MENU_H = 150

function clampToViewport(x: number, y: number): { left: number; top: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  return {
    left: Math.min(x, vw - MENU_W - 4),
    top: Math.min(y, vh - MENU_H - 4),
  }
}

export function TabBar({ tabs, activeTabId, onSelect, onClose, onCloseToRight, onCloseToLeft, onNewTab, onDuplicate }: TabBarProps) {
  const [ctx, setCtx] = useState<ContextMenuState>({ open: false, x: 0, y: 0, tabId: '' })
  const menuRef = useRef<HTMLDivElement>(null)

  const closeCtx = useCallback(() => setCtx((s) => ({ ...s, open: false })), [])

  useEffect(() => {
    if (!ctx.open) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) closeCtx()
    }
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeCtx() }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', keyHandler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', keyHandler)
    }
  }, [ctx.open, closeCtx])

  const ctxTabIdx = tabs.findIndex((t) => t.id === ctx.tabId)
  const pos = clampToViewport(ctx.x, ctx.y)

  return (
    <div className="flex items-center gap-0.5 px-2 py-0.5 border-b border-border-1 overflow-x-auto">
      {tabs.map((tab) => {
        const isActive = activeTabId === tab.id
        return (
          <div
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            onContextMenu={(e) => {
              e.preventDefault()
              setCtx({ open: true, x: e.clientX, y: e.clientY + 4, tabId: tab.id })
            }}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-t cursor-pointer group min-w-[80px] max-w-[200px] shrink-0 border-b-2 transition-colors',
              isActive
                ? 'bg-surface-2 border-b-accent text-text-1'
                : 'hover:bg-surface-2/60 border-b-transparent text-text-3 hover:text-text-2'
            )}
          >
            <span className={cn('text-[9px] font-bold shrink-0', METHOD_COLORS[tab.request.method] ?? 'text-text-3')}>
              {tab.request.method}
            </span>
            <span className="text-xs truncate flex-1">
              {tab.request.name || tab.request.url || 'Untitled'}
            </span>
            {tab.dirty && (
              <span
                className="w-2 h-2 rounded-full bg-warning shrink-0 animate-pulse"
                title="Unsaved changes"
              />
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onClose(tab.id) }}
              className="shrink-0 p-0.5 rounded text-text-4 hover:text-error transition-colors opacity-0 group-hover:opacity-100"
              title="Close tab"
            >
              <X size={10} />
            </button>
          </div>
        )
      })}
      <button
        onClick={() => onNewTab()}
        title="New tab (Ctrl+N)"
        className="shrink-0 w-6 h-6 flex items-center justify-center text-text-4 hover:text-text-1 hover:bg-surface-2 rounded transition-colors ml-0.5"
      >
        <Plus size={12} />
      </button>

      {ctx.open && (
        <div
          ref={menuRef}
          className="fixed z-[200] w-[180px] bg-surface-1 border border-border-2 rounded-lg shadow-2xl py-1 overflow-hidden"
          style={{ left: pos.left, top: pos.top }}
        >
          <div className="px-3 py-1.5 border-b border-border-1 mb-1">
            <span className="text-[9px] font-semibold text-text-4 uppercase tracking-wider">Tab</span>
          </div>
          <button
            onClick={() => { onDuplicate(ctx.tabId); closeCtx() }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-text-1 hover:bg-surface-2 transition-colors text-left"
          >
            <Copy size={11} className="text-text-3" />
            Duplicate
          </button>
          <button
            onClick={() => { onClose(ctx.tabId); closeCtx() }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-text-1 hover:bg-surface-2 transition-colors text-left"
          >
            <X size={11} className="text-text-3" />
            Close
          </button>
          <button
            onClick={() => { onCloseToRight(ctx.tabId); closeCtx() }}
            disabled={ctxTabIdx === tabs.length - 1 || tabs.length <= 1}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-text-2 hover:bg-surface-2 hover:text-text-1 transition-colors text-left disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight size={11} className="text-text-3" />
            Close to the Right
          </button>
          <button
            onClick={() => { onCloseToLeft(ctx.tabId); closeCtx() }}
            disabled={ctxTabIdx === 0 || tabs.length <= 1}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-text-2 hover:bg-surface-2 hover:text-text-1 transition-colors text-left disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={11} className="text-text-3" />
            Close to the Left
          </button>
        </div>
      )}
    </div>
  )
}
