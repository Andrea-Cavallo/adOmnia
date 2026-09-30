import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
import { ChevronDown, ChevronRight, Eye, EyeOff, Folder, FolderOpen, Loader2, Minus, RefreshCw } from 'lucide-react'
import { useGoIDEStore } from '@/stores/goide'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { BrandIcon, GoStudioFileIcon } from './GoStudioFileIcon'
import { resolveGoStudioFolderBrand } from './goStudioFileIcons'
import type { GoIDEFileEntry, GoIDESession } from '@/lib/goide-api'
import { ContextMenu } from '@/components/ui/ContextMenu'
import { buildTreeMarks, type GoStudioTreeMark } from './goStudioTreeMarks'
import { useGoIDEVCSStore } from '@/stores/goideVcs'
import { useGoIDETestsStore } from '@/stores/goideTests'
import { openPemInPowerTools, sendFileToApiWorkspace } from './goStudioFileHandoffs'
import { deletePathWithConfirm, parentOf, revealPath } from './goStudioFileActions'
import { buildTreeMenu, treeKeyAction } from './goStudioTreeMenu'
import { copyReference, findInFolder, openInSplit, openTerminalIn, pasteInto, runPackageCommand, useGoStudioTreeClipboard } from './goStudioTreeActions'
import type { GoStudioCommandId } from './goStudioCommands'
import { GoStudioPathDialog, type GoStudioPathRequest } from './GoStudioPathDialog'

/** entry null = radice del progetto. */
type TreeContextHandler = (entry: GoIDEFileEntry | null, x: number, y: number) => void
/** Scorciatoie sulla riga a fuoco: stesse azioni del menu contestuale, identificate dal loro id. */
type TreeKeyHandler = (entry: GoIDEFileEntry, action: string) => void

type TreeMarks = Map<string, GoStudioTreeMark>

const EMPTY_MARKS: TreeMarks = new Map()

/** Colori JetBrains: modificato blu, aggiunto verde, non tracciato ambra, conflitto rosso. */
const VCS_CLASS: Record<NonNullable<GoStudioTreeMark['vcs']>, string> = {
  modified: 'text-info', added: 'text-success', untracked: 'text-warning', deleted: 'text-text-4 line-through', conflicted: 'text-danger',
}

function markTitle(mark: GoStudioTreeMark | undefined): string {
  if (!mark) return ''
  const parts: string[] = []
  if (mark.vcs) parts.push(`Git: ${mark.vcs}`)
  if (mark.problem) parts.push(`${mark.problems} ${mark.problem}${mark.problems === 1 ? '' : 's'}`)
  if (mark.testFailed) parts.push('failed tests')
  return parts.length ? ` · ${parts.join(' · ')}` : ''
}

/** Stato Git, problemi di gopls e test falliti del progetto, per file e cartelle. */
function useTreeMarks(sessionId: string): TreeMarks {
  const status = useGoIDEVCSStore((state) => state.status[sessionId] ?? null)
  const diagnostics = useGoIDELspStore((state) => state.diagnostics[sessionId])
  const runs = useGoIDETestsStore((state) => state.runs[sessionId])
  return useMemo(() => {
    const lastRun = runs?.[runs.length - 1]
    const failedTestFiles = (lastRun?.results ?? []).filter((result) => result.status === 'fail' && result.failure?.relativePath).map((result) => result.failure!.relativePath!)
    const changes = status?.available ? status.changes : []
    const reports = diagnostics ? Object.values(diagnostics) : []
    if (changes.length === 0 && reports.length === 0 && failedTestFiles.length === 0) return EMPTY_MARKS
    return buildTreeMarks({ changes, diagnostics: reports, failedTestFiles })
  }, [diagnostics, runs, status])
}

interface GoStudioProjectTreeProps {
  session: GoIDESession
  /** Percorso relativo del file attivo nell'editor, evidenziato nell'albero. */
  activePath: string | null
  /** Comandi del pannello (Local History, Git History, Blame) sul file appena aperto. Deve essere stabile. */
  onCommand: (id: GoStudioCommandId) => void
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
// ponytail: righe native (content-visibility) + cartelle enormi a pagine; lista piatta virtualizzata solo se un progetto reale lo richiede.
const TREE_PAGE = 500

/** "Show more" per cartelle con migliaia di voci: l'albero resta reattivo anche in un monorepo o su file generati. */
function ShowMoreRow({ hidden, depth, onShow }: { hidden: number; depth: number; onShow: () => void }) {
  return (
    <button type="button" onClick={onShow} className="flex h-[26px] w-full items-center rounded-[7px] pr-2 text-left text-[11.5px] text-accent hover:bg-surface-3" style={{ paddingLeft: ROW_BASE_PX + (depth - 1) * ROW_INDENT_PX + 18 }}>
      Show {Math.min(hidden, TREE_PAGE)} more of {hidden} hidden items…
    </button>
  )
}

const DirectoryNode = memo(function DirectoryNode({ sessionId, entry, depth, activePath, onContext, onKey, marks }: { sessionId: string; entry: GoIDEFileEntry; depth: number; activePath: string | null; onContext: TreeContextHandler; onKey: TreeKeyHandler; marks: TreeMarks }) {
  const mark = marks.get(entry.relativePath)
  const selected = !entry.directory && entry.relativePath === activePath
  const [open, setOpen] = useState(false)
  const [limit, setLimit] = useState(TREE_PAGE)
  const entries = useGoIDEStore((state) => state.directoryEntries[sessionId]?.[entry.relativePath])
  const loading = useGoIDEStore((state) => state.directoryLoading[`${sessionId}:${entry.relativePath}`] ?? false)
  const loadDirectory = useGoIDEStore((state) => state.loadDirectory)
  const openDocument = useGoIDEStore((state) => state.openDocument)
  const isCut = useGoStudioTreeClipboard((state) => state.clipboard?.mode === 'cut' && state.clipboard.sessionId === sessionId && state.clipboard.relativePath === entry.relativePath)

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
        onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); onContext(entry, event.clientX, event.clientY) }}
        onKeyDown={(event) => {
          const action = treeKeyAction(event)
          if (action) { event.preventDefault(); event.stopPropagation(); onKey(entry, action) }
        }}
        aria-current={selected ? 'true' : undefined}
        className={`go-studio-tree-row flex h-[26px] w-full items-center gap-1.5 overflow-hidden rounded-[7px] pr-2 text-left text-[12.5px] ${isCut ? 'opacity-50' : ''} ${selected ? 'go-studio-tree-row-selected' : `hover:bg-surface-3 hover:text-text-1 ${entry.ignored ? 'text-text-4' : 'text-text-2'}`}`}
        style={{ paddingLeft: ROW_BASE_PX + (depth - 1) * ROW_INDENT_PX }}
        title={`${entry.relativePath}${entry.ignored ? ' (ignored by default)' : ''}${markTitle(mark)}`}
      >
        {entry.directory
          ? loading ? <Loader2 size={12} className="shrink-0 animate-spin text-text-4" /> : open ? <ChevronDown size={12} className="shrink-0 text-text-3" /> : <ChevronRight size={12} className="shrink-0 text-text-4" />
          : <span className="w-3 shrink-0" />}
        {entry.directory
          ? <FolderIcon name={entry.name} open={open} />
          : <GoStudioFileIcon name={entry.name} relativePath={entry.relativePath} />}
        <span className={`truncate ${mark?.vcs && !selected ? VCS_CLASS[mark.vcs] : ''} ${mark?.problem ? `underline decoration-wavy underline-offset-[3px] ${mark.problem === 'error' ? 'decoration-danger' : 'decoration-warning'}` : ''}`}>{entry.name}</span>
        {mark?.testFailed && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-danger" aria-label="failed tests" />}
      </button>
      {entry.directory && open && entries?.slice(0, limit).map((child) => (
        <DirectoryNode key={child.relativePath} sessionId={sessionId} entry={child} depth={depth + 1} activePath={activePath} onContext={onContext} onKey={onKey} marks={marks} />
      ))}
      {entry.directory && open && entries && entries.length > limit && <ShowMoreRow hidden={entries.length - limit} depth={depth + 1} onShow={() => setLimit((value) => value + TREE_PAGE)} />}
    </>
  )
})

/** Memoizzato: il pannello genitore si ridisegna a ogni tasto, questo solo quando cambia la sessione. */
export const GoStudioProjectTree = memo(function GoStudioProjectTree({ session, activePath, onCommand }: GoStudioProjectTreeProps) {
  const entries = useGoIDEStore((state) => state.directoryEntries[session.id]?.[''] ?? emptyEntries)
  const loadDirectory = useGoIDEStore((state) => state.loadDirectory)
  const showIgnored = useGoIDEStore((state) => state.showIgnoredBySession[session.id] ?? false)
  const toggleShowIgnored = useGoIDEStore((state) => state.toggleShowIgnored)
  const rootKey = useMemo(() => `${session.id}:${session.project.realPath}`, [session.id, session.project.realPath])
  const [rootLimit, setRootLimit] = useState(TREE_PAGE)

  useEffect(() => { void loadDirectory('') }, [loadDirectory, rootKey])

  const openDocument = useGoIDEStore((state) => state.openDocument)
  const reloadDocumentFromDisk = useGoIDEStore((state) => state.reloadDocumentFromDisk)
  const refreshProject = useGoIDEStore((state) => state.refreshProject)
  const updateLayout = useGoIDEStore((state) => state.updateLayout)
  const refreshing = useGoIDEStore((state) => Object.entries(state.directoryLoading).some(([key, loading]) => loading && key.startsWith(`${session.id}:`)))
  const marks = useTreeMarks(session.id)
  const [menu, setMenu] = useState<{ entry: GoIDEFileEntry | null; x: number; y: number } | null>(null)
  const [pathRequest, setPathRequest] = useState<GoStudioPathRequest | null>(null)
  const onContext = useCallback<TreeContextHandler>((entry, x, y) => setMenu({ entry, x, y }), [])
  const canPaste = useGoStudioTreeClipboard((state) => state.clipboard?.sessionId === session.id)
  const vcsAvailable = useGoIDEVCSStore((state) => !!state.status[session.id]?.available)

  /** Esegue un'azione del menu o di una scorciatoia; entry null = radice del progetto. */
  const runTreeAction = (id: string, entry: GoIDEFileEntry | null) => {
    const path = entry?.relativePath ?? ''
    const directory = !entry || entry.directory
    // Le voci New, Paste e Find lavorano nella cartella selezionata, o in quella del file.
    const folder = entry ? (entry.directory ? path : parentOf(path)) : ''
    const openThen = (command: GoStudioCommandId) => void openDocument(path).then(() => onCommand(command))
    switch (id) {
      case 'open': void openDocument(path); break
      case 'splitRight': void openInSplit(session.id, path, 'right'); break
      case 'splitDown': void openInSplit(session.id, path, 'down'); break
      case 'newGoFile': case 'newFile': case 'newFolder': setPathRequest({ action: id, target: folder }); break
      case 'cut': case 'copy': if (entry) useGoStudioTreeClipboard.getState().setClipboard({ sessionId: session.id, relativePath: path, mode: id }); break
      case 'paste': void pasteInto(session.id, folder); break
      case 'copyAbsolutePath': void copyReference(session, path, directory, 'absolute'); break
      case 'copyRelativePath': void copyReference(session, path, directory, 'relative'); break
      case 'copyFileName': void copyReference(session, path, directory, 'name'); break
      case 'copyImportPath': void copyReference(session, path, directory, 'import'); break
      case 'findUsages': openThen('nav.usages'); break
      case 'inspectCode': openThen('code.lint'); break
      case 'rename': case 'duplicate': if (entry) setPathRequest({ action: id, target: path }); break
      case 'refactorThis': openThen('code.refactorThis'); break
      case 'moveToNewFile': openThen('code.moveToNewFile'); break
      case 'toggleBookmark': openThen('nav.toggleBookmark'); break
      case 'showBookmarks': onCommand('nav.bookmarks'); break
      case 'reformat': openThen('code.reformat'); break
      case 'optimizeImports': openThen('code.organizeImports'); break
      case 'delete': if (entry) void deletePathWithConfirm(session.id, path, entry.directory); break
      case 'reloadFromDisk': if (entry) void reloadDocumentFromDisk(path); break
      case 'refreshProject': void refreshProject(directory ? path : ''); break
      case 'findInFolder': findInFolder(folder); break
      case 'testPackage': void runPackageCommand(session, path, directory, 'test'); break
      case 'testPackageCoverage': void runPackageCommand(session, path, directory, 'test', true); break
      case 'buildPackage': void runPackageCommand(session, path, directory, 'build'); break
      case 'vetPackage': void runPackageCommand(session, path, directory, 'vet'); break
      case 'generatePackage': void runPackageCommand(session, path, directory, 'generate'); break
      case 'runCurrent': onCommand('run.run'); break
      case 'debugCurrent': onCommand('debug.debug'); break
      case 'reveal': revealPath(session.id, path); break
      case 'terminal': openTerminalIn(folder); break
      case 'localHistory': openThen('file.localHistory'); break
      case 'gitHistory': openThen('vcs.history'); break
      case 'gitAnnotate': openThen('vcs.annotate'); break
      case 'sendToApi': void sendFileToApiWorkspace(session.id, path); break
      case 'pemTools': void openPemInPowerTools(session.id, path); break
    }
  }
  const runTreeActionRef = useRef(runTreeAction)
  runTreeActionRef.current = runTreeAction
  // Stabile: le righe memoizzate non si ridisegnano quando cambia lo stato del pannello.
  const onKey = useCallback<TreeKeyHandler>((entry, action) => runTreeActionRef.current(action, entry), [])
  const selectMenuItem = (id: string) => {
    if (!menu) return
    const { entry } = menu
    setMenu(null)
    runTreeAction(id, entry)
  }
  const menuContext = { canPaste, vcsAvailable, hasGoModule: (session.project.modules ?? []).length > 0 }

  return (
    <aside aria-label="Project files" className="flex h-full min-w-0 flex-col">
      <div className="go-studio-tool-header">
        <span className="go-studio-tool-title">Project</span>
        <button type="button" onClick={() => void refreshProject()} disabled={refreshing} aria-label="Refresh project from disk" title="Refresh Project · re-read disk" className="go-studio-icon-button ml-auto h-6 w-6 disabled:opacity-50">
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        </button>
        <button
          type="button"
          onClick={() => void toggleShowIgnored()}
          aria-pressed={showIgnored}
          title={showIgnored ? 'Hide ignored folders (.git, vendor, node_modules, build output)' : 'Show ignored folders (.git, vendor, node_modules, build output)'}
          className={`go-studio-icon-button h-6 w-6 ${showIgnored ? 'is-active text-accent' : ''}`}
        >
          {showIgnored ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
        <button type="button" onClick={() => updateLayout({ projectOpen: false })} aria-label="Hide Project pane" title="Hide · Alt+1" className="go-studio-icon-button h-6 w-6"><Minus size={14} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-1">
        <div role="button" tabIndex={0} aria-label={`${session.project.name} project root: press Shift+F10 for actions`} className="flex h-6 items-center gap-1.5 rounded-[7px] px-2 text-[12.5px] focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent" title={session.project.rootPath}
          onContextMenu={(event) => { event.preventDefault(); onContext(null, event.clientX, event.clientY) }}
          onKeyDown={(event) => {
            if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
              event.preventDefault()
              const rect = event.currentTarget.getBoundingClientRect()
              onContext(null, rect.left + 16, rect.bottom)
            }
          }}>
          <FolderOpen size={15} className="shrink-0 text-accent" />
          <span className="shrink-0 font-semibold text-text-1">{session.project.name}</span>
          <span className="truncate text-[11px] text-text-4">{session.project.rootPath}</span>
        </div>
        {entries.slice(0, rootLimit).map((entry) => <DirectoryNode key={entry.relativePath} sessionId={session.id} entry={entry} depth={2} activePath={activePath} onContext={onContext} onKey={onKey} marks={marks} />)}
        {entries.length > rootLimit && <ShowMoreRow hidden={entries.length - rootLimit} depth={2} onShow={() => setRootLimit((value) => value + TREE_PAGE)} />}
        {entries.length === 0 && <p className="px-4 py-3 text-[11px] text-text-4">This folder is empty.</p>}
      </div>
      <div className="shrink-0 px-4 py-2 text-[10.5px] leading-4 text-text-4">
        {session.project.modules.length} module{session.project.modules.length === 1 ? '' : 's'} · {session.project.goWorkPath ? 'go.work' : session.project.goModPath ? 'go.mod' : 'folder mode'}
      </div>
      {menu && <ContextMenu appearance="studio" x={menu.x} y={menu.y} items={buildTreeMenu(menu.entry, menuContext)} onSelect={selectMenuItem} onClose={() => setMenu(null)} />}
      <GoStudioPathDialog sessionId={session.id} request={pathRequest} onClose={() => setPathRequest(null)} />
    </aside>
  )
})
