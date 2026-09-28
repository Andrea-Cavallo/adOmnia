import { useEffect, useMemo, useState, memo } from 'react'
import { ChevronDown, ChevronRight, Eye, EyeOff, File, FileCode2, Folder, FolderOpen, Loader2 } from 'lucide-react'
import { useGoIDEStore } from '@/stores/goide'
import { GoGopherIcon, isGoSource } from './GoGopherIcon'
import type { GoIDEFileEntry, GoIDESession } from '@/lib/goide-api'

interface GoStudioProjectTreeProps {
  session: GoIDESession
}

const emptyEntries: GoIDEFileEntry[] = []

function FileIcon({ entry }: { entry: GoIDEFileEntry }) {
  if (isGoSource(entry.name)) return <GoGopherIcon size={13} />
  if (entry.language === 'go') return <FileCode2 size={12} className="text-accent" />
  return <File size={12} className="text-text-4" />
}

/** Memoizzato: aprire o aggiornare una cartella non ridisegna le sorelle (progetti con centinaia di cartelle). */
const DirectoryNode = memo(function DirectoryNode({ sessionId, entry, depth }: { sessionId: string; entry: GoIDEFileEntry; depth: number }) {
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
        onClick={entry.directory ? () => setOpen((value) => !value) : () => void openDocument(entry.relativePath)}
        className={`flex h-6 w-full items-center gap-1 overflow-hidden pr-2 text-left text-[11px] hover:bg-surface-3 hover:text-text-1 ${entry.ignored ? 'text-text-4' : 'text-text-2'}`}
        style={{ paddingLeft: 6 + depth * 13 }}
        title={entry.ignored ? `${entry.relativePath} (ignored by default)` : entry.relativePath}
      >
        {entry.directory
          ? loading ? <Loader2 size={11} className="animate-spin" /> : open ? <ChevronDown size={11} /> : <ChevronRight size={11} />
          : <span className="w-[11px]" />}
        {entry.directory
          ? open ? <FolderOpen size={12} className="text-accent" /> : <Folder size={12} className="text-text-3" />
          : <FileIcon entry={entry} />}
        <span className="truncate">{entry.name}</span>
      </button>
      {entry.directory && open && entries?.map((child) => (
        <DirectoryNode key={child.relativePath} sessionId={sessionId} entry={child} depth={depth + 1} />
      ))}
    </>
  )
})

/** Memoizzato: il pannello genitore si ridisegna a ogni tasto, questo solo quando cambia la sessione. */
export const GoStudioProjectTree = memo(function GoStudioProjectTree({ session }: GoStudioProjectTreeProps) {
  const entries = useGoIDEStore((state) => state.directoryEntries[session.id]?.[''] ?? emptyEntries)
  const loadDirectory = useGoIDEStore((state) => state.loadDirectory)
  const showIgnored = useGoIDEStore((state) => state.showIgnoredBySession[session.id] ?? false)
  const toggleShowIgnored = useGoIDEStore((state) => state.toggleShowIgnored)
  const rootKey = useMemo(() => `${session.id}:${session.project.realPath}`, [session.id, session.project.realPath])

  useEffect(() => { void loadDirectory('') }, [loadDirectory, rootKey])

  return (
    <aside aria-label="Project files" className="flex h-full min-w-0 flex-col bg-surface-1">
      <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-text-3">
        <ChevronDown size={11} /> Project
        <button
          type="button"
          onClick={() => void toggleShowIgnored()}
          aria-pressed={showIgnored}
          title={showIgnored ? 'Hide ignored folders (.git, vendor, node_modules, build output)' : 'Show ignored folders (.git, vendor, node_modules, build output)'}
          className={`ml-auto grid h-5 w-5 place-items-center rounded hover:bg-surface-3 hover:text-text-1 ${showIgnored ? 'text-accent' : 'text-text-4'}`}
        >
          {showIgnored ? <Eye size={11} /> : <EyeOff size={11} />}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        <div className="flex h-6 items-center gap-1.5 px-2 text-[11px] font-semibold text-text-1" title={session.project.rootPath}>
          <FolderOpen size={13} className="text-accent" /><span className="truncate">{session.project.name}</span>
        </div>
        {entries.map((entry) => <DirectoryNode key={entry.relativePath} sessionId={session.id} entry={entry} depth={1} />)}
        {entries.length === 0 && <p className="px-4 py-3 text-[10px] text-text-4">This folder is empty.</p>}
      </div>
      <div className="shrink-0 border-t border-border-1 px-2 py-1.5 text-[9px] leading-4 text-text-4">
        {session.project.modules.length} module{session.project.modules.length === 1 ? '' : 's'} · {session.project.goWorkPath ? 'go.work' : session.project.goModPath ? 'go.mod' : 'folder mode'}
      </div>
    </aside>
  )
})
