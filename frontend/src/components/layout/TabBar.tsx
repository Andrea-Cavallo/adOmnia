import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import * as Tabs from '@radix-ui/react-tabs'
import { Plus, X, MoreVertical, ChevronRight, ChevronLeft, Copy, Pencil, Server, Pin, PinOff, MonitorUp, Braces, BookOpen } from 'lucide-react'
import type { Tab } from '@/lib/types'
import type { TabDropPosition } from '@/stores/tabs'
import { cn } from '@/lib/utils'
import { useUiTranslation } from '@/lib/uiI18n'
import { ContextMenu } from '@/components/ui/ContextMenu'

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
  onTogglePinned: (id: string) => void
  onRenameTab: (id: string, name: string) => void
  onMockTab: (id: string) => void | Promise<void>
  onDetach: (id: string) => void | Promise<void>
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-method-get',
  QUERY: 'text-info',
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
const MENU_H = 360

// A tab stays usable down to this width: method badge, an ellipsised title,
// the dirty dot and the close button still fit. Below it we stop shrinking and
// move the surplus tabs into the overflow menu instead.
const TAB_MIN_WIDTH = 92
const PINNED_TAB_WIDTH = 52
const TAB_GAP = 4
const OVERFLOW_BUTTON_WIDTH = 32

function clampToViewport(x: number, y: number): { left: number; top: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  return {
    left: Math.max(4, Math.min(x, vw - MENU_W - 4)),
    top: Math.max(4, Math.min(y, vh - MENU_H - 4)),
  }
}

export function TabBar({ tabs, activeTabId, onSelect, onClose, onCloseToRight, onCloseToLeft, onCloseAll, onReorder, onNewTab, onDuplicate, onTogglePinned, onRenameTab, onMockTab, onDetach }: TabBarProps) {
  const tr = useUiTranslation()
  const [ctx, setCtx] = useState<ContextMenuState>({ open: false, x: 0, y: 0, tabId: '' })
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null)
  const [detachArmed, setDetachArmed] = useState(false)
  const [dropTarget, setDropTarget] = useState<{ tabId: string; position: TabDropPosition } | null>(null)
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const draggingTabRef = useRef<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const previousDirtyRef = useRef<Record<string, boolean>>({})
  const [stripWidth, setStripWidth] = useState(0)
  const [overflowMenu, setOverflowMenu] = useState<{ x: number; y: number } | null>(null)
  const [savedFlashTabs, setSavedFlashTabs] = useState<Set<string>>(() => new Set())

  // How many tabs the strip can still render at a readable width. Everything
  // past that goes to the overflow menu instead of scrolling out of sight.
  const { visibleTabs, overflowTabs } = useMemo(() => {
    if (stripWidth <= 0 || tabs.length === 0) return { visibleTabs: tabs, overflowTabs: [] as Tab[] }

    const widthOf = (tab: Tab) => (tab.pinned ? PINNED_TAB_WIDTH : TAB_MIN_WIDTH) + TAB_GAP
    const total = tabs.reduce((sum, tab) => sum + widthOf(tab), 0)
    if (total <= stripWidth) return { visibleTabs: tabs, overflowTabs: [] as Tab[] }

    const budget = stripWidth - OVERFLOW_BUTTON_WIDTH - TAB_GAP
    let used = 0
    const visible: Tab[] = []
    for (const tab of tabs) {
      const next = used + widthOf(tab)
      if (next > budget && visible.length > 0) break
      used = next
      visible.push(tab)
    }
    // The active tab must always be reachable without opening a menu, so it
    // takes the last visible slot when it would otherwise be hidden.
    const activeTab = tabs.find((tab) => tab.id === activeTabId)
    if (activeTab && !visible.includes(activeTab)) {
      visible.pop()
      visible.push(activeTab)
    }
    const visibleIds = new Set(visible.map((tab) => tab.id))
    return { visibleTabs: visible, overflowTabs: tabs.filter((tab) => !visibleIds.has(tab.id)) }
  }, [tabs, stripWidth, activeTabId])

  const closeCtx = useCallback(() => setCtx((s) => ({ ...s, open: false })), [])
  const clearDrag = useCallback(() => {
    draggingTabRef.current = null
    setDraggingTabId(null)
    setDropTarget(null)
    setDetachArmed(false)
  }, [])

  useEffect(() => {
    const updateDetachIntent = (event: DragEvent) => {
      if (!draggingTabRef.current || (event.clientX === 0 && event.clientY === 0)) return
      const outside = event.clientX <= 0 || event.clientY <= 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight
      setDetachArmed(outside)
    }
    const onDocumentDragLeave = (event: DragEvent) => {
      if (!draggingTabRef.current) return
      if (event.clientX <= 0 || event.clientY <= 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight || event.relatedTarget === null) {
        setDetachArmed(true)
      }
    }
    document.addEventListener('dragover', updateDetachIntent)
    document.addEventListener('dragleave', onDocumentDragLeave)
    return () => {
      document.removeEventListener('dragover', updateDetachIntent)
      document.removeEventListener('dragleave', onDocumentDragLeave)
    }
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
    const el = scrollRef.current
    if (!el) return
    const measure = () => setStripWidth((current) => {
      const next = el.clientWidth
      return Math.abs(next - current) < 1 ? current : next
    })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const previous = previousDirtyRef.current
    const next: Record<string, boolean> = {}
    const justSaved = tabs.filter((tab) => previous[tab.id] === true && !tab.dirty).map((tab) => tab.id)
    for (const tab of tabs) next[tab.id] = tab.dirty
    previousDirtyRef.current = next
    if (justSaved.length === 0) return
    setSavedFlashTabs((current) => new Set([...current, ...justSaved]))
    const timer = window.setTimeout(() => {
      setSavedFlashTabs((current) => {
        const updated = new Set(current)
        justSaved.forEach((id) => updated.delete(id))
        return updated
      })
    }, 720)
    return () => window.clearTimeout(timer)
  }, [tabs])

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
    <Tabs.Root value={activeTabId ?? undefined} onValueChange={onSelect} activationMode="automatic">
    <div className="flex h-10 items-center gap-1 border-b border-border-1 bg-surface-0 px-2">
      <Tabs.List asChild aria-label={tr('Request tabs')}>
      <div ref={scrollRef} className="flex h-8 min-w-0 flex-1 items-center gap-1 overflow-hidden rounded-[14px] border border-border-1 bg-surface-1 p-1 shadow-[inset_0_1px_0_color-mix(in_srgb,var(--color-text-1)_4%,transparent)]">
      {visibleTabs.map((tab) => {
        const isActive = activeTabId === tab.id
        const isPinned = tab.pinned === true
        return (
          <div
            key={tab.id}
            data-tab-id={tab.id}
            draggable
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
              setDetachArmed(false)
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
              setDetachArmed(false)
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
            onDragEnd={(event) => {
              const draggedId = draggingTabRef.current
              const outsideWindow = detachArmed || event.clientX <= 0 || event.clientY <= 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight
              clearDrag()
              if (draggedId && outsideWindow) void onDetach(draggedId)
            }}
            className={cn(
              'relative flex h-6 min-w-0 items-center gap-1.5 rounded-[10px] border px-2 text-[11px] cursor-pointer group transition-[background-color,border-color,box-shadow,transform] duration-150 focus-within:ring-2 focus-within:ring-accent',
              isPinned
                ? 'shrink-0 basis-[52px] min-w-[48px] max-w-[64px]'
                : 'flex-1 basis-[176px] min-w-[88px] max-w-[180px]',
              isActive
                ? 'z-10 -translate-y-px text-text-1'
                : 'border-transparent text-text-3 hover:border-border-2 hover:bg-surface-2 hover:text-text-2',
              draggingTabId === tab.id && 'opacity-45',
              savedFlashTabs.has(tab.id) && 'tab-clean-flash',
            )}
            style={isActive ? {
              backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, var(--color-surface-2))',
              borderColor: 'color-mix(in srgb, var(--color-accent) 52%, var(--color-border-2))',
              boxShadow: 'inset 0 1px 0 color-mix(in srgb, var(--color-accent) 52%, transparent), 0 6px 14px -10px var(--color-accent)',
            } : undefined}
          >
            {dropTarget?.tabId === tab.id && dropTarget.position === 'before' && (
              <span className="absolute -left-[2px] inset-y-1 w-[2px] rounded bg-accent" />
            )}
            {renamingTabId !== tab.id && (
              <Tabs.Trigger value={tab.id} asChild>
              <button
                type="button"
                aria-label={tab.request.name || tab.request.url || tr('Untitled')}
                onKeyDown={(event) => {
                  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
                  event.preventDefault()
                  const rect = event.currentTarget.getBoundingClientRect()
                  setCtx({ open: true, x: rect.left + 12, y: rect.bottom, tabId: tab.id })
                }}
                className="absolute inset-0 z-0 outline-none"
              />
              </Tabs.Trigger>
  )}
            {/* Tool tabs carry a placeholder request, so showing its method
                would be meaningless — badge the tool instead. */}
            {tab.tool ? (
              <span className="pointer-events-none relative z-10 shrink-0 text-accent" aria-hidden="true">
                {tab.tool === 'jsonviewer' ? <Braces size={11} /> : <BookOpen size={11} />}
              </span>
            ) : (
              <span className={cn('pointer-events-none relative z-10 text-[9px] font-bold shrink-0', METHOD_COLORS[tab.request.method] ?? 'text-text-3')}>
                {tab.request.method}
              </span>
            )}
            {renamingTabId === tab.id && !isPinned && !tab.tool ? (
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
                className="relative z-20 min-w-0 flex-1 truncate bg-transparent outline-none border-b border-accent text-xs text-text-1"
              />
            ) : !isPinned ? (
              <span className="pointer-events-none relative z-10 truncate flex-1">
                {tab.request.name || tab.request.url || tr('Untitled')}
              </span>
            ) : (
              <span className="pointer-events-none relative z-10 sr-only">{tab.request.name || tab.request.url || tr('Pinned tab')}</span>
            )}
            {tab.dirty && (
              <span
                className={cn(
                  'pointer-events-none z-10 rounded-full bg-warning shrink-0 shadow-[0_0_10px_color-mix(in_srgb,var(--color-warning)_42%,transparent)]',
                  isPinned ? 'absolute right-1.5 top-1.5 h-1.5 w-1.5' : 'h-2 w-2 animate-pulse',
                )}
                title={tr('Unsaved changes')}
              />
            )}
            {!isPinned && (
              <button
                aria-label={tr('Close tab')}
                onClick={(e) => { e.stopPropagation(); onClose(tab.id) }}
                className={cn(
                  'relative z-20 shrink-0 rounded p-0.5 text-text-4 transition-colors hover:text-error',
                  isActive ? 'opacity-70' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
                )}
                title={tr('Close tab')}
              >
                <X size={10} />
              </button>
            )}
            {dropTarget?.tabId === tab.id && dropTarget.position === 'after' && (
              <span className="absolute -right-[2px] inset-y-1 w-[2px] rounded bg-accent" />
            )}
          </div>
        )
      })}
      </div>
      </Tabs.List>
      {overflowTabs.length > 0 && (
        <button
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            setOverflowMenu({ x: rect.right - 232, y: rect.bottom + 4 })
          }}
          title={tr('More tabs')}
          aria-label={tr('More tabs')}
          aria-haspopup="menu"
          className="flex h-7 shrink-0 items-center gap-1 rounded-lg border border-border-1 bg-surface-1 px-1.5 text-text-3 transition-colors hover:border-accent/45 hover:bg-surface-2 hover:text-text-1"
        >
          <MoreVertical size={13} />
          <span className="text-[10px] font-semibold tabular-nums">{overflowTabs.length}</span>
        </button>
      )}
      <button
        onClick={() => onNewTab()}
        title={tr('New tab (Ctrl+N)')}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border-1 bg-surface-1 text-text-3 transition-colors hover:border-accent/45 hover:bg-surface-2 hover:text-text-1"
      >
        <Plus size={12} />
      </button>

      {overflowMenu && (
        <ContextMenu
          x={overflowMenu.x}
          y={overflowMenu.y}
          items={overflowTabs.map((tab) => ({
            id: tab.id,
            label: `${tab.tool ? '' : `${tab.request.method}  `}${tab.request.name || tab.request.url || tr('Untitled')}${tab.dirty ? ' •' : ''}`,
          }))}
          onSelect={(id) => { setOverflowMenu(null); onSelect(id) }}
          onClose={() => setOverflowMenu(null)}
        />
      )}

      {detachArmed && createPortal(
        <div className="fixed inset-x-0 bottom-6 z-[300] flex justify-center pointer-events-none">
          <div className="flex items-center gap-2 rounded-full border border-accent/50 bg-surface-1 px-4 py-2 text-xs font-medium text-text-1 shadow-2xl">
            <MonitorUp size={14} className="text-accent" />
            {tr('Release to detach into a new window')}
          </div>
        </div>,
        document.body,
      )}
      {ctx.open && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[200] w-[180px] bg-surface-1 border border-border-2 rounded-lg shadow-2xl py-1 overflow-hidden"
          style={{ left: pos.left, top: pos.top }}
        >
          <div className="px-3 py-1.5 border-b border-border-1 mb-1">
            <span className="text-[9px] font-semibold text-text-4 uppercase tracking-wider">{tr('Tab')}</span>
          </div>
          <button
            onClick={() => { onTogglePinned(ctx.tabId); closeCtx() }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-text-1 hover:bg-surface-2 transition-colors text-left"
          >
            {tabs.find((tab) => tab.id === ctx.tabId)?.pinned ? <PinOff size={11} className="text-text-3" /> : <Pin size={11} className="text-text-3" />}
            {tabs.find((tab) => tab.id === ctx.tabId)?.pinned ? tr('Unpin Tab') : tr('Pin Tab')}
          </button>
          <button
            onClick={() => { startRename(ctx.tabId); closeCtx() }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-text-1 hover:bg-surface-2 transition-colors text-left"
          >
            <Pencil size={11} className="text-text-3" />
            {tr('Rename')}
          </button>
          <button
            onClick={() => { onDuplicate(ctx.tabId); closeCtx() }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-text-1 hover:bg-surface-2 transition-colors text-left"
          >
            <Copy size={11} className="text-text-3" />
            {tr('Duplicate')}
          </button>
          <button
            onClick={() => { void onDetach(ctx.tabId); closeCtx() }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-text-1 hover:bg-surface-2 transition-colors text-left"
          >
            <MonitorUp size={11} className="text-text-3" />
            {tr('Detach into new window')}
          </button>
          <button
            onClick={() => { void onMockTab(ctx.tabId); closeCtx() }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-text-1 hover:bg-surface-2 transition-colors text-left"
          >
            <Server size={11} className="text-text-3" />
            {tr('Mock this tab')}
          </button>
          <div className="my-1 border-t border-border-1" />
          <button
            onClick={() => { onClose(ctx.tabId); closeCtx() }}
            disabled={tabs.find((tab) => tab.id === ctx.tabId)?.pinned === true}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-text-1 hover:bg-surface-2 transition-colors text-left disabled:cursor-not-allowed disabled:opacity-30"
          >
            <X size={11} className="text-text-3" />
            {tr('Close')}
          </button>
          <button
            onClick={() => { onCloseToRight(ctx.tabId); closeCtx() }}
            disabled={ctxTabIdx === tabs.length - 1 || tabs.length <= 1}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-text-2 hover:bg-surface-2 hover:text-text-1 transition-colors text-left disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight size={11} className="text-text-3" />
            {tr('Close to the Right')}
          </button>
          <button
            onClick={() => { onCloseToLeft(ctx.tabId); closeCtx() }}
            disabled={ctxTabIdx === 0 || tabs.length <= 1}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-text-2 hover:bg-surface-2 hover:text-text-1 transition-colors text-left disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={11} className="text-text-3" />
            {tr('Close to the Left')}
          </button>
          <button
            onClick={() => { onCloseAll(ctx.tabId); closeCtx() }}
            disabled={tabs.length === 0}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-text-2 hover:bg-surface-2 hover:text-text-1 transition-colors text-left disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <X size={11} className="text-text-3" />
            {tr('Close All')}
          </button>
        </div>
      , document.body)}
    </div>
    </Tabs.Root>
  )
}
