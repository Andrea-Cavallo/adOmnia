import { useEffect, useRef, useState } from 'react'
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
import { useUiTranslation } from '@/lib/uiI18n'
import { useWorkspaceHydration, useWorkspaceHydrationShell } from '@/hooks/useWorkspaceHydration'
import { WorkspaceSidebarSkeleton } from '@/components/layout/WorkspaceHydrationShell'

export function Sidebar() {
  const tr = useUiTranslation()
  const workspaceHydrated = useWorkspaceHydration()
  const workspaceShellPhase = useWorkspaceHydrationShell(workspaceHydrated)
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
  const addQuickRequest = useCollectionsStore((s) => s.addQuickRequest)
  const importCollection = useCollectionsStore((s) => s.importCollection)
  const reorderCollections = useCollectionsStore((s) => s.reorderCollections)
  const moveNode = useCollectionsStore((s) => s.moveNode)
  const duplicateNode = useCollectionsStore((s) => s.duplicateNode)
  const openTab = useTabsStore((s) => s.openTab)
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
  const setEnvironmentPrivate = useEnvironmentsStore((s) => s.setEnvironmentPrivate)
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

  const handleNewRequest = (method: HttpMethod = 'GET'): string => {
    const request = blankRequest(method, 'New Request')
    const collectionId = addQuickRequest(request)
    openTab(request, collectionId)
    return collectionId
  }

  if (collapsed || activeRail !== 'collections') return null
  if (workspaceShellPhase !== 'ready') {
    return <WorkspaceSidebarSkeleton quiet={workspaceShellPhase === 'quiet'} />
  }

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
    void setActiveWorkspace(workspaceId).then((changed) => {
      if (changed) activateWorkspace(workspaceId)
    })
  }

  const handleMoveCollection = (collectionId: string, workspaceId: string) => {
    void moveCollectionToWorkspace(collectionId, workspaceId).then((moved) => {
      if (moved) moveCollectionTabs(collectionId, workspaceId)
    })
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
      <div data-sidebar-context className="flex h-10 flex-shrink-0 items-center gap-1 border-b border-border-1 bg-surface-1/55 px-2 py-1.5">
        <WorkspaceContextButton
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          onSwitch={handleSwitchWorkspace}
          onAdd={() => setShowAddWorkspace(true)}
          onRename={() => setShowRenameWorkspace(true)}
          onDelete={() => setShowDeleteWorkspace(true)}
        />
        <EnvBar
          compact
          environments={environments}
          activeEnvId={activeEnvId}
          onSetActive={setActiveEnv}
          onAdd={(name) => addEnvironment(name)}
          onDelete={deleteEnvironment}
          onRename={renameEnvironment}
          onUpdateVars={updateVariables}
          onSetPrivate={setEnvironmentPrivate}
        />
        <HostBar
          compact
          profiles={hostsProfiles}
          activeProfileId={activeHostProfileId}
          onSetActive={setActiveHostProfile}
          onAdd={(name) => addHostProfile(name)}
          onDelete={deleteHostProfile}
          onRename={renameHostProfile}
          onUpdateEntries={updateHostEntries}
        />
      </div>

      <CollectionTree
        key={activeWorkspaceId}
        collections={collections}
        activeRequestId={activeRequestId}
        onOpenRequest={(request: RequestItem, collectionId: string, preview?: boolean) => openTab(request, collectionId, preview)}
        onNewRequest={handleNewRequest}
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
        title={tr('New Collection')}
        placeholder={tr('Collection name…')}
        confirmLabel={tr('Create')}
        onConfirm={(name) => {
          addCollection(name)
          setShowAddCollection(false)
        }}
        onCancel={() => setShowAddCollection(false)}
      />

      <Prompt
        open={showAddWorkspace}
        title={tr('New Workspace')}
        description={tr('Create an isolated local space for collections, environments and open requests.')}
        placeholder={tr('e.g. Payments Platform')}
        confirmLabel={tr('Create')}
        onConfirm={(name) => {
          const workspace = addWorkspace(name)
          handleSwitchWorkspace(workspace.id)
          setShowAddWorkspace(false)
        }}
        onCancel={() => setShowAddWorkspace(false)}
      />

      <Prompt
        open={showRenameWorkspace}
        title={tr('Rename Workspace')}
        defaultValue={activeWorkspace?.name ?? ''}
        placeholder={tr('Workspace name...')}
        confirmLabel={tr('Rename')}
        onConfirm={(name) => {
          renameWorkspace(activeWorkspaceId, name)
          setShowRenameWorkspace(false)
        }}
        onCancel={() => setShowRenameWorkspace(false)}
      />

      <ConfirmDialog
        open={showDeleteWorkspace}
        title={tr('Delete workspace?')}
        message={`"${activeWorkspace?.name ?? tr('this workspace')}": ${tr('Delete this workspace and all its local data? This cannot be undone.')} (${collections.length} ${tr('collections')}, ${workspaceTabs.length} ${tr('open tabs')}${dirtyWorkspaceTabs ? `, ${dirtyWorkspaceTabs} ${tr('with unsaved changes')}` : ''})`}
        confirmLabel={tr('Delete')}
        variant="danger"
        onConfirm={() => {
          const deletedId = activeWorkspaceId
          setShowDeleteWorkspace(false)
          void deleteWorkspace(deletedId).then((nextWorkspaceId) => {
            if (!nextWorkspaceId) return
            deleteWorkspaceTabs(deletedId)
            activateWorkspace(nextWorkspaceId)
          })
        }}
        onCancel={() => setShowDeleteWorkspace(false)}
      />
    </aside>
  )
}

interface WorkspaceContextButtonProps {
  workspaces: Array<{ id: string; name: string }>
  activeWorkspaceId: string
  onSwitch: (workspaceId: string) => void
  onAdd: () => void
  onRename: () => void
  onDelete: () => void
}

function WorkspaceContextButton({
  workspaces,
  activeWorkspaceId,
  onSwitch,
  onAdd,
  onRename,
  onDelete,
}: WorkspaceContextButtonProps) {
  const tr = useUiTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div ref={ref} className="relative min-w-0 flex-[1.15]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${tr('Workspace')}: ${activeWorkspace?.name ?? tr('Unknown')}`}
        className={cn(
          'flex h-7 w-full min-w-0 items-center gap-1 rounded border border-border-2 bg-surface-2 px-1.5 text-[11px] text-text-1 outline-none transition-colors',
          'hover:border-border-3 hover:bg-surface-3',
          open && 'border-accent'
        )}
      >
        <FolderKanban size={11} className="shrink-0 text-accent" />
        <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-text-4">{tr('Workspace')}</span>
        <span className="min-w-0 flex-1 truncate text-left font-medium">{activeWorkspace?.name ?? tr('Unknown')}</span>
        <ChevronDown size={11} className={cn('shrink-0 text-text-4 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div role="menu" className="absolute left-0 top-full z-50 mt-1 min-w-full w-max max-w-64 overflow-hidden rounded-md border border-border-2 bg-surface-2 py-0.5 shadow-xl">
          <div className="max-h-52 overflow-y-auto">
            {workspaces.map((workspace) => (
              <button
                key={workspace.id}
                type="button"
                role="menuitem"
                onClick={() => { onSwitch(workspace.id); setOpen(false) }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
                  workspace.id === activeWorkspaceId ? 'bg-surface-3 text-text-1' : 'text-text-2 hover:bg-surface-3 hover:text-text-1'
                )}
              >
                <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', workspace.id === activeWorkspaceId ? 'bg-accent' : 'bg-transparent')} />
                <span className="truncate">{workspace.name}</span>
              </button>
            ))}
          </div>
          <div className="mt-0.5 flex border-t border-border-1 p-1">
            <button type="button" role="menuitem" onClick={() => { onAdd(); setOpen(false) }} title={tr('New workspace')} className="grid h-7 flex-1 place-items-center rounded text-text-3 transition-colors hover:bg-surface-3 hover:text-text-1">
              <Plus size={12} />
            </button>
            <button type="button" role="menuitem" onClick={() => { onRename(); setOpen(false) }} title={tr('Rename workspace')} className="grid h-7 flex-1 place-items-center rounded text-text-3 transition-colors hover:bg-surface-3 hover:text-text-1">
              <Pencil size={11} />
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => { onDelete(); setOpen(false) }}
              disabled={workspaces.length <= 1}
              title={workspaces.length <= 1 ? tr('At least one workspace is required') : tr('Delete workspace')}
              className={cn('grid h-7 flex-1 place-items-center rounded text-text-3 transition-colors hover:bg-error/10 hover:text-error', workspaces.length <= 1 && 'cursor-not-allowed opacity-35')}
            >
              <Trash2 size={11} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
