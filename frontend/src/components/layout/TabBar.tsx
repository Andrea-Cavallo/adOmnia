import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Plus, X, ChevronRight, ChevronLeft, Copy, Pencil } from 'lucide-react'
import type { Tab } from '@/lib/types'
import type { TabDropPosition } from '@/stores/tabs'
import { cn } from '@/lib/utils'

interface TabBarProps {
  tabs: Tab[]
  activeTabId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onCloseToRight: (id: string) => void
  onCloseToLeft: (id: string) => void
  onCloseAll: (id: string) => void
  onReorder: (fromId: string, toId: string, position: TabDropPosition) => void
  onNewTab: () => void
  onDuplicate: (id: string) => void
  onRenameTab: (id: string, name: string) => void
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
const MENU_H = 290

function clampToViewport(x: number, y: number): { left: number; top: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  return {
    left: Math.max(4, Math.min(x, vw - MENU_W - 4)),
    top: Math.max(4, Math.min(y, vh - MENU_H - 4)),
  }
}

export function TabBar({ tabs, activeTabId, onSelect, onClose, onCloseToRight, onCloseToLeft, onCloseAll, onReorder, onNewTab, onDuplicate, onRenameTab }: TabBarProps) {
  const [ctx, setCtx] = useState<ContextMenuState>({ open: false, x: 0, y: 0, tabId: '' })
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ tabId: string; position: TabDropPosition } | null>(null)
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const draggingTabRef = useRef<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState({ left: false, right: false })

  const updateOverflow = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const left = el.scrollLeft > 1
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    setOverflow((o) => (o.left === left && o.right === right ? o : { left, right }))
  }, [])

  const scrollTabs = useCallback((dir: -1 | 1) => {
    scrollRef.current?.scrollBy({ left: dir * 220, behavior: 'smooth' })
  }, [])

  const closeCtx = useCallback(() => setCtx((s) => ({ ...s, open: false })), [])
  const clearDrag = useCallback(() => {
    draggingTabRef.current = null
    setDraggingTabId(null)
    setDropTarget(null)
  }, [])

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

  useEffect(() => {
    if (renamingTabId) renameInputRef.current?.select()
  }, [renamingTabId])

  useEffect(() => {
    updateOverflow()
    window.addEventListener('resize', updateOverflow)
    return () => window.removeEventListener('resize', updateOverflow)
  }, [tabs.length, updateOverflow])

  useEffect(() => {
    if (!activeTabId) return
    const node = scrollRef.current?.querySelector(`[data-tab-id="${activeTabId}"]`) as HTMLElement | null
    node?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeTabId])

  const startRename = useCallback((tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId)
    if (!tab) return
    setRenameValue(tab.request.name || '')
    setRenamingTabId(tabId)
  }, [tabs])

  const commitRename = useCallback(() => {
    if (renamingTabId && renameValue.trim()) onRenameTab(renamingTabId, renameValue.trim())
    setRenamingTabId(null)
  }, [renamingTabId, renameValue, onRenameTab])

  const ctxTabIdx = tabs.findIndex((t) => t.id === ctx.tabId)
  const pos = clampToViewport(ctx.x, ctx.y)

  return (
    <div className="flex h-[30px] items-center border-b border-border-1 px-1.5">
      {overflow.left && (
        <button
          onClick={() => scrollTabs(-1)}
          title="Scroll tabs left"
          className="mr-0.5 flex h-6 w-5 shrink-0 items-center justify-center rounded text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
        >
          <ChevronLeft size={13} />
        </button>
      )}
      <div ref={scrollRef} onScroll={updateOverflow} className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto no-scrollbar">
      {tabs.map((tab) => {
        const isActive = activeTabId === tab.id
        return (
          <div
            key={tab.id}
            data-tab-id={tab.id}
            draggable
            onClick={() => onSelect(tab.id)}
            onContextMenu={(e) => {
              e.preventDefault()
              setCtx({ open: true, x: e.clientX, y: e.clientY, tabId: tab.id })
            }}
            onDragStart={(e) => {
              e.stopPropagation()
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('application/x-adomnia-tab', tab.id)
              draggingTabRef.current = tab.id
              setDraggingTabId(tab.id)
              closeCtx()
            }}
            onDragOver={(e) => {
              const sourceId = draggingTabRef.current || draggingTabId
              if (!sourceId || sourceId === tab.id) return
              e.preventDefault()
              e.stopPropagation()
              e.dataTransfer.dropEffect = 'move'
              const rect = e.currentTarget.getBoundingClientRect()
              const position: TabDropPosition = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
              setDropTarget({ tabId: tab.id, position })
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              const sourceId = draggingTabRef.current || draggingTabId || e.dataTransfer.getData('application/x-adomnia-tab')
              if (sourceId && sourceId !== tab.id) {
                const rect = e.currentTarget.getBoundingClientRect()
                const position: TabDropPosition = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
                onReorder(sourceId, tab.id, position)
              }
              clearDrag()
            }}
            onDragEnd={clearDrag}
            className={cn(
              'relative flex h-[28px] items-center gap-1.5 rounded-t px-2 text-[11px] cursor-pointer group min-w-[74px] max-w-[180px] shrink-0 border-b-2 transition-colors',
              isActive
                ? 'bg-surface-2 border-b-accent text-text-1'
                : 'hover:bg-surface-2/60 border-b-transparent text-text-3 hover:text-text-2',
              draggingTabId === tab.id && 'opacity-45',
            )}
          >
            {dropTarget?.tabId === tab.id && dropTarget.position === 'before' && (
              <span className="absolute -left-[2px] inset-y-1 w-[2px] rounded bg-accent" />
            )}
            <span className={cn('text-[9px] font-bold shrink-0', METHOD_COLORS[tab.request.method] ?? 'text-text-3')}>
              {tab.request.method}
            </span>
            {renamingTabId === tab.id ? (
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitRename() }
                  if (e.key === 'Escape') { e.preventDefault(); setRenamingTabId(null) }
                }}
                className="min-w-0 flex-1 truncate bg-transparent outline-none border-b border-accent text-xs text-text-1"
              />
            ) : (
              <span className="truncate flex-1">
                {tab.request.name || tab.request.url || 'Untitled'}
              </span>
            )}
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
            {dropTarget?.tabId === tab.id && dropTarget.position === 'after' && (
              <span className="absolute -right-[2px] inset-y-1 w-[2px] rounded bg-accent" />
            )}
          </div>
        )
      })}
      </div>
      {overflow.right && (
        <button
          onClick={() => scrollTabs(1)}
          title="Scroll tabs right"
          className="ml-0.5 flex h-6 w-5 shrink-0 items-center justify-center rounded text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
        >
          <ChevronRight size={13} />
        </button>
      )}
      <button
        onClick={() => onNewTab()}
        title="New tab (Ctrl+N)"
        className="ml-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-4 transition-colors hover:bg-surface-2 hover:text-text-1"
      >
        <Plus size={12} />
      </button>

      {ctx.open && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[200] w-[180px] bg-surface-1 border border-border-2 rounded-lg shadow-2xl py-1 overflow-hidden"
          style={{ left: pos.left, top: pos.top }}
        >
          <div className="px-3 py-1.5 border-b border-border-1 mb-1">
            <span className="text-[9px] font-semibold text-text-4 uppercase tracking-wider">Tab</span>
          </div>
          <button
            onClick={() => { startRename(ctx.tabId); closeCtx() }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-text-1 hover:bg-surface-2 transition-colors text-left"
          >
            <Pencil size={11} className="text-text-3" />
            Rename
          </button>
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
          <button
            onClick={() => { onCloseAll(ctx.tabId); closeCtx() }}
            disabled={tabs.length === 0}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-text-2 hover:bg-surface-2 hover:text-text-1 transition-colors text-left disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <X size={11} className="text-text-3" />
            Close All
          </button>
        </div>
      , document.body)}
    </div>
  )
}
