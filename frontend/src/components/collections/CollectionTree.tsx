import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ChevronRight,
  Code,
  Copy,
  Download,
  Folder,
  FolderPlus,
  GripVertical,
  Link,
  Layers,
  Plus,
  Search,
  Trash2,
  Upload,
  UploadCloud,
  X,
} from 'lucide-react'
import type { Collection, FolderItem, HttpMethod, RequestItem, TreeNode } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useUiTranslation } from '@/lib/uiI18n'
import { Prompt } from '@/components/ui/prompt'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DialogOverlay, DialogContent, DialogHeader, DialogBody } from '@/components/ui/dialog'
import { copyToClipboard, generateCode } from '@/lib/codegen'
import {
  cloneCollection,
  exportAllCollectionsPayload,
  exportCollectionPayload,
  exportNodePayload,
  importCollectionsFromText,
  type ExportFormat,
} from '@/lib/collectionTransfer'
import { collectionToOAS } from '@/lib/oasExport'

interface CollectionTreeProps {
  collections: Collection[]
  activeRequestId: string | null
  onOpenRequest: (request: RequestItem, collectionId: string) => void
  onNewRequest: (method?: HttpMethod) => string | null
  onDeleteCollection: (id: string) => void
  onDeleteNode: (collectionId: string, nodeId: string) => void
  onAddCollection: () => void
  onRenameCollection: (id: string, name: string) => void
  onRenameNode: (collectionId: string, nodeId: string, name: string) => void
  onAddFolder: (collectionId: string, parentId: string | null, name: string) => void
  onDuplicateRequest: (collectionId: string, request: RequestItem) => void
  onDuplicateNode: (collectionId: string, nodeId: string) => TreeNode | null
  onAddRequestToFolder: (collectionId: string, parentId: string | null, method?: HttpMethod) => string | null
  onImportCollection: (collection: Collection) => void
  workspaceTargets: Array<{ id: string; name: string }>
  onMoveCollectionToWorkspace: (collectionId: string, workspaceId: string) => void
  onReorderCollections: (fromId: string, toId: string) => void
  onMoveNode: (collectionId: string, nodeId: string, targetCollectionId: string, targetParentId: string | null, targetIndex: number) => void
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
  WS: 'text-warning',
  SOAP: 'text-info',
}

type DragPayload =
  | { type: 'collection'; collectionId: string }
  | { type: 'node'; collectionId: string; nodeId: string; nodeType: TreeNode['type'] }

type DropPosition = 'before' | 'inside' | 'after'

type ContextTarget =
  | { kind: 'collection'; collection: Collection; x: number; y: number }
  | { kind: 'folder'; collectionId: string; node: FolderItem; x: number; y: number }
  | { kind: 'request'; collectionId: string; node: RequestItem; x: number; y: number }

function countRequests(nodes: TreeNode[]): number {
  return nodes.reduce((count, node) => count + (node.type === 'request' ? 1 : countRequests(node.children)), 0)
}

function requestMatchesQuery(node: RequestItem, lower: string): boolean {
  if (node.name.toLowerCase().includes(lower)) return true
  if (node.url.toLowerCase().includes(lower)) return true
  if (node.headers?.some((h) => h.key.toLowerCase().includes(lower) || h.value.toLowerCase().includes(lower))) return true
  if (node.params?.some((p) => p.key.toLowerCase().includes(lower) || p.value.toLowerCase().includes(lower))) return true
  const body = node.bodies?.[node.activeBodyIdx ?? 0]
  if (body?.raw?.toLowerCase().includes(lower)) return true
  if (body?.form?.some((f) => f.key.toLowerCase().includes(lower) || f.value.toLowerCase().includes(lower))) return true
  if (node.description?.toLowerCase().includes(lower)) return true
  return false
}

/** Returns a short hint string if the match is NOT in name/url, so the user knows why it appeared. */
function getMatchHint(node: RequestItem, lower: string): string | null {
  if (node.name.toLowerCase().includes(lower) || node.url.toLowerCase().includes(lower)) return null
  const hdr = node.headers?.find((h) => h.key.toLowerCase().includes(lower) || h.value.toLowerCase().includes(lower))
  if (hdr) return `hdr:${hdr.key || hdr.value}`
  const param = node.params?.find((p) => p.key.toLowerCase().includes(lower) || p.value.toLowerCase().includes(lower))
  if (param) return `param:${param.key || param.value}`
  const body = node.bodies?.[node.activeBodyIdx ?? 0]
  if (body?.form?.length) {
    const f = body.form.find((r) => r.key.toLowerCase().includes(lower) || r.value.toLowerCase().includes(lower))
    if (f) return `form:${f.key || f.value}`
  }
  if (body?.raw?.toLowerCase().includes(lower)) return 'body'
  if (node.description?.toLowerCase().includes(lower)) return 'notes'
  return null
}

function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  const lower = query.toLowerCase()
  return nodes
    .map((node) => {
      if (node.type === 'folder') {
        const children = filterTree(node.children, query)
        if (children.length || node.name.toLowerCase().includes(lower)) return { ...node, children }
        return null
      }
      return requestMatchesQuery(node as RequestItem, lower) ? node : null
    })
    .filter(Boolean) as TreeNode[]
}

function findNode(nodes: TreeNode[], id: string): TreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    if (node.type === 'folder') {
      const found = findNode(node.children, id)
      if (found) return found
    }
  }
  return null
}

function containsNode(node: TreeNode, id: string): boolean {
  return node.type === 'folder' && Boolean(findNode(node.children, id))
}

function listFolders(nodes: TreeNode[]): FolderItem[] {
  const folders: FolderItem[] = []
  for (const node of nodes) {
    if (node.type === 'folder') {
      folders.push(node)
      folders.push(...listFolders(node.children))
    }
  }
  return folders
}

function MoveToFolderDialog({
  open,
  folders,
  onSelect,
  onCancel,
}: {
  open: boolean
  folders: FolderItem[]
  onSelect: (folderId: string | null) => void
  onCancel: () => void
}) {
  const tr = useUiTranslation()
  return (
    <DialogOverlay open={open} onClose={onCancel}>
      <DialogContent size="sm">
        <DialogHeader>
          <span className="text-sm font-semibold text-text-1">{tr('Move to Folder')}</span>
          <button onClick={onCancel} title={tr('Close')} className="text-text-4 hover:text-text-1 transition-colors">
            <X size={16} />
          </button>
        </DialogHeader>
        <DialogBody className="p-0 max-h-64 overflow-y-auto">
          <button
            onClick={() => onSelect(null)}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs text-text-2 hover:bg-surface-2 transition-colors border-b border-border-1"
          >
            <Folder size={12} className="shrink-0 text-text-4" />
            <span className="italic">{tr('Collection Root')}</span>
          </button>
          {folders.length === 0 ? (
            <p className="px-3 py-4 text-xs text-text-4 text-center">{tr('No folders in this collection')}</p>
          ) : (
            folders.map((folder) => (
              <button
                key={folder.id}
                onClick={() => onSelect(folder.id)}
                className="flex w-full items-center gap-2 px-3 py-2 text-xs text-text-2 hover:bg-surface-2 transition-colors"
              >
                <Folder size={12} className="shrink-0 text-accent" />
                {folder.name}
              </button>
            ))
          )}
        </DialogBody>
      </DialogContent>
    </DialogOverlay>
  )
}

function downloadText(filename: string, text: string, type = 'application/json') {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'collection'
}

function InlineEdit({
  value,
  onCommit,
  onCancel,
}: {
  value: string
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  const [next, setNext] = useState(value)
  return (
    <input
      autoFocus
      value={next}
      onChange={(event) => setNext(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onBlur={() => (next.trim() ? onCommit(next.trim()) : onCancel())}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          next.trim() ? onCommit(next.trim()) : onCancel()
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        }
      }}
      className="min-w-0 flex-1 rounded border border-accent/60 bg-surface-3 px-1 text-xs text-text-1 outline-none"
    />
  )
}

function MenuButton({ children, onClick, danger = false }: { children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-surface-2',
        danger ? 'text-error' : 'text-text-3 hover:text-text-1',
      )}
    >
      {children}
    </button>
  )
}

function TreeNodeRow({
  node,
  collection,
  parentId,
  index,
  depth,
  activeRequestId,
  openIds,
  editingId,
  dragPayload,
  dropTarget,
  focusedId,
  query,
  onToggle,
  onOpenRequest,
  onSetEditing,
  onCommitRename,
  onContext,
  onDragStartNode,
  onDropNode,
  onDragOverNode,
  onClearDrop,
  onSetFocused,
}: {
  node: TreeNode
  collection: Collection
  parentId: string | null
  index: number
  depth: number
  activeRequestId: string | null
  openIds: Set<string>
  editingId: string | null
  dragPayload: DragPayload | null
  dropTarget: { id: string; position: DropPosition } | null
  focusedId: string | null
  query: string
  onToggle: (id: string) => void
  onOpenRequest: (request: RequestItem, collectionId: string) => void
  onSetEditing: (id: string | null) => void
  onCommitRename: (collectionId: string, nodeId: string, name: string) => void
  onContext: (target: ContextTarget) => void
  onDragStartNode: (event: React.DragEvent, payload: DragPayload) => void
  onDropNode: (event: React.DragEvent, collectionId: string, node: TreeNode, parentId: string | null, index: number) => void
  onDragOverNode: (event: React.DragEvent, collectionId: string, node: TreeNode) => void
  onClearDrop: () => void
  onSetFocused: (id: string) => void
}) {
  const isFolder = node.type === 'folder'
  const isOpen = isFolder && openIds.has(node.id)
  const isInvalidDrop = dragPayload?.type === 'node' && (dragPayload.nodeId === node.id || (dragPayload.nodeType === 'folder' && containsNode(node, dragPayload.nodeId)))
  const target = dropTarget?.id === node.id ? dropTarget.position : null
  const matchHint = query && !isFolder ? getMatchHint(node as RequestItem, query.toLowerCase()) : null

  return (
    <div>
      <div
        data-node-id={node.id}
        data-collection-request={isFolder ? undefined : 'true'}
        data-request-active={!isFolder && activeRequestId === node.id ? 'true' : undefined}
        role="treeitem"
        tabIndex={-1}
        aria-selected={focusedId === node.id}
        aria-expanded={isFolder ? isOpen : undefined}
        draggable
        onDragStart={(event) => onDragStartNode(event, { type: 'node', collectionId: collection.id, nodeId: node.id, nodeType: node.type })}
        onDragOver={(event) => onDragOverNode(event, collection.id, node)}
        onDrop={(event) => onDropNode(event, collection.id, node, parentId, index)}
        onDragLeave={onClearDrop}
        onDragEnd={onClearDrop}
        onClick={() => { onSetFocused(node.id); isFolder ? onToggle(node.id) : onOpenRequest(node as RequestItem, collection.id) }}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onContext(isFolder ? { kind: 'folder', collectionId: collection.id, node: node as FolderItem, x: event.clientX, y: event.clientY } : { kind: 'request', collectionId: collection.id, node: node as RequestItem, x: event.clientX, y: event.clientY })
        }}
        className={cn(
          'group relative flex h-7 items-center gap-1 rounded px-1 text-xs transition-colors',
          activeRequestId === node.id ? 'bg-surface-2 text-text-1 shadow-[inset_2px_0_0_var(--color-accent)]' : 'text-text-2 hover:bg-surface-2/70',
          target === 'inside' && !isInvalidDrop && 'ring-1 ring-accent/70 bg-accent/10',
          isInvalidDrop && target && 'ring-1 ring-error/60 bg-error/8',
          focusedId === node.id && 'ring-1 ring-inset ring-accent/50',
        )}
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        {target === 'before' && <span className="absolute left-1 right-1 top-0 h-0.5 rounded bg-accent" />}
        {target === 'after' && <span className="absolute bottom-0 left-1 right-1 h-0.5 rounded bg-accent" />}
        <GripVertical size={10} className="shrink-0 cursor-grab text-text-4 opacity-0 group-hover:opacity-60" />
        {isFolder ? (
          <>
            <ChevronRight size={12} className={cn('shrink-0 text-text-4 transition-transform', isOpen && 'rotate-90')} />
            <Folder size={13} className="shrink-0 text-text-3" />
          </>
        ) : (
          <span className={cn('w-12 shrink-0 pr-1 text-[9px] font-bold', METHOD_COLORS[(node as RequestItem).method] ?? 'text-text-3')}>{(node as RequestItem).method}</span>
        )}
        {editingId === node.id ? (
          <InlineEdit
            value={node.name}
            onCommit={(name) => {
              onCommitRename(collection.id, node.id, name)
              onSetEditing(null)
            }}
            onCancel={() => onSetEditing(null)}
          />
        ) : (
          <span onDoubleClick={(event) => { event.stopPropagation(); onSetEditing(node.id) }} className="min-w-0 flex-1 truncate">
            {node.name}
          </span>
        )}
        {matchHint && (
          <span className="shrink-0 rounded bg-surface-3 px-1 py-0.5 font-mono text-[8px] text-text-4 truncate max-w-[72px]" title={matchHint}>
            {matchHint}
          </span>
        )}
        {isFolder && <span className="text-[10px] text-text-4">{countRequests((node as FolderItem).children)}</span>}
      </div>
      {isFolder && isOpen && (
        <div>
          {(node as FolderItem).children.map((child, childIndex) => (
            <TreeNodeRow
              key={child.id}
              node={child}
              collection={collection}
              parentId={node.id}
              index={childIndex}
              depth={depth + 1}
              activeRequestId={activeRequestId}
              openIds={openIds}
              editingId={editingId}
              dragPayload={dragPayload}
              dropTarget={dropTarget}
              focusedId={focusedId}
              query={query}
              onToggle={onToggle}
              onOpenRequest={onOpenRequest}
              onSetEditing={onSetEditing}
              onCommitRename={onCommitRename}
              onContext={onContext}
              onDragStartNode={onDragStartNode}
              onDropNode={onDropNode}
              onDragOverNode={onDragOverNode}
              onClearDrop={onClearDrop}
              onSetFocused={onSetFocused}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function CollectionTree({
  collections,
  activeRequestId,
  onOpenRequest,
  onNewRequest,
  onDeleteCollection,
  onDeleteNode,
  onAddCollection,
  onRenameCollection,
  onRenameNode,
  onAddFolder,
  onDuplicateRequest,
  onDuplicateNode,
  onAddRequestToFolder,
  onImportCollection,
  workspaceTargets,
  onMoveCollectionToWorkspace,
  onReorderCollections,
  onMoveNode,
}: CollectionTreeProps) {
  const tr = useUiTranslation()
  const [query, setQuery] = useState('')
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(collections.map((c) => c.id)))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [folderPrompt, setFolderPrompt] = useState<{ collectionId: string; parentId: string | null } | null>(null)
  const [moveTarget, setMoveTarget] = useState<{ collectionId: string; requestId: string; folders: FolderItem[] } | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ContextTarget | null>(null)
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<Set<string>>(() => new Set())
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [context, setContext] = useState<ContextTarget | null>(null)
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null)
  const [dragPayload, setDragPayload] = useState<DragPayload | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; position: DropPosition } | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Focus the request search on Cmd/Ctrl+Shift+F (dispatched by the global shortcuts hook).
  useEffect(() => {
    const focusSearch = () => { searchInputRef.current?.focus(); searchInputRef.current?.select() }
    document.addEventListener('adomnia:focus-search', focusSearch)
    return () => document.removeEventListener('adomnia:focus-search', focusSearch)
  }, [])

  useEffect(() => {
    setOpenIds((current) => {
      const next = new Set(current)
      for (const collection of collections) next.add(collection.id)
      return next
    })
  }, [collections])

  useEffect(() => {
    if (!context) return
    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setContext(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [context])

  useEffect(() => {
    if (!importError) return
    const timer = setTimeout(() => setImportError(null), 4000)
    return () => clearTimeout(timer)
  }, [importError])

  // Keep the context menu fully inside the viewport: after it mounts, measure it
  // and shift left/up so the bottom (Delete) is never clipped off-screen.
  useLayoutEffect(() => {
    if (!context) {
      setMenuPos(null)
      return
    }
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const pad = 8
    const left = Math.max(pad, Math.min(context.x, window.innerWidth - rect.width - pad))
    const top = Math.max(pad, Math.min(context.y, window.innerHeight - rect.height - pad))
    setMenuPos({ left, top })
  }, [context])

  // Drop collections from the selection once they no longer exist.
  useEffect(() => {
    setSelectedCollectionIds((prev) => {
      if (prev.size === 0) return prev
      const live = new Set(collections.map((c) => c.id))
      const next = new Set([...prev].filter((id) => live.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [collections])

  const clearSelection = () => setSelectedCollectionIds(new Set())

  const deleteSelectedCollections = () => {
    for (const id of selectedCollectionIds) onDeleteCollection(id)
    clearSelection()
    setBulkDeleteOpen(false)
  }

  const filtered = useMemo(() => {
    if (!query.trim()) return collections
    return collections
      .map((collection) => ({ ...collection, children: filterTree(collection.children, query) }))
      .filter((collection) => collection.name.toLowerCase().includes(query.toLowerCase()) || collection.children.length)
  }, [collections, query])

  type FlatItem = { id: string; kind: 'collection' | 'folder' | 'request'; collectionId: string; data: Collection | TreeNode }

  const flatItems = useMemo(() => {
    const items: FlatItem[] = []
    const addNodes = (nodes: TreeNode[], collectionId: string) => {
      for (const node of nodes) {
        items.push({ id: node.id, kind: node.type === 'folder' ? 'folder' : 'request', collectionId, data: node })
        if (node.type === 'folder' && openIds.has(node.id)) addNodes((node as FolderItem).children, collectionId)
      }
    }
    for (const col of filtered) {
      items.push({ id: col.id, kind: 'collection', collectionId: col.id, data: col })
      if (openIds.has(col.id)) addNodes(col.children, col.id)
    }
    return items
  }, [filtered, openIds])

  // Auto-scroll focused item into view
  useEffect(() => {
    if (!focusedId) return
    const el = document.querySelector(`[data-node-id="${focusedId}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [focusedId])

  const toggle = (id: string) => {
    setOpenIds((current) => {
      const next = new Set(current)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleTreeKeyDown = (event: React.KeyboardEvent) => {
    if (editingId) return
    const idx = focusedId ? flatItems.findIndex((i) => i.id === focusedId) : -1
    const current = flatItems[idx] ?? null
    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault()
        const next = flatItems[idx + 1] ?? (idx < 0 ? flatItems[0] : null)
        if (next) setFocusedId(next.id)
        break
      }
      case 'ArrowUp': {
        event.preventDefault()
        if (idx < 0 && flatItems.length > 0) { setFocusedId(flatItems[0].id); break }
        if (idx > 0) setFocusedId(flatItems[idx - 1].id)
        break
      }
      case 'ArrowRight': {
        event.preventDefault()
        if (current && (current.kind === 'collection' || current.kind === 'folder') && !openIds.has(current.id)) toggle(current.id)
        break
      }
      case 'ArrowLeft': {
        event.preventDefault()
        if (current && (current.kind === 'collection' || current.kind === 'folder') && openIds.has(current.id)) toggle(current.id)
        break
      }
      case 'Enter':
      case ' ': {
        event.preventDefault()
        if (!current) { if (flatItems.length > 0) setFocusedId(flatItems[0].id); break }
        if (current.kind === 'request') onOpenRequest(current.data as RequestItem, current.collectionId)
        else toggle(current.id)
        break
      }
      case 'F2': {
        event.preventDefault()
        if (current) setEditingId(current.id)
        break
      }
      case 'ContextMenu':
      case 'F10': {
        if (event.key === 'F10' && !event.shiftKey) break
        event.preventDefault()
        if (!current) break
        const rect = document.querySelector(`[data-node-id="${current.id}"]`)?.getBoundingClientRect()
        const x = rect?.left ?? 0
        const y = rect?.bottom ?? 0
        if (current.kind === 'collection') {
          setContext({ kind: 'collection', collection: current.data as Collection, x, y })
        } else if (current.kind === 'folder') {
          setContext({ kind: 'folder', collectionId: current.collectionId, node: current.data as FolderItem, x, y })
        } else {
          setContext({ kind: 'request', collectionId: current.collectionId, node: current.data as RequestItem, x, y })
        }
        break
      }
      case 'Delete': {
        event.preventDefault()
        if (selectedCollectionIds.size > 0) { setBulkDeleteOpen(true); break }
        if (!current) break
        if (current.kind === 'collection') setDeleteTarget({ kind: 'collection', collection: current.data as Collection, x: 0, y: 0 })
        else if (current.kind === 'folder') setDeleteTarget({ kind: 'folder', collectionId: current.collectionId, node: current.data as FolderItem, x: 0, y: 0 })
        else setDeleteTarget({ kind: 'request', collectionId: current.collectionId, node: current.data as RequestItem, x: 0, y: 0 })
        break
      }
    }
  }

  const handleImport = async (file: File | undefined) => {
    if (!file) return
    try {
      const result = importCollectionsFromText(await file.text(), 'auto')
      for (const collection of result.collections) {
        const exists = collections.some((current) => current.name === collection.name)
        onImportCollection(exists ? cloneCollection(collection, `${collection.name} Import`) : collection)
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const exportCollection = (collection: Collection, format: ExportFormat) => {
    downloadText(`${slug(collection.name)}.${format}.json`, exportCollectionPayload(collection, format))
    setContext(null)
  }

  const exportCollectionOASYaml = (collection: Collection) => {
    downloadText(`${slug(collection.name)}.openapi.yaml`, collectionToOAS(collection, 'yaml'), 'text/yaml')
    setContext(null)
  }

  const exportNode = (collectionId: string, node: TreeNode, format: ExportFormat) => {
    const collection = collections.find((item) => item.id === collectionId)
    if (!collection) return
    downloadText(`${slug(node.name)}.${format}.json`, exportNodePayload(collection, node, format))
    setContext(null)
  }

  const exportAll = (format: ExportFormat) => {
    downloadText(`adomnia-collections.${format}.json`, exportAllCollectionsPayload(collections, format))
    setContext(null)
  }

  const openMoveDialog = (collectionId: string, requestId: string) => {
    const collection = collections.find((item) => item.id === collectionId)
    if (!collection) return
    setMoveTarget({ collectionId, requestId, folders: listFolders(collection.children) })
    setContext(null)
  }

  const handleMoveSelect = (folderId: string | null) => {
    if (!moveTarget) return
    const { collectionId, requestId, folders } = moveTarget
    const collection = collections.find((c) => c.id === collectionId)
    if (!collection) return
    const folder = folderId ? folders.find((f) => f.id === folderId) ?? null : null
    onMoveNode(collectionId, requestId, collectionId, folderId, folder ? folder.children.length : collection.children.length)
    setMoveTarget(null)
  }

  const dragPosition = (event: React.DragEvent, node: TreeNode): DropPosition => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const offset = event.clientY - rect.top
    if (node.type === 'folder' && offset > rect.height * 0.28 && offset < rect.height * 0.72) return 'inside'
    return offset < rect.height / 2 ? 'before' : 'after'
  }

  const startDrag = (event: React.DragEvent, payload: DragPayload) => {
    setDragPayload(payload)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/json', JSON.stringify(payload))
  }

  const clearDrop = () => setDropTarget(null)

  const handleNodeDragOver = (event: React.DragEvent, _collectionId: string, node: TreeNode) => {
    if (!dragPayload || dragPayload.type !== 'node') return
    event.preventDefault()
    setDropTarget({ id: node.id, position: dragPosition(event, node) })
  }

  const handleNodeDrop = (event: React.DragEvent, targetCollectionId: string, node: TreeNode, parentId: string | null, index: number) => {
    event.preventDefault()
    if (!dragPayload || dragPayload.type !== 'node') return
    const position = dropTarget?.id === node.id ? dropTarget.position : dragPosition(event, node)
    if (dragPayload.nodeId === node.id) return
    if (dragPayload.nodeType === 'folder' && containsNode(node, dragPayload.nodeId)) return
    if (position === 'inside' && node.type === 'folder') {
      onMoveNode(dragPayload.collectionId, dragPayload.nodeId, targetCollectionId, node.id, node.children.length)
      setOpenIds((current) => new Set([...current, node.id]))
    } else {
      onMoveNode(dragPayload.collectionId, dragPayload.nodeId, targetCollectionId, parentId, position === 'before' ? index : index + 1)
    }
    setDragPayload(null)
    setDropTarget(null)
  }

  const handleCollectionDrop = (event: React.DragEvent, collection: Collection, index: number) => {
    event.preventDefault()
    if (!dragPayload) return
    if (dragPayload.type === 'collection') {
      if (dragPayload.collectionId !== collection.id) onReorderCollections(dragPayload.collectionId, collection.id)
    } else {
      onMoveNode(dragPayload.collectionId, dragPayload.nodeId, collection.id, null, index)
    }
    setDragPayload(null)
    setDropTarget(null)
  }

  const contextExportMenu = (target: ContextTarget) => (
    <div className="border-t border-border-1 py-1">
      {(['adomnia', 'postman', 'insomnia', 'bruno', 'openapi', 'swagger2'] as ExportFormat[]).map((format) => (
        <MenuButton
          key={format}
          onClick={() => target.kind === 'collection' ? exportCollection(target.collection, format) : exportNode(target.collectionId, target.node, format)}
        >
          <Download size={12} /> Export {format === 'openapi' ? 'OpenAPI 3' : format === 'swagger2' ? 'Swagger 2.0' : format}
        </MenuButton>
      ))}
      {target.kind === 'collection' && (
        <MenuButton onClick={() => exportCollectionOASYaml(target.collection)}>
          <Download size={12} /> Export OpenAPI 3 (YAML)
        </MenuButton>
      )}
    </div>
  )

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-border-1 px-2 py-2">
        <span className="flex-1 text-[10px] font-semibold uppercase tracking-wider text-text-4">{tr('Collections')}</span>
        <input ref={fileInputRef} type="file" accept=".json,.yaml,.yml,.bru" className="hidden" onChange={(event) => void handleImport(event.target.files?.[0])} />
        <button onClick={() => fileInputRef.current?.click()} title={tr('Import Postman, Insomnia, Bruno, adOmnia or OpenAPI')} className="grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-2 hover:text-text-1">
          <Upload size={14} />
        </button>
        <button onClick={() => exportAll('adomnia')} title={tr('Export all collections')} className="grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-2 hover:text-text-1">
          <Download size={14} />
        </button>
        <button
          onClick={() => {
            const collectionId = onNewRequest()
            if (collectionId) setOpenIds((current) => new Set(current).add(collectionId))
          }}
          title={tr('New request')}
          className="grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-2 hover:text-text-1"
        >
          <Plus size={14} />
        </button>
        <button onClick={onAddCollection} title={tr('New collection')} className="grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-2 hover:text-text-1">
          <FolderPlus size={14} />
        </button>
      </div>

      <div className="px-2 py-1.5">
        <div className="flex h-7 items-center gap-1.5 rounded border border-border-2 bg-surface-2 px-2">
          <Search size={12} className="text-text-4" />
          <input ref={searchInputRef} className="flex-1 bg-transparent text-xs text-text-1 outline-none placeholder:text-text-4" placeholder={tr('Search requests...')} value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
      </div>

      {selectedCollectionIds.size > 0 && (
        <div className="flex items-center gap-2 border-b border-border-1 bg-accent/5 px-2 py-1.5">
          <span className="flex-1 text-[11px] font-medium text-text-2">
            {selectedCollectionIds.size} {tr('collections')} {tr('selected')}
          </span>
          <button
            onClick={() => setBulkDeleteOpen(true)}
            className="flex items-center gap-1 rounded bg-error/15 px-2 py-1 text-[11px] font-medium text-error hover:bg-error/25 transition-colors"
          >
            <Trash2 size={12} /> {tr('Delete')}
          </button>
          <button
            onClick={clearSelection}
            className="rounded px-2 py-1 text-[11px] text-text-3 hover:bg-surface-2 hover:text-text-1 transition-colors"
          >
            {tr('Clear')}
          </button>
        </div>
      )}

      <div role="tree" aria-label={tr('Collections')} className="flex-1 overflow-y-auto px-1 pb-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent" tabIndex={0} onKeyDown={handleTreeKeyDown}>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
            <div className="grid h-10 w-10 place-items-center rounded-lg border border-dashed border-border-2 bg-surface-1 text-text-3">
              <UploadCloud size={18} />
            </div>
            <div>
              <p className="text-xs font-medium text-text-3">{tr('No collections yet')}</p>
              <p className="mt-1 text-[10px] leading-relaxed text-text-4">
                {tr('Drop Postman, OpenAPI, Insomnia, Bruno, .adomnia or HAR files anywhere in adOmnia.')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => fileInputRef.current?.click()} className="text-xs text-accent hover:text-accent-light">{tr('Import file')}</button>
              <span className="text-text-4">/</span>
              <button onClick={onAddCollection} className="text-xs text-accent hover:text-accent-light">{tr('Create collection')}</button>
            </div>
          </div>
        ) : filtered.map((collection, collectionIndex) => (
          <div
            key={collection.id}
            className="mt-1 rounded"
            draggable
            onDragStart={(event) => startDrag(event, { type: 'collection', collectionId: collection.id })}
            onDragOver={(event) => {
              event.preventDefault()
              setDropTarget({ id: collection.id, position: 'inside' })
            }}
            onDrop={(event) => handleCollectionDrop(event, collection, collection.children.length)}
            onDragEnd={() => { setDragPayload(null); setDropTarget(null) }}
          >
            <div
              data-node-id={collection.id}
              role="treeitem"
              tabIndex={-1}
              aria-selected={focusedId === collection.id}
              aria-expanded={openIds.has(collection.id)}
              onClick={(event) => {
                if (event.ctrlKey || event.metaKey) {
                  event.preventDefault()
                  setFocusedId(collection.id)
                  setSelectedCollectionIds((prev) => {
                    const next = new Set(prev)
                    next.has(collection.id) ? next.delete(collection.id) : next.add(collection.id)
                    return next
                  })
                  return
                }
                if (selectedCollectionIds.size > 0) clearSelection()
                setFocusedId(collection.id)
                toggle(collection.id)
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                setContext({ kind: 'collection', collection, x: event.clientX, y: event.clientY })
              }}
              className={cn(
                'group relative flex h-7 cursor-pointer items-center gap-1 rounded px-1 text-xs font-medium text-text-2 hover:bg-surface-2/70 hover:text-text-1',
                dropTarget?.id === collection.id && dragPayload?.type === 'node' && 'ring-1 ring-accent/70 bg-accent/10',
                selectedCollectionIds.has(collection.id) && 'bg-accent/15 text-text-1 ring-1 ring-inset ring-accent/50',
                focusedId === collection.id && !selectedCollectionIds.has(collection.id) && 'ring-1 ring-inset ring-accent/50',
              )}
            >
              {collection.color && <span className="absolute bottom-0.5 left-0 top-0.5 w-[2px] rounded-r" style={{ backgroundColor: collection.color }} />}
              <GripVertical size={11} className="shrink-0 cursor-grab text-text-4 opacity-0 group-hover:opacity-60" />
              <ChevronRight size={12} className={cn('shrink-0 text-text-4 transition-transform', openIds.has(collection.id) && 'rotate-90')} />
              <Folder size={13} className="shrink-0 text-text-3" style={collection.color ? { color: collection.color } : undefined} />
              {editingId === collection.id ? (
                <InlineEdit value={collection.name} onCommit={(name) => { onRenameCollection(collection.id, name); setEditingId(null) }} onCancel={() => setEditingId(null)} />
              ) : (
                <span onDoubleClick={(event) => { event.stopPropagation(); setEditingId(collection.id) }} className="min-w-0 flex-1 truncate">{collection.name}</span>
              )}
              <span className="text-[10px] text-text-4">{countRequests(collection.children)}</span>
            </div>
            {openIds.has(collection.id) && collection.children.map((node, index) => (
              <TreeNodeRow
                key={node.id}
                node={node}
                collection={collection}
                parentId={null}
                index={index}
                depth={1}
                activeRequestId={activeRequestId}
                openIds={openIds}
                editingId={editingId}
                dragPayload={dragPayload}
                dropTarget={dropTarget}
                focusedId={focusedId}
                query={query}
                onToggle={toggle}
                onOpenRequest={onOpenRequest}
                onSetEditing={setEditingId}
                onCommitRename={onRenameNode}
                onContext={setContext}
                onDragStartNode={startDrag}
                onDropNode={handleNodeDrop}
                onDragOverNode={handleNodeDragOver}
                onClearDrop={clearDrop}
                onSetFocused={setFocusedId}
              />
            ))}
            {collectionIndex === filtered.length - 1 && dragPayload?.type === 'node' && collection.children.length === 0 && (
              <button onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleCollectionDrop(event, collection, 0)} className="ml-6 mt-1 h-6 w-[calc(100%-1.5rem)] rounded border border-dashed border-border-2 text-[10px] text-text-4 hover:border-accent hover:text-accent">
                Drop into collection root
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 border-t border-border-1 px-3 py-1.5 text-[10px] text-text-4">
        <span>{collections.reduce((count, collection) => count + countRequests(collection.children), 0)} {tr('requests')}</span>
      </div>

      {context && (
        <div ref={menuRef} className="fixed z-50 max-h-[70vh] w-52 overflow-y-auto rounded-md border border-border-1 bg-surface-1 py-1 shadow-xl" style={{ left: menuPos?.left ?? context.x, top: menuPos?.top ?? context.y, visibility: menuPos ? 'visible' : 'hidden' }}>
          {context.kind === 'collection' && (
            <>
              <MenuButton onClick={() => { setEditingId(context.collection.id); setContext(null) }}><Copy size={12} /> {tr('Rename')}</MenuButton>
              <MenuButton onClick={() => { onImportCollection(cloneCollection(context.collection)); setContext(null) }}><Copy size={12} /> {tr('Duplicate')}</MenuButton>
              <MenuButton onClick={() => { setFolderPrompt({ collectionId: context.collection.id, parentId: null }); setContext(null) }}><FolderPlus size={12} /> {tr('New Folder')}</MenuButton>
              <MenuButton onClick={() => { onAddRequestToFolder(context.collection.id, null); setContext(null) }}><Plus size={12} /> {tr('New Request')}</MenuButton>
              {workspaceTargets.length > 0 && (
                <div className="border-t border-border-1 py-1">
                  <div className="px-3 py-1 text-[9px] font-semibold uppercase tracking-wider text-text-4">{tr('Move to workspace')}</div>
                  {workspaceTargets.map((workspace) => (
                    <MenuButton
                      key={workspace.id}
                      onClick={() => {
                        onMoveCollectionToWorkspace(context.collection.id, workspace.id)
                        setContext(null)
                      }}
                    >
                      <Layers size={12} /> {workspace.name}
                    </MenuButton>
                  ))}
                </div>
              )}
              {contextExportMenu(context)}
              <MenuButton danger onClick={() => { setDeleteTarget(context); setContext(null) }}><Trash2 size={12} /> {tr('Delete')}</MenuButton>
            </>
          )}
          {context.kind === 'folder' && (
            <>
              <MenuButton onClick={() => { setEditingId(context.node.id); setContext(null) }}><Copy size={12} /> {tr('Rename')}</MenuButton>
              <MenuButton onClick={() => { onDuplicateNode(context.collectionId, context.node.id); setContext(null) }}><Copy size={12} /> {tr('Duplicate')}</MenuButton>
              <MenuButton onClick={() => { setFolderPrompt({ collectionId: context.collectionId, parentId: context.node.id }); setContext(null) }}><FolderPlus size={12} /> {tr('New Subfolder')}</MenuButton>
              <MenuButton onClick={() => { onAddRequestToFolder(context.collectionId, context.node.id); setOpenIds((s) => { const n = new Set(s); n.add(context.node.id); return n }); setContext(null) }}><Plus size={12} /> {tr('New Request')}</MenuButton>
              {contextExportMenu(context)}
              <MenuButton danger onClick={() => { setDeleteTarget(context); setContext(null) }}><Trash2 size={12} /> {tr('Delete')}</MenuButton>
            </>
          )}
          {context.kind === 'request' && (
            <>
              <MenuButton onClick={() => { setEditingId(context.node.id); setContext(null) }}><Copy size={12} /> {tr('Rename')}</MenuButton>
              <MenuButton onClick={() => { onDuplicateRequest(context.collectionId, context.node); setContext(null) }}><Copy size={12} /> {tr('Duplicate')}</MenuButton>
              <MenuButton onClick={() => openMoveDialog(context.collectionId, context.node.id)}><FolderPlus size={12} /> {tr('Move to Folder')}</MenuButton>
              <MenuButton onClick={() => { void copyToClipboard(generateCode(context.node, 'curl')); setContext(null) }}><Code size={12} /> {tr('Copy as cURL')}</MenuButton>
              <MenuButton onClick={() => { void copyToClipboard(context.node.url); setContext(null) }}><Link size={12} /> {tr('Copy URL')}</MenuButton>
              <MenuButton onClick={() => { onOpenRequest(context.node, context.collectionId); setContext(null) }}><Plus size={12} /> {tr('Open in New Tab')}</MenuButton>
              {contextExportMenu(context)}
              <MenuButton danger onClick={() => { setDeleteTarget(context); setContext(null) }}><Trash2 size={12} /> {tr('Delete')}</MenuButton>
            </>
          )}
        </div>
      )}

      {importError && (
        <div className="absolute bottom-10 left-2 right-2 z-50 flex items-start gap-2 rounded-md border border-error/30 bg-error/15 px-3 py-2 text-xs text-error shadow-xl">
          <span className="flex-1">{importError}</span>
          <button onClick={() => setImportError(null)} className="shrink-0 opacity-70 hover:opacity-100 transition-opacity">
            <X size={12} />
          </button>
        </div>
      )}

      <Prompt
        open={Boolean(folderPrompt)}
        title={tr('New Folder')}
        placeholder={tr('Folder name...')}
        confirmLabel={tr('Create')}
        onConfirm={(name) => {
          if (folderPrompt) onAddFolder(folderPrompt.collectionId, folderPrompt.parentId, name)
          setFolderPrompt(null)
        }}
        onCancel={() => setFolderPrompt(null)}
      />

      <MoveToFolderDialog
        open={Boolean(moveTarget)}
        folders={moveTarget?.folders ?? []}
        onSelect={handleMoveSelect}
        onCancel={() => setMoveTarget(null)}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={deleteTarget?.kind === 'collection' ? tr('Delete collection?') : deleteTarget?.kind === 'folder' ? tr('Delete folder?') : tr('Delete request?')}
        message={deleteTarget ? `"${deleteTarget.kind === 'collection' ? deleteTarget.collection.name : deleteTarget.node.name}": ${tr('Delete the selected item and all nested data? This cannot be undone.')}` : ''}
        confirmLabel={tr('Delete')}
        variant="danger"
        onConfirm={() => {
          if (!deleteTarget) return
          if (deleteTarget.kind === 'collection') onDeleteCollection(deleteTarget.collection.id)
          else onDeleteNode(deleteTarget.collectionId, deleteTarget.node.id)
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        title={tr('Delete selected collections?')}
        message={`${selectedCollectionIds.size}: ${tr('Delete the selected item and all nested data? This cannot be undone.')}`}
        confirmLabel={tr('Delete all')}
        variant="danger"
        onConfirm={deleteSelectedCollections}
        onCancel={() => setBulkDeleteOpen(false)}
      />
    </div>
  )
}
