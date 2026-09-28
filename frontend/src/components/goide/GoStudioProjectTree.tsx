import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, File, FileCode2, Folder, FolderOpen, Loader2 } from 'lucide-react'
import { useGoIDEStore } from '@/stores/goide'
import type { GoIDEFileEntry, GoIDESession } from '@/lib/goide-api'

interface GoStudioProjectTreeProps {
  session: GoIDESession
}

const emptyEntries: GoIDEFileEntry[] = []

function FileIcon({ entry }: { entry: GoIDEFileEntry }) {
  if (entry.language === 'go') return <FileCode2 size={12} className="text-accent" />
  return <File size={12} className="text-text-4" />
}

function DirectoryNode({ sessionId, entry, depth }: { sessionId: string; entry: GoIDEFileEntry; depth: number }) {
  const [open, setOpen] = useState(false)
  const entries = useGoIDEStore((state) => state.directoryEntries[sessionId]?.[entry.relativePath])
  const loading = useGoIDEStore((state) => state.directoryLoading[`${sessionId}:${entry.relativePath}`] ?? false)
  const loadDirectory = useGoIDEStore((state) => state.loadDirectory)
  const openDocument = useGoIDEStore((state) => state.openDocument)

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && !entries && !loading) void loadDirectory(entry.relativePath)
  }

  return (
    <>
      <button
        type="button"
        onClick={entry.directory ? toggle : () => void openDocument(entry.relativePath)}
        className="flex h-6 w-full items-center gap-1 overflow-hidden pr-2 text-left text-[11px] text-text-2 hover:bg-surface-3 hover:text-text-1"
        style={{ paddingLeft: 6 + depth * 13 }}
        title={entry.relativePath}
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
}

export function GoStudioProjectTree({ session }: GoStudioProjectTreeProps) {
  const entries = useGoIDEStore((state) => state.directoryEntries[session.id]?.[''] ?? emptyEntries)
  const loadDirectory = useGoIDEStore((state) => state.loadDirectory)
  const rootKey = useMemo(() => `${session.id}:${session.project.realPath}`, [session.id, session.project.realPath])

  useEffect(() => { void loadDirectory('') }, [loadDirectory, rootKey])

  return (
    <aside aria-label="Project files" className="flex h-full min-w-0 flex-col bg-surface-1">
      <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-text-3">
        <ChevronDown size={11} /> Project
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
}
