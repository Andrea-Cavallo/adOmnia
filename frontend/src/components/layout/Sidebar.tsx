import { useState } from 'react'
import { ChevronDown, FolderKanban, Pencil, Plus, Trash2 } from 'lucide-react'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { useCollectionsStore, findParentInfo } from '@/stores/collections'
import { useTabsStore } from '@/stores/tabs'
import { useEnvironmentsStore } from '@/stores/environments'
import { useHostsStore } from '@/stores/hosts'
import { EnvBar } from '@/components/environment/EnvBar'
import { HostBar } from '@/components/hosts/HostBar'
import { CollectionTree } from '@/components/collections/CollectionTree'
import { blankRequest, uid } from '@/lib/types'
import type { HttpMethod, RequestItem } from '@/lib/types'
import { Prompt } from '@/components/ui/prompt'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'

export function Sidebar() {
  const activeRail = useAppStore((s) => s.activeRail)
  const collapsed = useSettingsStore((s) => s.settings.appearance.sidebarCollapsed)
  const collections = useCollectionsStore((s) => s.collections)
  const workspaces = useCollectionsStore((s) => s.workspaces)
  const activeWorkspaceId = useCollectionsStore((s) => s.activeWorkspaceId)
  const addWorkspace = useCollectionsStore((s) => s.addWorkspace)
  const renameWorkspace = useCollectionsStore((s) => s.renameWorkspace)
  const deleteWorkspace = useCollectionsStore((s) => s.deleteWorkspace)
  const setActiveWorkspace = useCollectionsStore((s) => s.setActiveWorkspace)
  const moveCollectionToWorkspace = useCollectionsStore((s) => s.moveCollectionToWorkspace)
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
  const closeRequestTabs = useTabsStore((s) => s.closeRequestTabs)
  const renameRequestTabs = useTabsStore((s) => s.renameRequestTabs)
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const tabs = useTabsStore((s) => s.tabs)
  const activateWorkspace = useTabsStore((s) => s.activateWorkspace)
  const deleteWorkspaceTabs = useTabsStore((s) => s.deleteWorkspaceTabs)
  const moveCollectionTabs = useTabsStore((s) => s.moveCollectionTabs)

  const environments = useEnvironmentsStore((s) => s.environments)
  const activeEnvId = useEnvironmentsStore((s) => s.activeEnvId)
  const setActiveEnv = useEnvironmentsStore((s) => s.setActiveEnv)
  const addEnvironment = useEnvironmentsStore((s) => s.addEnvironment)
  const deleteEnvironment = useEnvironmentsStore((s) => s.deleteEnvironment)
  const renameEnvironment = useEnvironmentsStore((s) => s.renameEnvironment)
  const updateVariables = useEnvironmentsStore((s) => s.updateVariables)

  const hostsProfiles = useHostsStore((s) => s.profiles)
  const activeHostProfileId = useHostsStore((s) => s.activeProfileId)
  const setActiveHostProfile = useHostsStore((s) => s.setActiveProfile)
  const addHostProfile = useHostsStore((s) => s.addProfile)
  const deleteHostProfile = useHostsStore((s) => s.deleteProfile)
  const renameHostProfile = useHostsStore((s) => s.renameProfile)
  const updateHostEntries = useHostsStore((s) => s.updateEntries)

  const [showAddCollection, setShowAddCollection] = useState(false)
  const [showAddWorkspace, setShowAddWorkspace] = useState(false)
  const [showRenameWorkspace, setShowRenameWorkspace] = useState(false)
  const [showDeleteWorkspace, setShowDeleteWorkspace] = useState(false)

  if (collapsed || activeRail !== 'collections') return null

  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId)
  const workspaceTabs = tabs.filter((tab) => (tab.workspaceId ?? activeWorkspaceId) === activeWorkspaceId)
  const dirtyWorkspaceTabs = workspaceTabs.filter((tab) => tab.dirty).length
  const activeRequestId = tabs.find((t) => t.id === activeTabId && (t.workspaceId ?? activeWorkspaceId) === activeWorkspaceId)?.request.id ?? null

  const handleDuplicateRequest = (collectionId: string, request: RequestItem) => {
    const col = collections.find((c) => c.id === collectionId)
    const parentInfo = col ? findParentInfo(col.children, request.id) : null
    const parentId = parentInfo?.parentId ?? null
    const dupe: RequestItem = { ...request, id: uid(), name: `${request.name} (copy)` }
    addRequest(collectionId, parentId, dupe)
  }

  const handleAddRequestToFolder = (collectionId: string, parentId: string | null, method: HttpMethod = 'GET'): string | null => {
    const req = blankRequest(method, 'New Request')
    addRequest(collectionId, parentId, req)
    openTab(req, collectionId)
    return parentId
  }

  const handleSwitchWorkspace = (workspaceId: string) => {
    setActiveWorkspace(workspaceId)
    activateWorkspace(workspaceId)
  }

  const handleMoveCollection = (collectionId: string, workspaceId: string) => {
    moveCollectionToWorkspace(collectionId, workspaceId)
    moveCollectionTabs(collectionId, workspaceId)
  }

  const handleDeleteNode = (collectionId: string, nodeId: string) => {
    deleteNode(collectionId, nodeId)
    closeRequestTabs(nodeId)
  }

  const handleRenameNode = (collectionId: string, nodeId: string, name: string) => {
    renameNode(collectionId, nodeId, name)
    renameRequestTabs(nodeId, name)
  }

  return (
    <aside className="h-full min-h-0 w-full flex-shrink-0 bg-surface-0 border-r border-border-1 flex flex-col">
      <div className="border-b border-border-1 bg-surface-1/55 px-2 py-2">
        <div className="mb-1.5 flex items-center gap-2 px-1">
          <FolderKanban size={12} className="text-accent" />
          <span className="min-w-0 flex-1 truncate text-[9px] font-semibold uppercase tracking-[0.14em] text-text-4">Workspace</span>
          <span className="text-[9px] text-text-4">{collections.length} collections</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="relative min-w-0 flex-1">
            <select
              value={activeWorkspaceId}
              onChange={(event) => handleSwitchWorkspace(event.target.value)}
              className="h-8 w-full appearance-none truncate rounded-md border border-border-2 bg-surface-2 pl-2.5 pr-7 text-xs font-medium text-text-1 outline-none transition-colors hover:border-accent/40 focus:border-accent"
              title="Active workspace"
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
              ))}
            </select>
            <ChevronDown size={12} className="pointer-events-none absolute right-2 top-2 text-text-4" />
          </div>
          <button onClick={() => setShowAddWorkspace(true)} title="New workspace" className="grid h-8 w-7 place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text-1">
            <Plus size={13} />
          </button>
          <button onClick={() => setShowRenameWorkspace(true)} title="Rename workspace" className="grid h-8 w-7 place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text-1">
            <Pencil size={12} />
          </button>
          <button
            onClick={() => setShowDeleteWorkspace(true)}
            disabled={workspaces.length <= 1}
            title={workspaces.length <= 1 ? 'At least one workspace is required' : 'Delete workspace'}
            className={cn('grid h-8 w-7 place-items-center rounded-md text-text-3 hover:bg-error/10 hover:text-error', workspaces.length <= 1 && 'cursor-not-allowed opacity-35')}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      <EnvBar
        environments={environments}
        activeEnvId={activeEnvId}
        onSetActive={setActiveEnv}
        onAdd={(name) => addEnvironment(name)}
        onDelete={deleteEnvironment}
        onRename={renameEnvironment}
        onUpdateVars={updateVariables}
      />
      <HostBar
        profiles={hostsProfiles}
        activeProfileId={activeHostProfileId}
        onSetActive={setActiveHostProfile}
        onAdd={(name) => addHostProfile(name)}
        onDelete={deleteHostProfile}
        onRename={renameHostProfile}
        onUpdateEntries={updateHostEntries}
      />

      <CollectionTree
        collections={collections}
        activeRequestId={activeRequestId}
        onOpenRequest={(request: RequestItem, collectionId: string) => openTab(request, collectionId)}
        onNewRequest={() => newTab()}
        onDeleteCollection={deleteCollection}
        onDeleteNode={handleDeleteNode}
        onAddCollection={() => setShowAddCollection(true)}
        onRenameCollection={renameCollection}
        onRenameNode={handleRenameNode}
        onAddFolder={(collectionId, parentId, name) => addFolder(collectionId, parentId, name)}
        onDuplicateRequest={handleDuplicateRequest}
        onDuplicateNode={duplicateNode}
        onAddRequestToFolder={handleAddRequestToFolder}
        onImportCollection={importCollection}
        workspaceTargets={workspaces.filter((workspace) => workspace.id !== activeWorkspaceId)}
        onMoveCollectionToWorkspace={handleMoveCollection}
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

      <Prompt
        open={showAddWorkspace}
        title="New Workspace"
        placeholder="Workspace name..."
        confirmLabel="Create"
        onConfirm={(name) => {
          const workspace = addWorkspace(name)
          handleSwitchWorkspace(workspace.id)
          setShowAddWorkspace(false)
        }}
        onCancel={() => setShowAddWorkspace(false)}
      />

      <Prompt
        open={showRenameWorkspace}
        title="Rename Workspace"
        defaultValue={activeWorkspace?.name ?? ''}
        placeholder="Workspace name..."
        confirmLabel="Rename"
        onConfirm={(name) => {
          renameWorkspace(activeWorkspaceId, name)
          setShowRenameWorkspace(false)
        }}
        onCancel={() => setShowRenameWorkspace(false)}
      />

      <ConfirmDialog
        open={showDeleteWorkspace}
        title="Delete workspace?"
        message={`Delete "${activeWorkspace?.name ?? 'this workspace'}", its ${collections.length} collection${collections.length === 1 ? '' : 's'} and ${workspaceTabs.length} open tab${workspaceTabs.length === 1 ? '' : 's'}${dirtyWorkspaceTabs ? ` (${dirtyWorkspaceTabs} with unsaved changes)` : ''}? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          const deletedId = activeWorkspaceId
          const nextWorkspaceId = deleteWorkspace(deletedId)
          deleteWorkspaceTabs(deletedId)
          if (nextWorkspaceId) activateWorkspace(nextWorkspaceId)
          setShowDeleteWorkspace(false)
        }}
        onCancel={() => setShowDeleteWorkspace(false)}
      />
    </aside>
  )
}
