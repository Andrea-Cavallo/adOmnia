import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ChevronRight,
  Code,
  Copy,
  Download,
  Folder,
  FolderPlus,
  GripVertical,
  Link,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import type { Collection, FolderItem, HttpMethod, RequestItem, TreeNode } from '@/lib/types'
import { cn } from '@/lib/utils'
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

interface CollectionTreeProps {
  collections: Collection[]
  activeRequestId: string | null
  onOpenRequest: (request: RequestItem, collectionId: string) => void
  onNewRequest: (method?: HttpMethod) => void
  onDeleteCollection: (id: string) => void
  onDeleteNode: (collectionId: string, nodeId: string) => void
  onAddCollection: () => void
  onRenameCollection: (id: string, name: string) => void
  onRenameNode: (collectionId: string, nodeId: string, name: string) => void
  onAddFolder: (collectionId: string, parentId: string | null, name: string) => void
  onDuplicateRequest: (collectionId: string, request: RequestItem) => void
  onDuplicateNode: (collectionId: string, nodeId: string) => TreeNode | null
  onAddRequestToFolder: (collectionId: string, parentId: string | null, method?: HttpMethod) => void
  onImportCollection: (collection: Collection) => void
  onReorderCollections: (fromId: string, toId: string) => void
  onMoveNode: (collectionId: string, nodeId: string, targetCollectionId: string, targetParentId: string | null, targetIndex: number) => void
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-method-get',
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

function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  const lower = query.toLowerCase()
  return nodes
    .map((node) => {
      if (node.type === 'folder') {
        const children = filterTree(node.children, query)
        if (children.length || node.name.toLowerCase().includes(lower)) return { ...node, children }
        return null
      }
      return node.name.toLowerCase().includes(lower) || node.url.toLowerCase().includes(lower) ? node : null
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
  return (
    <DialogOverlay open={open} onClose={onCancel}>
      <DialogContent size="sm">
        <DialogHeader>
          <span className="text-sm font-semibold text-text-1">Move to Folder</span>
          <button onClick={onCancel} className="text-text-4 hover:text-text-1 transition-colors">
            <X size={16} />
          </button>
        </DialogHeader>
        <DialogBody className="p-0 max-h-64 overflow-y-auto">
          <button
            onClick={() => onSelect(null)}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs text-text-2 hover:bg-surface-2 transition-colors border-b border-border-1"
          >
            <Folder size={12} className="shrink-0 text-text-4" />
            <span className="italic">Collection Root</span>
          </button>
          {folders.length === 0 ? (
            <p className="px-3 py-4 text-xs text-text-4 text-center">No folders in this collection</p>
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
  onToggle,
  onOpenRequest,
  onSetEditing,
  onCommitRename,
  onContext,
  onDragStartNode,
  onDropNode,
  onDragOverNode,
  onClearDrop,
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
  onToggle: (id: string) => void
  onOpenRequest: (request: RequestItem, collectionId: string) => void
  onSetEditing: (id: string | null) => void
  onCommitRename: (collectionId: string, nodeId: string, name: string) => void
  onContext: (target: ContextTarget) => void
  onDragStartNode: (event: React.DragEvent, payload: DragPayload) => void
  onDropNode: (event: React.DragEvent, collectionId: string, node: TreeNode, parentId: string | null, index: number) => void
  onDragOverNode: (event: React.DragEvent, collectionId: string, node: TreeNode) => void
  onClearDrop: () => void
}) {
  const isFolder = node.type === 'folder'
  const isOpen = isFolder && openIds.has(node.id)
  const isInvalidDrop = dragPayload?.type === 'node' && (dragPayload.nodeId === node.id || (dragPayload.nodeType === 'folder' && containsNode(node, dragPayload.nodeId)))
  const target = dropTarget?.id === node.id ? dropTarget.position : null

  return (
    <div>
      <div
        draggable
        onDragStart={(event) => onDragStartNode(event, { type: 'node', collectionId: collection.id, nodeId: node.id, nodeType: node.type })}
        onDragOver={(event) => onDragOverNode(event, collection.id, node)}
        onDrop={(event) => onDropNode(event, collection.id, node, parentId, index)}
        onDragLeave={onClearDrop}
        onDragEnd={onClearDrop}
        onClick={() => (isFolder ? onToggle(node.id) : onOpenRequest(node as RequestItem, collection.id))}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onContext(isFolder ? { kind: 'folder', collectionId: collection.id, node: node as FolderItem, x: event.clientX, y: event.clientY } : { kind: 'request', collectionId: collection.id, node: node as RequestItem, x: event.clientX, y: event.clientY })
        }}
        className={cn(
          'group relative flex h-7 items-center gap-1 rounded px-1 text-xs transition-colors',
          activeRequestId === node.id ? 'bg-accent/10 text-text-1' : 'text-text-2 hover:bg-surface-2',
          target === 'inside' && !isInvalidDrop && 'ring-1 ring-accent/70 bg-accent/10',
          isInvalidDrop && target && 'ring-1 ring-error/60 bg-error/8',
        )}
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        {target === 'before' && <span className="absolute left-1 right-1 top-0 h-0.5 rounded bg-accent" />}
        {target === 'after' && <span className="absolute bottom-0 left-1 right-1 h-0.5 rounded bg-accent" />}
        <GripVertical size={10} className="shrink-0 cursor-grab text-text-4 opacity-0 group-hover:opacity-60" />
        {isFolder ? (
          <>
            <ChevronRight size={12} className={cn('shrink-0 text-text-4 transition-transform', isOpen && 'rotate-90')} />
            <Folder size={13} className="shrink-0 text-accent" />
          </>
        ) : (
          <span className={cn('w-9 shrink-0 text-[9px] font-bold', METHOD_COLORS[(node as RequestItem).method] ?? 'text-text-3')}>{(node as RequestItem).method}</span>
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
              onToggle={onToggle}
              onOpenRequest={onOpenRequest}
              onSetEditing={onSetEditing}
              onCommitRename={onCommitRename}
              onContext={onContext}
              onDragStartNode={onDragStartNode}
              onDropNode={onDropNode}
              onDragOverNode={onDragOverNode}
              onClearDrop={onClearDrop}
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
  onReorderCollections,
  onMoveNode,
}: CollectionTreeProps) {
  const [query, setQuery] = useState('')
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(collections.map((c) => c.id)))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [folderPrompt, setFolderPrompt] = useState<{ collectionId: string; parentId: string | null } | null>(null)
  const [moveTarget, setMoveTarget] = useState<{ collectionId: string; requestId: string; folders: FolderItem[] } | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ContextTarget | null>(null)
  const [context, setContext] = useState<ContextTarget | null>(null)
  const [dragPayload, setDragPayload] = useState<DragPayload | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; position: DropPosition } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

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

  const filtered = useMemo(() => {
    if (!query.trim()) return collections
    return collections
      .map((collection) => ({ ...collection, children: filterTree(collection.children, query) }))
      .filter((collection) => collection.name.toLowerCase().includes(query.toLowerCase()) || collection.children.length)
  }, [collections, query])

  const toggle = (id: string) => {
    setOpenIds((current) => {
      const next = new Set(current)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
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
      {(['adomnia', 'postman', 'insomnia', 'bruno'] as ExportFormat[]).map((format) => (
        <MenuButton
          key={format}
          onClick={() => target.kind === 'collection' ? exportCollection(target.collection, format) : exportNode(target.collectionId, target.node, format)}
        >
          <Download size={12} /> Export {format}
        </MenuButton>
      ))}
    </div>
  )

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-border-1 px-2 py-2">
        <span className="flex-1 text-[10px] font-semibold uppercase tracking-wider text-text-3">Collections</span>
        <input ref={fileInputRef} type="file" accept=".json,.yaml,.yml,.bru" className="hidden" onChange={(event) => void handleImport(event.target.files?.[0])} />
        <button onClick={() => fileInputRef.current?.click()} title="Import Postman, Insomnia, Bruno, adOmnia or OpenAPI" className="grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-2 hover:text-text-1">
          <Upload size={14} />
        </button>
        <button onClick={() => exportAll('adomnia')} title="Export all collections" className="grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-2 hover:text-text-1">
          <Download size={14} />
        </button>
        <button onClick={() => onNewRequest()} title="New request" className="grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-2 hover:text-text-1">
          <Plus size={14} />
        </button>
        <button onClick={onAddCollection} title="New collection" className="grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-2 hover:text-text-1">
          <FolderPlus size={14} />
        </button>
      </div>

      <div className="px-2 py-1.5">
        <div className="flex h-7 items-center gap-1.5 rounded border border-border-2 bg-surface-2 px-2">
          <Search size={12} className="text-text-4" />
          <input className="flex-1 bg-transparent text-xs text-text-1 outline-none placeholder:text-text-4" placeholder="Search requests..." value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-1 pb-2">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <p className="text-xs text-text-4">No collections yet</p>
            <button onClick={onAddCollection} className="text-xs text-accent hover:text-accent-light">Create collection</button>
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
              onClick={() => toggle(collection.id)}
              onContextMenu={(event) => {
                event.preventDefault()
                setContext({ kind: 'collection', collection, x: event.clientX, y: event.clientY })
              }}
              className={cn(
                'group relative flex h-7 cursor-pointer items-center gap-1 rounded px-1 text-xs font-medium text-text-1 hover:bg-surface-2',
                dropTarget?.id === collection.id && dragPayload?.type === 'node' && 'ring-1 ring-accent/70 bg-accent/10',
              )}
            >
              {collection.color && <span className="absolute bottom-0.5 left-0 top-0.5 w-[2px] rounded-r" style={{ backgroundColor: collection.color }} />}
              <GripVertical size={11} className="shrink-0 cursor-grab text-text-4 opacity-0 group-hover:opacity-60" />
              <ChevronRight size={12} className={cn('shrink-0 text-text-4 transition-transform', openIds.has(collection.id) && 'rotate-90')} />
              <Folder size={13} className="shrink-0 text-accent" style={collection.color ? { color: collection.color } : undefined} />
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
                onToggle={toggle}
                onOpenRequest={onOpenRequest}
                onSetEditing={setEditingId}
                onCommitRename={onRenameNode}
                onContext={setContext}
                onDragStartNode={startDrag}
                onDropNode={handleNodeDrop}
                onDragOverNode={handleNodeDragOver}
                onClearDrop={clearDrop}
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
        <span>{collections.reduce((count, collection) => count + countRequests(collection.children), 0)} requests</span>
      </div>

      {context && (
        <div ref={menuRef} className="fixed z-50 w-52 rounded-md border border-border-1 bg-surface-1 py-1 shadow-xl" style={{ left: context.x, top: context.y }}>
          {context.kind === 'collection' && (
            <>
              <MenuButton onClick={() => { setEditingId(context.collection.id); setContext(null) }}><Copy size={12} /> Rename</MenuButton>
              <MenuButton onClick={() => { onImportCollection(cloneCollection(context.collection)); setContext(null) }}><Copy size={12} /> Duplicate</MenuButton>
              <MenuButton onClick={() => { setFolderPrompt({ collectionId: context.collection.id, parentId: null }); setContext(null) }}><FolderPlus size={12} /> New Folder</MenuButton>
              <MenuButton onClick={() => { onAddRequestToFolder(context.collection.id, null); setContext(null) }}><Plus size={12} /> New Request</MenuButton>
              {contextExportMenu(context)}
              <MenuButton danger onClick={() => { setDeleteTarget(context); setContext(null) }}><Trash2 size={12} /> Delete</MenuButton>
            </>
          )}
          {context.kind === 'folder' && (
            <>
              <MenuButton onClick={() => { setEditingId(context.node.id); setContext(null) }}><Copy size={12} /> Rename</MenuButton>
              <MenuButton onClick={() => { onDuplicateNode(context.collectionId, context.node.id); setContext(null) }}><Copy size={12} /> Duplicate</MenuButton>
              <MenuButton onClick={() => { setFolderPrompt({ collectionId: context.collectionId, parentId: context.node.id }); setContext(null) }}><FolderPlus size={12} /> New Subfolder</MenuButton>
              <MenuButton onClick={() => { onAddRequestToFolder(context.collectionId, context.node.id); setContext(null) }}><Plus size={12} /> New Request</MenuButton>
              {contextExportMenu(context)}
              <MenuButton danger onClick={() => { setDeleteTarget(context); setContext(null) }}><Trash2 size={12} /> Delete</MenuButton>
            </>
          )}
          {context.kind === 'request' && (
            <>
              <MenuButton onClick={() => { setEditingId(context.node.id); setContext(null) }}><Copy size={12} /> Rename</MenuButton>
              <MenuButton onClick={() => { onDuplicateRequest(context.collectionId, context.node); setContext(null) }}><Copy size={12} /> Duplicate</MenuButton>
              <MenuButton onClick={() => openMoveDialog(context.collectionId, context.node.id)}><FolderPlus size={12} /> Move to Folder</MenuButton>
              <MenuButton onClick={() => { void copyToClipboard(generateCode(context.node, 'curl')); setContext(null) }}><Code size={12} /> Copy as cURL</MenuButton>
              <MenuButton onClick={() => { void copyToClipboard(context.node.url); setContext(null) }}><Link size={12} /> Copy URL</MenuButton>
              <MenuButton onClick={() => { onOpenRequest(context.node, context.collectionId); setContext(null) }}><Plus size={12} /> Open in New Tab</MenuButton>
              {contextExportMenu(context)}
              <MenuButton danger onClick={() => { setDeleteTarget(context); setContext(null) }}><Trash2 size={12} /> Delete</MenuButton>
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
        title="New Folder"
        placeholder="Folder name..."
        confirmLabel="Create"
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
        title={deleteTarget?.kind === 'collection' ? 'Delete collection?' : deleteTarget?.kind === 'folder' ? 'Delete folder?' : 'Delete request?'}
        message={
          deleteTarget?.kind === 'collection'
            ? `Are you sure you want to delete "${deleteTarget.collection.name}"? All nested folders and requests will be deleted.`
            : deleteTarget?.kind === 'folder'
              ? `Are you sure you want to delete "${deleteTarget.node.name}"? All nested requests and subfolders will be deleted.`
              : deleteTarget
                ? `Are you sure you want to delete "${deleteTarget.node.name}"?`
                : ''
        }
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          if (!deleteTarget) return
          if (deleteTarget.kind === 'collection') onDeleteCollection(deleteTarget.collection.id)
          else onDeleteNode(deleteTarget.collectionId, deleteTarget.node.id)
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
