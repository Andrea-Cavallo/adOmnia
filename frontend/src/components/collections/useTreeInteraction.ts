import { createContext, useEffect, useRef, useState } from 'react'
import type { Collection, RequestItem, TreeNode } from '@/lib/types'
import { useCollectionsStore } from '@/stores/collections'
import { useTabsStore } from '@/stores/tabs'
import { containsTreeNode, locateNode, moveCollectionNodes, REQUEST_DRAG_TYPE, type NodeLocation } from '@/lib/collectionMoves'

export const TreeInteraction = createContext({
  selected: new Set<string>(), dragging: new Set<string>(),
  select: (_event: Pick<React.MouseEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'>, _id: string): boolean => false,
  invalid: (_node: TreeNode, _inside: boolean): boolean => false,
})

export const treeSessions = new Map<string, { open: string[]; query: string; scroll: number; focused: string | null }>()

export function useTreeInteraction(collections: Collection[], treeRef: React.RefObject<HTMLDivElement | null>, expand: (id: string) => void) {
  const [selected, setSelected] = useState(new Set<string>())
  const [dragging, setDragging] = useState(new Set<string>())
  const sources = useRef<NodeLocation[]>([])
  const anchor = useRef<string | null>(null)
  const hover = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null)
  const ghost = useRef<HTMLElement | null>(null)
  const velocity = useRef(0)
  const frame = useRef(0)
  const [notice, setNotice] = useState<{ message: string; undo?: () => boolean } | null>(null)
  const stopHover = () => { if (hover.current) clearTimeout(hover.current.timer); hover.current = null }
  const finish = () => {
    stopHover(); cancelAnimationFrame(frame.current); frame.current = 0; velocity.current = 0
    ghost.current?.remove(); ghost.current = null; sources.current = []; setDragging(new Set())
  }
  useEffect(() => {
    const stop = () => finish()
    document.addEventListener('dragend', stop)
    document.addEventListener('drop', stop)
    return () => { document.removeEventListener('dragend', stop); document.removeEventListener('drop', stop); finish() }
  }, [])
  const select = (event: Pick<React.MouseEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'>, id: string) => {
    if (event.shiftKey && anchor.current) {
      const visible = [...(treeRef.current?.querySelectorAll<HTMLElement>('[data-collection-request]') ?? [])].map(el => el.dataset.nodeId!)
      const a = visible.indexOf(anchor.current), b = visible.indexOf(id)
      if (a >= 0 && b >= 0) { setSelected(new Set(visible.slice(Math.min(a, b), Math.max(a, b) + 1))); return true }
    }
    anchor.current = id
    if (event.ctrlKey || event.metaKey) {
      setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next }); return true
    }
    setSelected(new Set([id])); return false
  }
  const start = (event: React.DragEvent, id: string) => {
    const ids = selected.has(id) ? [...selected] : [id]
    if (!selected.has(id)) setSelected(new Set([id]))
    const locations = ids.map(key => locateNode(collections, key)).filter((n): n is NonNullable<typeof n> => !!n)
    sources.current = locations.filter(n => !locations.some(other => other !== n && containsTreeNode(other.node, n.nodeId)))
    setDragging(new Set(sources.current.map(s => s.nodeId)))
    event.dataTransfer.effectAllowed = 'move'
    const requests = locations.filter(n => n.node.type === 'request').map(n => ({ collectionId: n.collectionId, nodeId: n.nodeId }))
    if (requests.length === locations.length) event.dataTransfer.setData(REQUEST_DRAG_TYPE, JSON.stringify(requests))
    const el = document.createElement('div')
    el.className = 'pointer-events-none fixed -left-[1000px] top-0 rounded-lg border border-accent/40 bg-surface-1 px-3 py-2 text-xs text-text-1 shadow-xl'
    const first = locations[0]?.node
    el.textContent = locations.length > 1 ? `${locations.length} API` : first?.type === 'request' ? `${first.method}  ${first.name}` : first?.name ?? ''
    document.body.appendChild(el); ghost.current = el; event.dataTransfer.setDragImage(el, 12, 12)
  }
  const invalid = (node: TreeNode, _inside: boolean) => sources.current.some(s => {
    const source = locateNode(collections, s.nodeId)?.node
    return !!source && (s.nodeId === node.id || (source.type === 'folder' && containsTreeNode(source, node.id)))
  })
  const over = (id: string | null) => {
    if (hover.current?.id === id) return
    stopHover()
    if (id) hover.current = { id, timer: setTimeout(() => expand(id), 550) }
  }
  const scroll = (event: React.DragEvent) => {
    if (!sources.current.length || !treeRef.current) return
    const bounds = treeRef.current.getBoundingClientRect()
    velocity.current = event.clientY < bounds.top + 40 ? -Math.min(12, (bounds.top + 40 - event.clientY) / 3) : event.clientY > bounds.bottom - 40 ? Math.min(12, (event.clientY - bounds.bottom + 40) / 3) : 0
    if (!frame.current && velocity.current) {
      const tick = () => {
        frame.current = 0
        if (!treeRef.current || !velocity.current) return
        treeRef.current.scrollTop += velocity.current
        frame.current = requestAnimationFrame(tick)
      }
      frame.current = requestAnimationFrame(tick)
    }
  }
  const move = (collectionId: string, parentId: string | null, index: number) => {
    const store = useCollectionsStore.getState()
    const before = store.collections, workspaceId = store.activeWorkspaceId
    const moved = [...sources.current]
    const after = moveCollectionNodes(before, moved, collectionId, parentId, index)
    if (after === before) return
    const affected = before.filter((c, i) => after[i] !== c).map(c => c.id)
    const syncTabs = (current: Collection[]) => {
      useTabsStore.setState(s => ({ tabs: s.tabs.map(t => {
        const location = locateNode(current, t.request.id)
        return location && (t.workspaceId ?? workspaceId) === workspaceId ? { ...t, collectionId: location.collectionId } : t
      }) }))
      useTabsStore.getState().save()
    }
    useCollectionsStore.setState({ collections: after }); store.save(); syncTabs(after)
    const destination = parentId ? locateNode(after, parentId)?.node.name : after.find(c => c.id === collectionId)?.name
    setNotice({ message: `${moved.length} → ${destination ?? ''}`, undo: () => {
      const current = useCollectionsStore.getState()
      // Never overwrite subsequent edits or another workspace when undoing.
      if (current.activeWorkspaceId !== workspaceId || affected.some(id => current.collections.find(c => c.id === id) !== after.find(c => c.id === id))) return false
      const restored = current.collections.map(c => affected.includes(c.id) ? before.find(old => old.id === c.id)! : c)
      useCollectionsStore.setState({ collections: restored }); current.save(); syncTabs(restored); return true
    } })
    if (parentId) expand(parentId)
    expand(collectionId); finish()
  }
  return { selected, dragging, select, invalid, start, over, scroll, move, finish, notice, setNotice, clear: () => setSelected(new Set()), stopScroll: () => { velocity.current = 0; stopHover() } }
}

export function openDroppedRequests(data: string, targetId?: string, position: 'before' | 'after' = 'after') {
  let sources: NodeLocation[]
  try { const value: unknown = JSON.parse(data); if (!Array.isArray(value)) return; sources = value.filter((s): s is NodeLocation => !!s && typeof s.nodeId === 'string' && typeof s.collectionId === 'string') } catch { return }
  for (const source of position === 'after' && targetId ? [...sources].reverse() : sources) {
    const located = locateNode(useCollectionsStore.getState().collections, source.nodeId)
    if (!located || located.collectionId !== source.collectionId || located.node.type !== 'request') continue
    const store = useTabsStore.getState()
    store.openTab(located.node as RequestItem, located.collectionId)
    const id = useTabsStore.getState().activeTabId
    if (id && targetId && id !== targetId) store.reorderTab(id, targetId, position)
  }
}
