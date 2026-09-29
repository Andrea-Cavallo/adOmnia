import { useCallback, useEffect, useMemo, useState, memo } from 'react'
import { ChevronDown, ChevronRight, Copy, Eye, EyeOff, FileCode2, Folder, FolderOpen, KeyRound, Loader2, Minus, Send } from 'lucide-react'
import { useGoIDEStore } from '@/stores/goide'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { BrandIcon, GoStudioFileIcon } from './GoStudioFileIcon'
import { resolveGoStudioFolderBrand } from './goStudioFileIcons'
import type { GoIDEFileEntry, GoIDESession } from '@/lib/goide-api'
import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu'
import { isApiCollectionCandidate, isPemCandidate, openPemInPowerTools, sendFileToApiWorkspace } from './goStudioFileHandoffs'

type TreeContextHandler = (entry: GoIDEFileEntry, x: number, y: number) => void

interface GoStudioProjectTreeProps {
  session: GoIDESession
  /** Percorso relativo del file attivo nell'editor, evidenziato nell'albero. */
  activePath: string | null
}

const ROW_INDENT_PX = 16
const ROW_BASE_PX = 8

const emptyEntries: GoIDEFileEntry[] = []

function FolderIcon({ name, open }: { name: string; open: boolean }) {
  const brand = resolveGoStudioFolderBrand(name)
  if (brand) return <BrandIcon slug={brand} size={14} />
  return open ? <FolderOpen size={15} className="shrink-0 text-text-3" /> : <Folder size={15} className="shrink-0 text-text-3" />
}

/** Memoizzato: aprire o aggiornare una cartella non ridisegna le sorelle (progetti con centinaia di cartelle). */
const DirectoryNode = memo(function DirectoryNode({ sessionId, entry, depth, activePath, onContext }: { sessionId: string; entry: GoIDEFileEntry; depth: number; activePath: string | null; onContext: TreeContextHandler }) {
  const selected = !entry.directory && entry.relativePath === activePath
  const [open, setOpen] = useState(false)
  const entries = useGoIDEStore((state) => state.directoryEntries[sessionId]?.[entry.relativePath])
  const loading = useGoIDEStore((state) => state.directoryLoading[`${sessionId}:${entry.relativePath}`] ?? false)
  const loadDirectory = useGoIDEStore((state) => state.loadDirectory)
  const openDocument = useGoIDEStore((state) => state.openDocument)

  // Ricarica i figli anche quando la cache viene svuotata (es. toggle delle cartelle ignorate).
  useEffect(() => {
    if (open && entry.directory && !entries && !loading) void loadDirectory(entry.relativePath)
  }, [entries, entry.directory, entry.relativePath, loadDirectory, loading, open])

  return (
    <>
      <button
        type="button"
        onClick={entry.directory ? () => setOpen((value) => !value) : () => void openDocument(entry.relativePath, { preview: useGoIDELspStore.getState().preferences.previewTab })}
        onDoubleClick={entry.directory ? undefined : () => void openDocument(entry.relativePath)}
        onContextMenu={entry.directory ? undefined : (event) => { event.preventDefault(); onContext(entry, event.clientX, event.clientY) }}
        aria-current={selected ? 'true' : undefined}
        className={`flex h-[26px] w-full items-center gap-1.5 overflow-hidden rounded-[7px] pr-2 text-left text-[12.5px] ${selected ? 'go-studio-tree-row-selected' : `hover:bg-surface-3 hover:text-text-1 ${entry.ignored ? 'text-text-4' : 'text-text-2'}`}`}
        style={{ paddingLeft: ROW_BASE_PX + (depth - 1) * ROW_INDENT_PX }}
        title={entry.ignored ? `${entry.relativePath} (ignored by default)` : entry.relativePath}
      >
        {entry.directory
          ? loading ? <Loader2 size={12} className="shrink-0 animate-spin text-text-4" /> : open ? <ChevronDown size={12} className="shrink-0 text-text-3" /> : <ChevronRight size={12} className="shrink-0 text-text-4" />
          : <span className="w-3 shrink-0" />}
        {entry.directory
          ? <FolderIcon name={entry.name} open={open} />
          : <GoStudioFileIcon name={entry.name} relativePath={entry.relativePath} />}
        <span className="truncate">{entry.name}</span>
      </button>
      {entry.directory && open && entries?.map((child) => (
        <DirectoryNode key={child.relativePath} sessionId={sessionId} entry={child} depth={depth + 1} activePath={activePath} onContext={onContext} />
      ))}
    </>
  )
})

/** Memoizzato: il pannello genitore si ridisegna a ogni tasto, questo solo quando cambia la sessione. */
export const GoStudioProjectTree = memo(function GoStudioProjectTree({ session, activePath }: GoStudioProjectTreeProps) {
  const entries = useGoIDEStore((state) => state.directoryEntries[session.id]?.[''] ?? emptyEntries)
  const loadDirectory = useGoIDEStore((state) => state.loadDirectory)
  const showIgnored = useGoIDEStore((state) => state.showIgnoredBySession[session.id] ?? false)
  const toggleShowIgnored = useGoIDEStore((state) => state.toggleShowIgnored)
  const rootKey = useMemo(() => `${session.id}:${session.project.realPath}`, [session.id, session.project.realPath])

  useEffect(() => { void loadDirectory('') }, [loadDirectory, rootKey])

  const openDocument = useGoIDEStore((state) => state.openDocument)
  const updateLayout = useGoIDEStore((state) => state.updateLayout)
  const [menu, setMenu] = useState<{ entry: GoIDEFileEntry; x: number; y: number } | null>(null)
  const onContext = useCallback<TreeContextHandler>((entry, x, y) => setMenu({ entry, x, y }), [])
  const menuItems = (entry: GoIDEFileEntry): ContextMenuItem[] => [
    { id: 'open', label: 'Open', icon: FileCode2 },
    ...(isApiCollectionCandidate(entry.relativePath) ? [{ id: 'sendToApi', label: 'Send to API Workspace', icon: Send, separatorBefore: true }] : []),
    ...(isPemCandidate(entry.relativePath) ? [{ id: 'pemTools', label: 'Open in Power Tools: Inspect / Encrypt Key', icon: KeyRound, separatorBefore: true }] : []),
    { id: 'copyPath', label: 'Copy Relative Path', icon: Copy, separatorBefore: true },
  ]
  const selectMenuItem = (id: string) => {
    const entry = menu?.entry
    setMenu(null)
    if (!entry) return
    if (id === 'open') void openDocument(entry.relativePath)
    if (id === 'sendToApi') void sendFileToApiWorkspace(session.id, entry.relativePath)
    if (id === 'pemTools') void openPemInPowerTools(session.id, entry.relativePath)
    if (id === 'copyPath') void navigator.clipboard?.writeText(entry.relativePath)
  }

  return (
    <aside aria-label="Project files" className="flex h-full min-w-0 flex-col">
      <div className="go-studio-tool-header">
        <span className="go-studio-tool-title">Project</span>
        <button
          type="button"
          onClick={() => void toggleShowIgnored()}
          aria-pressed={showIgnored}
          title={showIgnored ? 'Hide ignored folders (.git, vendor, node_modules, build output)' : 'Show ignored folders (.git, vendor, node_modules, build output)'}
          className={`go-studio-icon-button ml-auto h-6 w-6 ${showIgnored ? 'is-active text-accent' : ''}`}
        >
          {showIgnored ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
        <button type="button" onClick={() => updateLayout({ projectOpen: false })} aria-label="Hide Project pane" title="Hide · Alt+1" className="go-studio-icon-button h-6 w-6"><Minus size={14} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-1">
        <div className="flex h-6 items-center gap-1.5 px-2 text-[12.5px]" title={session.project.rootPath}>
          <FolderOpen size={15} className="shrink-0 text-accent" />
          <span className="shrink-0 font-semibold text-text-1">{session.project.name}</span>
          <span className="truncate text-[11px] text-text-4">{session.project.rootPath}</span>
        </div>
        {entries.map((entry) => <DirectoryNode key={entry.relativePath} sessionId={session.id} entry={entry} depth={2} activePath={activePath} onContext={onContext} />)}
        {entries.length === 0 && <p className="px-4 py-3 text-[11px] text-text-4">This folder is empty.</p>}
      </div>
      <div className="shrink-0 px-4 py-2 text-[10.5px] leading-4 text-text-4">
        {session.project.modules.length} module{session.project.modules.length === 1 ? '' : 's'} · {session.project.goWorkPath ? 'go.work' : session.project.goModPath ? 'go.mod' : 'folder mode'}
      </div>
      {menu && <ContextMenu appearance="studio" x={menu.x} y={menu.y} items={menuItems(menu.entry)} onSelect={selectMenuItem} onClose={() => setMenu(null)} />}
    </aside>
  )
})
