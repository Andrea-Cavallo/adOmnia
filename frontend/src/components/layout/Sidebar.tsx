import { useState } from 'react'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { useCollectionsStore } from '@/stores/collections'
import { useTabsStore } from '@/stores/tabs'
import { CollectionTree } from '@/components/collections/CollectionTree'
import { blankRequest, uid } from '@/lib/types'
import type { HttpMethod, RequestItem } from '@/lib/types'
import { Prompt } from '@/components/ui/prompt'

export function Sidebar() {
  const activeRail = useAppStore((s) => s.activeRail)
  const collapsed = useSettingsStore((s) => s.settings.appearance.sidebarCollapsed)
  const collections = useCollectionsStore((s) => s.collections)
  const addCollection = useCollectionsStore((s) => s.addCollection)
  const deleteCollection = useCollectionsStore((s) => s.deleteCollection)
  const deleteNode = useCollectionsStore((s) => s.deleteNode)
  const renameCollection = useCollectionsStore((s) => s.renameCollection)
  const renameNode = useCollectionsStore((s) => s.renameNode)
  const addFolder = useCollectionsStore((s) => s.addFolder)
  const addRequest = useCollectionsStore((s) => s.addRequest)
  const importCollection = useCollectionsStore((s) => s.importCollection)
  const reorderCollections = useCollectionsStore((s) => s.reorderCollections)
  const moveNode = useCollectionsStore((s) => s.moveNode)
  const duplicateNode = useCollectionsStore((s) => s.duplicateNode)
  const openTab = useTabsStore((s) => s.openTab)
  const newTab = useTabsStore((s) => s.newTab)
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const tabs = useTabsStore((s) => s.tabs)
  const [showAddCollection, setShowAddCollection] = useState(false)

  if (collapsed || activeRail !== 'collections') return null

  const activeRequestId = tabs.find((t) => t.id === activeTabId)?.request.id ?? null

  const handleDuplicateRequest = (collectionId: string, request: RequestItem) => {
    const dupe: RequestItem = { ...request, id: uid(), name: `${request.name} (copy)` }
    addRequest(collectionId, null, dupe)
  }

  const handleAddRequestToFolder = (collectionId: string, parentId: string | null, method: HttpMethod = 'GET') => {
    const req = blankRequest(method, 'New Request')
    addRequest(collectionId, parentId, req)
    openTab(req, collectionId)
  }

  return (
    <aside className="w-full flex-shrink-0 bg-surface-0 border-r border-border-1 flex flex-col">
      <CollectionTree
        collections={collections}
        activeRequestId={activeRequestId}
        onOpenRequest={(request: RequestItem, collectionId: string) => openTab(request, collectionId)}
        onNewRequest={() => newTab()}
        onDeleteCollection={deleteCollection}
        onDeleteNode={deleteNode}
        onAddCollection={() => setShowAddCollection(true)}
        onRenameCollection={renameCollection}
        onRenameNode={renameNode}
        onAddFolder={(collectionId, parentId, name) => addFolder(collectionId, parentId, name)}
        onDuplicateRequest={handleDuplicateRequest}
        onDuplicateNode={duplicateNode}
        onAddRequestToFolder={handleAddRequestToFolder}
        onImportCollection={importCollection}
        onReorderCollections={reorderCollections}
        onMoveNode={moveNode}
      />

      <Prompt
        open={showAddCollection}
        title="New Collection"
        placeholder="Collection name…"
        confirmLabel="Create"
        onConfirm={(name) => {
          addCollection(name)
          setShowAddCollection(false)
        }}
        onCancel={() => setShowAddCollection(false)}
      />
    </aside>
  )
}
