import { useMemo, useState } from 'react'
import { Download, Eye, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { safeSelectFolder } from '@/lib/fileUtils'
import { exportCollectionToFolder, exportRequestToFolder, hasCollectionFSBinding, importCollectionFromFolder, inspectCollectionFolder } from '@/lib/collectionfs-api'
import { useCollectionsStore } from '@/stores/collections'
import { useEnvironmentsStore } from '@/stores/environments'
import { useTabsStore } from '@/stores/tabs'

function safeFolderSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'collection'
}

export function collectionFolderPath(repoPath: string, collectionId: string, collectionName: string): string {
  const root = repoPath.replace(/[\\/]+$/, '')
  const leaf = `${safeFolderSegment(collectionName)}-${safeFolderSegment(collectionId)}`
  return `${root}/adomnia-collections/${leaf}`
}

interface CollectionFolderSectionProps {
  /** Repository (or any folder) that receives `adomnia-collections/<name>`. Empty disables export. */
  repoPath: string
  disabled?: boolean
  /** Collection preselected when the section opens (e.g. from a context menu). */
  initialCollectionId?: string
  /** Drops the sidebar-style bottom border and padding when hosted inside a dialog. */
  bare?: boolean
  onBusy?: (busy: boolean) => void
  onResult: (result: { error?: string; info?: string }) => void
  /** Called after a successful action, e.g. to refresh the Git status of `repoPath`. */
  onDone?: () => void
}

/** Collection ⇄ folder export/import/drift check. Independent from Git: any folder works, a repo makes it versionable. */
export function CollectionFolderSection({ repoPath, disabled = false, initialCollectionId = '', bare = false, onBusy, onResult, onDone }: CollectionFolderSectionProps) {
  const environments = useEnvironmentsStore((state) => state.environments)
  const tabs = useTabsStore((state) => state.tabs)
  const activeTabId = useTabsStore((state) => state.activeTabId)
  const collections = useCollectionsStore((state) => state.collections)
  const importCollection = useCollectionsStore((state) => state.importCollection)
  const [selectedCollectionId, setSelectedCollectionId] = useState(initialCollectionId)
  const [busy, setBusy] = useState(false)

  const selectedCollection = useMemo(
    () => collections.find((collection) => collection.id === selectedCollectionId) ?? collections[0] ?? null,
    [collections, selectedCollectionId],
  )
  const activeCollectionRequest = useMemo(() => {
    const tab = tabs.find((candidate) => candidate.id === activeTabId)
    if (!tab || !selectedCollection || tab.tool) return null
    return tab.collectionId === selectedCollection.id ? tab.request : null
  }, [activeTabId, selectedCollection, tabs])
  const targetFolder = useMemo(
    () => repoPath && selectedCollection ? collectionFolderPath(repoPath, selectedCollection.id, selectedCollection.name) : '',
    [repoPath, selectedCollection],
  )

  const run = async (action: () => Promise<string | void>, success: string) => {
    setBusy(true)
    onBusy?.(true)
    try {
      const result = await action()
      onResult({ info: result ?? success })
      onDone?.()
    } catch (err) {
      onResult({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
      onBusy?.(false)
    }
  }

  const exportSelected = () => run(async () => {
    if (!repoPath) throw new Error('Repository path required')
    if (!selectedCollection) throw new Error('Select a collection first')
    await exportCollectionToFolder(targetFolder, selectedCollection, environments)
  }, selectedCollection ? `Exported "${selectedCollection.name}" to adomnia-collections.` : 'Collection exported.')

  const exportRequest = () => run(async () => {
    if (!repoPath || !selectedCollection) throw new Error('Select a collection first')
    if (!activeCollectionRequest) throw new Error('Open a request from the selected collection first')
    return `Exported ${await exportRequestToFolder(targetFolder, activeCollectionRequest)}.`
  }, 'Request exported.')

  const importFolder = () => run(async () => {
    const folder = await safeSelectFolder('Select an adOmnia collection folder')
    if (!folder) return
    const imported = await importCollectionFromFolder(folder)
    const duplicate = useCollectionsStore.getState().collections.some((collection) => collection.name === imported.name)
    importCollection(duplicate
      ? { ...imported, id: `${imported.id}-${Date.now()}`, name: `${imported.name} Import` }
      : imported)
  }, 'Collection folder imported.')

  const inspectFolder = () => run(async () => {
    if (!repoPath) throw new Error('Repository path required')
    if (!selectedCollection) throw new Error('Select a collection first')
    const report = await inspectCollectionFolder(targetFolder, selectedCollection)
    if (!report.inSync) {
      throw new Error(`Folder drift detected: ${report.requestCount} app requests / ${report.folderRequestCount} folder requests.`)
    }
    return `Folder in sync: ${report.requestCount} requests.`
  }, 'Folder in sync.')

  const locked = disabled || busy
  const hasFs = hasCollectionFSBinding()
  const buttonClass = 'flex h-7 items-center justify-center gap-1.5 rounded border border-border-1 text-[11px] text-text-2 hover:bg-surface-2 hover:text-text-1 disabled:opacity-40'

  return (
    <div className={bare ? '' : 'border-b border-border-1 p-3'}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-text-4">Collection Folder</div>
        {targetFolder && (
          <span className="truncate text-[10px] text-text-4" title={targetFolder}>
            {targetFolder.split(/[\\/]/).slice(-2).join('/')}
          </span>
        )}
      </div>
      <select
        value={selectedCollection?.id ?? ''}
        onChange={(event) => setSelectedCollectionId(event.target.value)}
        disabled={!collections.length || locked}
        className="mb-2 h-7 w-full rounded border border-border-1 bg-surface-0 px-2 text-xs text-text-1 outline-none focus:border-accent disabled:opacity-50"
      >
        {collections.length === 0 ? (
          <option value="">No collections</option>
        ) : collections.map((collection) => (
          <option key={collection.id} value={collection.id}>{collection.name}</option>
        ))}
      </select>
      <div className="grid grid-cols-4 gap-1.5">
        <button onClick={exportSelected} disabled={!repoPath || !selectedCollection || !hasFs || locked} className={buttonClass} title={targetFolder || 'Export selected collection'}>
          <Upload size={12} /> Export
        </button>
        <button
          onClick={exportRequest}
          disabled={!repoPath || !selectedCollection || !activeCollectionRequest || !hasFs || locked}
          className={cn(buttonClass, 'gap-1 text-[10px]')}
          title={activeCollectionRequest ? `Export only ${activeCollectionRequest.name}` : 'Open a request from this collection'}
        >
          <Upload size={11} /> Request
        </button>
        <button onClick={importFolder} disabled={!hasFs || locked} className={buttonClass} title="Import collection folder">
          <Download size={12} /> Import
        </button>
        <button onClick={inspectFolder} disabled={!repoPath || !selectedCollection || !hasFs || locked} className={buttonClass} title={targetFolder || 'Inspect collection folder'}>
          <Eye size={12} /> Drift
        </button>
      </div>
    </div>
  )
}
