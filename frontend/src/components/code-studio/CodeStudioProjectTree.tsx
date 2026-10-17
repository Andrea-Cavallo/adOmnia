import { goModules } from '@/lib/code-studio/goProject'
import { projectProfile } from '@/lib/code-studio/projectProfile'
import { IDE_LANGUAGE_NAMES } from '@/components/ide/languages'
import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
import { ChevronDown, ChevronRight, Eye, EyeOff, Loader2, Minus, RefreshCw } from 'lucide-react'
import { CodeStudioFolderIcon } from './CodeStudioFolderIcon'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { BrandIcon, CodeStudioFileIcon } from './CodeStudioFileIcon'
import { resolveCodeStudioFolderBrand } from './codeStudioFileIcons'
import type { GoIDEFileEntry, GoIDESession } from '@/lib/code-studio-api'
import { ContextMenu } from '@/components/ui/ContextMenu'
import { buildTreeMarks, type CodeStudioTreeMark } from './codeStudioTreeMarks'
import { useCodeStudioVCSStore } from '@/stores/codeStudioVcs'
import { useCodeStudioTestsStore } from '@/stores/codeStudioTests'
import { openPemInPowerTools, openEnterpriseFile, sendFileToApiWorkspace } from './codeStudioFileHandoffs'
import { createGitignore, deletePathWithConfirm, parentOf, revealPath, type GitignoreTemplate } from './codeStudioFileActions'
import { buildTreeMenu, treeKeyAction } from './codeStudioTreeMenu'
import { openHtmlWithLivePreview } from './codeStudioPreviewCommands'
import { copyReference, findInFiles, findInFolder, moveTreePath, openInSplit, openTerminalIn, pasteInto, previewHtml, repairIde, replaceInFiles, runPackageCommand, runTreeGitAction, useCodeStudioTreeClipboard } from './codeStudioTreeActions'
import type { CodeStudioCommandId } from './codeStudioCommands'
import { CodeStudioPathDialog, type CodeStudioPathRequest } from './CodeStudioPathDialog'
import { CodeStudioCompareDialog } from './CodeStudioCompareDialog'
import { CodeStudioGistDialog } from './CodeStudioGistDialog'
import { directoryMarkLabel, loadDirectoryMarks, saveDirectoryMark, type CodeStudioDirectoryMark } from './codeStudioDirectoryMarks'

/** entry null = radice del progetto. */
type TreeContextHandler = (entry: GoIDEFileEntry | null, x: number, y: number) => void
/** Scorciatoie sulla riga a fuoco: stesse azioni del menu contestuale, identificate dal loro id. */
type TreeKeyHandler = (entry: GoIDEFileEntry, action: string) => void
type TreeMoveHandler = (source: string, targetFolder: string) => void

type TreeMarks = Map<string, CodeStudioTreeMark>

const EMPTY_MARKS: TreeMarks = new Map()

/** Colori JetBrains: modificato blu, aggiunto verde, non tracciato ambra, conflitto rosso. */
const VCS_CLASS: Record<NonNullable<CodeStudioTreeMark['vcs']>, string> = {
  modified: 'text-info', added: 'text-success', untracked: 'text-warning', deleted: 'text-text-4 line-through', conflicted: 'text-danger',
}

function markTitle(mark: CodeStudioTreeMark | undefined): string {
  if (!mark) return ''
  const parts: string[] = []
  if (mark.vcs) parts.push(`Git: ${mark.vcs}`)
  if (mark.problem) parts.push(`${mark.problems} ${mark.problem}${mark.problems === 1 ? '' : 's'}`)
  if (mark.testFailed) parts.push('failed tests')
  return parts.length ? ` · ${parts.join(' · ')}` : ''
}

/** Stato Git, problemi di gopls e test falliti del progetto, per file e cartelle. */
function useTreeMarks(sessionId: string): TreeMarks {
  const status = useCodeStudioVCSStore((state) => state.status[sessionId] ?? null)
  const diagnostics = useCodeStudioLspStore((state) => state.diagnostics[sessionId])
  const runs = useCodeStudioTestsStore((state) => state.runs[sessionId])
  return useMemo(() => {
    const lastRun = runs?.[runs.length - 1]
    const failedTestFiles = (lastRun?.results ?? []).filter((result) => result.status === 'fail' && result.failure?.relativePath).map((result) => result.failure!.relativePath!)
    const changes = status?.available ? status.changes : []
    const reports = diagnostics ? Object.values(diagnostics) : []
    if (changes.length === 0 && reports.length === 0 && failedTestFiles.length === 0) return EMPTY_MARKS
    return buildTreeMarks({ changes, diagnostics: reports, failedTestFiles })
  }, [diagnostics, runs, status])
}

interface CodeStudioProjectTreeProps {
  session: GoIDESession
  /** Percorso relativo del file attivo nell'editor, evidenziato nell'albero. */
  activePath: string | null
  /** Comandi del pannello (Local History, Git History, Blame) sul file appena aperto. Deve essere stabile. */
  onCommand: (id: CodeStudioCommandId) => void
}

const ROW_INDENT_PX = 16
const ROW_BASE_PX = 8

const emptyEntries: GoIDEFileEntry[] = []

function FolderIcon({ name, open }: { name: string; open: boolean }) {
  const brand = resolveCodeStudioFolderBrand(name)
  if (brand) return <BrandIcon slug={brand} size={14} />
  return <CodeStudioFolderIcon open={open} />
}

/** Frecce su/giù, Home e End spostano il focus tra le righe visibili (roving tabindex: solo la riga attiva è nel Tab). */
function moveTreeFocus(event: React.KeyboardEvent<HTMLDivElement>) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]'))
  const index = rows.indexOf(document.activeElement as HTMLElement)
  if (index < 0 || rows.length === 0) return
  event.preventDefault()
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.min(rows.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))
  rows[next].focus()
}

/** Memoizzato: aprire o aggiornare una cartella non ridisegna le sorelle (progetti con centinaia di cartelle). */
// ponytail: righe native + cartelle enormi a pagine; lista piatta virtualizzata solo se un progetto reale lo richiede.
const TREE_PAGE = 500

/** "Show more" per cartelle con migliaia di voci: l'albero resta reattivo anche in un monorepo o su file generati. */
function ShowMoreRow({ hidden, depth, onShow }: { hidden: number; depth: number; onShow: () => void }) {
  return (
    <button type="button" onClick={onShow} className="flex h-[26px] w-full items-center rounded-[7px] pr-2 text-left text-[11.5px] text-accent hover:bg-surface-3" style={{ paddingLeft: ROW_BASE_PX + (depth - 1) * ROW_INDENT_PX + 18 }}>
      Show {Math.min(hidden, TREE_PAGE)} more of {hidden} hidden items…
    </button>
  )
}

const DirectoryNode = memo(function DirectoryNode({ sessionId, entry, depth, activePath, onContext, onKey, onMove, dropTarget, setDropTarget, marks, directoryMarks }: { sessionId: string; entry: GoIDEFileEntry; depth: number; activePath: string | null; onContext: TreeContextHandler; onKey: TreeKeyHandler; onMove: TreeMoveHandler; dropTarget: string | null; setDropTarget: (path: string | null) => void; marks: TreeMarks; directoryMarks: Record<string, CodeStudioDirectoryMark> }) {
  const mark = marks.get(entry.relativePath)
  const directoryMark = entry.directory ? directoryMarks[entry.relativePath] : undefined
  const selected = !entry.directory && entry.relativePath === activePath
  const [open, setOpen] = useState(false)
  const [limit, setLimit] = useState(TREE_PAGE)
  const entries = useCodeStudioStore((state) => state.directoryEntries[sessionId]?.[entry.relativePath])
  const loading = useCodeStudioStore((state) => state.directoryLoading[`${sessionId}:${entry.relativePath}`] ?? false)
  const loadDirectory = useCodeStudioStore((state) => state.loadDirectory)
  const openDocument = useCodeStudioStore((state) => state.openDocument)
  const isCut = useCodeStudioTreeClipboard((state) => state.clipboard?.mode === 'cut' && state.clipboard.sessionId === sessionId && state.clipboard.relativePath === entry.relativePath)

  // Ricarica i figli anche quando la cache viene svuotata (es. toggle delle cartelle ignorate).
  useEffect(() => {
    if (open && entry.directory && !entries && !loading) void loadDirectory(entry.relativePath)
  }, [entries, entry.directory, entry.relativePath, loadDirectory, loading, open])

  return (
    <>
      <button
        type="button"
        draggable
        onDragStart={(event) => {
          event.stopPropagation()
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('application/x-adomnia-code-studio-path', entry.relativePath)
          event.dataTransfer.setData('text/plain', entry.relativePath)
        }}
        onDragEnd={() => setDropTarget(null)}
        onDragOver={entry.directory ? (event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; setDropTarget(entry.relativePath) } : undefined}
        onDragLeave={entry.directory ? (event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null) } : undefined}
        onDrop={entry.directory ? (event) => {
          event.preventDefault(); event.stopPropagation()
          const source = event.dataTransfer.getData('application/x-adomnia-code-studio-path')
          setDropTarget(null)
          if (source) onMove(source, entry.relativePath)
        } : undefined}
        onClick={entry.directory ? () => setOpen((value) => !value) : () => void openDocument(entry.relativePath, { preview: useCodeStudioLspStore.getState().preferences.previewTab })}
        onDoubleClick={entry.directory ? undefined : () => void openDocument(entry.relativePath)}
        onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); onContext(entry, event.clientX, event.clientY) }}
        role="treeitem"
        aria-level={depth - 1}
        aria-expanded={entry.directory ? open : undefined}
        aria-selected={selected}
        tabIndex={selected ? 0 : -1}
        onKeyDown={(event) => {
          if (entry.directory && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
            if (event.key === 'ArrowRight' && !open) { event.preventDefault(); setOpen(true); return }
            if (event.key === 'ArrowLeft' && open) { event.preventDefault(); setOpen(false); return }
          }
          const action = treeKeyAction(event)
          if (action) { event.preventDefault(); event.stopPropagation(); onKey(entry, action) }
        }}
        aria-current={selected ? 'true' : undefined}
        className={`code-studio-tree-row flex h-[26px] w-full items-center gap-1.5 overflow-hidden rounded-[7px] pr-2 text-left text-[12.5px] ${isCut ? 'opacity-50' : ''} ${dropTarget === entry.relativePath ? 'bg-accent/15 outline outline-1 outline-accent' : ''} ${selected ? 'code-studio-tree-row-selected' : `hover:bg-surface-3 hover:text-text-1 ${entry.ignored ? 'text-text-4' : 'text-text-2'}`}`}
        style={{ paddingLeft: ROW_BASE_PX + (depth - 1) * ROW_INDENT_PX }}
        title={`${entry.relativePath}${entry.ignored ? ' (ignored by default)' : ''}${directoryMark ? ` · ${directoryMarkLabel(directoryMark)}` : ''}${markTitle(mark)}`}
      >
        {entry.directory
          ? loading ? <Loader2 size={12} className="shrink-0 animate-spin text-text-4" /> : open ? <ChevronDown size={12} className="shrink-0 text-text-3" /> : <ChevronRight size={12} className="shrink-0 text-text-4" />
          : <span className="w-3 shrink-0" />}
        {entry.directory
          ? <FolderIcon name={entry.name} open={open} />
          : <CodeStudioFileIcon name={entry.name} relativePath={entry.relativePath} />}
        <span className={`min-w-0 flex-1 truncate ${mark?.vcs && !selected ? VCS_CLASS[mark.vcs] : ''} ${mark?.problem ? `underline decoration-wavy underline-offset-[3px] ${mark.problem === 'error' ? 'decoration-danger' : 'decoration-warning'}` : ''}`}>{entry.name}</span>
        {directoryMark && <span className={`shrink-0 rounded px-1 text-[9px] uppercase tracking-wide ${directoryMark === 'excluded' ? 'bg-warning/10 text-warning' : 'bg-accent/10 text-accent'}`}>{directoryMarkLabel(directoryMark)}</span>}
        {mark?.testFailed && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-danger" aria-label="failed tests" />}
      </button>
      {entry.directory && open && entries?.slice(0, limit).map((child) => (
        <DirectoryNode key={child.relativePath} sessionId={sessionId} entry={child} depth={depth + 1} activePath={activePath} onContext={onContext} onKey={onKey} onMove={onMove} dropTarget={dropTarget} setDropTarget={setDropTarget} marks={marks} directoryMarks={directoryMarks} />
      ))}
      {entry.directory && open && entries && entries.length > limit && <ShowMoreRow hidden={entries.length - limit} depth={depth + 1} onShow={() => setLimit((value) => value + TREE_PAGE)} />}
    </>
  )
})

/** Memoizzato: il pannello genitore si ridisegna a ogni tasto, questo solo quando cambia la sessione. */
export const CodeStudioProjectTree = memo(function CodeStudioProjectTree({ session, activePath, onCommand }: CodeStudioProjectTreeProps) {
  const entries = useCodeStudioStore((state) => state.directoryEntries[session.id]?.[''] ?? emptyEntries)
  const loadDirectory = useCodeStudioStore((state) => state.loadDirectory)
  const showIgnored = useCodeStudioStore((state) => state.showIgnoredBySession[session.id] ?? false)
  const toggleShowIgnored = useCodeStudioStore((state) => state.toggleShowIgnored)
  const rootKey = useMemo(() => `${session.id}:${session.project.realPath}`, [session.id, session.project.realPath])
  const [rootLimit, setRootLimit] = useState(TREE_PAGE)

  useEffect(() => { void loadDirectory('') }, [loadDirectory, rootKey])

  const openDocument = useCodeStudioStore((state) => state.openDocument)
  const reloadDocumentFromDisk = useCodeStudioStore((state) => state.reloadDocumentFromDisk)
  const refreshProject = useCodeStudioStore((state) => state.refreshProject)
  const updateLayout = useCodeStudioStore((state) => state.updateLayout)
  const refreshing = useCodeStudioStore((state) => Object.entries(state.directoryLoading).some(([key, loading]) => loading && key.startsWith(`${session.id}:`)))
  const marks = useTreeMarks(session.id)
  const [menu, setMenu] = useState<{ entry: GoIDEFileEntry | null; x: number; y: number } | null>(null)
  const [pathRequest, setPathRequest] = useState<CodeStudioPathRequest | null>(null)
  const [compareRequest, setCompareRequest] = useState<{ path: string; directory: boolean } | null>(null)
  const [gistRequest, setGistRequest] = useState<string | null>(null)
  const [directoryMarks, setDirectoryMarks] = useState<Record<string, CodeStudioDirectoryMark>>(() => loadDirectoryMarks(session.project.realPath))
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const onContext = useCallback<TreeContextHandler>((entry, x, y) => setMenu({ entry, x, y }), [])
  const canPaste = useCodeStudioTreeClipboard((state) => state.clipboard?.sessionId === session.id)
  const vcsStatus = useCodeStudioVCSStore((state) => state.status[session.id])
  const vcsAvailable = !!vcsStatus?.available
  const onMove = useCallback<TreeMoveHandler>((source, targetFolder) => { void moveTreePath(session.id, source, targetFolder) }, [session.id])
  useEffect(() => setDirectoryMarks(loadDirectoryMarks(session.project.realPath)), [session.project.realPath])

  /** Esegue un'azione del menu o di una scorciatoia; entry null = radice del progetto. */
  const runTreeAction = (id: string, entry: GoIDEFileEntry | null) => {
    const path = entry?.relativePath ?? ''
    const directory = !entry || entry.directory
    // Le voci New, Paste e Find lavorano nella cartella selezionata, o in quella del file.
    const folder = entry ? (entry.directory ? path : parentOf(path)) : ''
    const openThen = (command: CodeStudioCommandId) => void openDocument(path).then(() => onCommand(command))
    switch (id) {
      case 'open': void openDocument(path); break
      case 'splitRight': void openInSplit(session.id, path, 'right'); break
      case 'splitDown': void openInSplit(session.id, path, 'down'); break
      case 'newGoFile': case 'newFile': case 'newFolder': setPathRequest({ action: id, target: folder }); break
      case 'newGitignoreGo': case 'newGitignoreNode': case 'newGitignorePython': case 'newGitignoreJava': case 'newGitignoreCommon':
        void createGitignore(session.id, folder, id.slice('newGitignore'.length).toLowerCase() as GitignoreTemplate); break
      case 'cut': case 'copy': if (entry) useCodeStudioTreeClipboard.getState().setClipboard({ sessionId: session.id, relativePath: path, mode: id }); break
      case 'paste': void pasteInto(session.id, folder); break
      case 'copyAbsolutePath': void copyReference(session, path, directory, 'absolute'); break
      case 'copyRelativePath': void copyReference(session, path, directory, 'relative'); break
      case 'copyFileName': void copyReference(session, path, directory, 'name'); break
      case 'copyImportPath': void copyReference(session, path, directory, 'import'); break
      case 'findUsages': openThen('nav.usages'); break
      case 'inspectCode': openThen('code.lint'); break
      case 'rename': case 'duplicate': if (entry) setPathRequest({ action: id, target: path }); break
      case 'moveDirectory': if (entry) setPathRequest({ action: 'rename', target: path }); break
      case 'copyClasses': if (entry) setPathRequest({ action: 'duplicate', target: path }); break
      case 'semanticRename': openThen('code.rename'); break
      case 'refactorThis': openThen('code.refactorThis'); break
      case 'moveToNewFile': openThen('code.moveToNewFile'); break
      case 'moveSymbol': openThen('code.moveSymbol'); break
      case 'toggleBookmark': openThen('nav.toggleBookmark'); break
      case 'showBookmarks': onCommand('nav.bookmarks'); break
      case 'reformat': openThen('code.reformat'); break
      case 'optimizeImports': openThen('code.organizeImports'); break
      case 'delete': if (entry) void deletePathWithConfirm(session.id, path, entry.directory); break
      case 'reloadFromDisk': if (entry) void reloadDocumentFromDisk(path); break
      case 'refreshProject': void refreshProject(directory ? path : ''); break
      case 'repairIde': void repairIde(session.id, path, directory); break
      case 'findInFolder': findInFolder(folder); break
      case 'findInFiles': findInFiles(); break
      case 'replaceInFiles': replaceInFiles(); break
      case 'testPackage': void runPackageCommand(session, path, directory, 'test'); break
      case 'testPackageCoverage': void runPackageCommand(session, path, directory, 'test', true); break
      case 'buildPackage': void runPackageCommand(session, path, directory, 'build'); break
      case 'vetPackage': void runPackageCommand(session, path, directory, 'vet'); break
      case 'generatePackage': void runPackageCommand(session, path, directory, 'generate'); break
      case 'runCurrent': onCommand('run.run'); break
      case 'debugCurrent': onCommand('debug.debug'); break
      case 'reveal': revealPath(session.id, path); break
      case 'terminal': openTerminalIn(folder); break
      case 'openInBrowser': if (entry) void previewHtml(path); break
      case 'openWithLivePreview': if (entry) void openHtmlWithLivePreview(session.id, path); break
      case 'localHistory': openThen('file.localHistory'); break
      case 'gitHistory': openThen('vcs.history'); break
      case 'gitAnnotate': openThen('vcs.annotate'); break
      case 'gitDiff': openThen('vcs.gitStudio'); break
      case 'gitCommit': onCommand('vcs.commit'); break
      case 'gitPull': void runTreeGitAction(session.id, 'pull', path, directory); break
      case 'gitPullQuick': void runTreeGitAction(session.id, 'pull', path, directory); break
      case 'gitPush': void runTreeGitAction(session.id, 'push', path, directory); break
      case 'gitStage': void runTreeGitAction(session.id, 'stage', path, directory); break
      case 'gitUnstage': void runTreeGitAction(session.id, 'unstage', path, directory); break
      case 'gitRevert': void runTreeGitAction(session.id, 'revert', path, directory); break
      case 'gitResetHead': void runTreeGitAction(session.id, 'reset', path, directory); break
      case 'gitStudio': onCommand('vcs.gitStudio'); break
      case 'compareWith': if (entry) setCompareRequest({ path, directory }); break
      case 'markSources': case 'markTests': case 'markResources': case 'markExcluded': if (entry?.directory) {
        setDirectoryMarks(saveDirectoryMark(session.project.realPath, path, id.slice('mark'.length).toLowerCase() as CodeStudioDirectoryMark))
      } break
      case 'unmarkDirectory': if (entry?.directory) setDirectoryMarks(saveDirectoryMark(session.project.realPath, path, null)); break
      case 'createGist': if (entry && !entry.directory) setGistRequest(path); break
      case 'diagramDependencies': case 'diagramCalls': onCommand('view.architecture'); break
      case 'diagramInterfaces': onCommand('view.interfaces'); break
      case 'sendToApi': void sendFileToApiWorkspace(session.id, path); break
      case 'soapTools': void openEnterpriseFile(session.id, path, 'soap'); break
      case 'soapSecurity': void openEnterpriseFile(session.id, path, 'security'); break
      case 'xmlTools': void openEnterpriseFile(session.id, path, 'xml'); break
      case 'mtlsTools': void openEnterpriseFile(session.id, path, 'mtls'); break
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
  const menuContext = { canPaste, vcsAvailable, hasGoModule: (goModules(session.project)).length > 0, changedPaths: vcsStatus?.changes.map((change) => change.relativePath) ?? [] }

  return (
    <aside aria-label="Project files" className="flex h-full min-w-0 flex-col">
      <div className="code-studio-tool-header">
        <span className="code-studio-tool-title">Project</span>
        <button type="button" onClick={() => void refreshProject()} disabled={refreshing} aria-label="Refresh project from disk" title="Refresh Project · re-read disk" className="code-studio-icon-button ml-auto h-6 w-6 disabled:opacity-50">
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        </button>
        <button
          type="button"
          onClick={() => void toggleShowIgnored()}
          aria-pressed={showIgnored}
          aria-label="Show ignored folders"
          title={showIgnored ? 'Hide ignored folders (.git, vendor, node_modules, build output)' : 'Show ignored folders (.git, vendor, node_modules, build output)'}
          className={`code-studio-icon-button h-6 w-6 ${showIgnored ? 'is-active text-accent' : ''}`}
        >
          {showIgnored ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
        <button type="button" onClick={() => updateLayout({ projectOpen: false })} aria-label="Hide Project pane" title="Hide · Alt+1" className="code-studio-icon-button h-6 w-6"><Minus size={14} /></button>
      </div>
      <div role="tree" aria-label="Project files" onKeyDown={moveTreeFocus} className="min-h-0 flex-1 overflow-auto px-2 pb-1" onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }} onDrop={(event) => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        const source = event.dataTransfer.getData('application/x-adomnia-code-studio-path')
        setDropTarget(null)
        if (source) onMove(source, '')
      }}>
        <div role="treeitem" aria-level={1} aria-expanded="true" aria-selected={false} tabIndex={0} aria-label={`${session.project.name} project root: press Shift+F10 for actions`} className={`flex h-6 items-center gap-1.5 rounded-[7px] px-2 text-[12.5px] focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent ${dropTarget === '' ? 'bg-accent/15 outline outline-1 outline-accent' : ''}`} title={session.project.rootPath}
          onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; setDropTarget('') }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null) }}
          onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const source = event.dataTransfer.getData('application/x-adomnia-code-studio-path'); setDropTarget(null); if (source) onMove(source, '') }}
          onContextMenu={(event) => { event.preventDefault(); onContext(null, event.clientX, event.clientY) }}
          onKeyDown={(event) => {
            if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
              event.preventDefault()
              const rect = event.currentTarget.getBoundingClientRect()
              onContext(null, rect.left + 16, rect.bottom)
            }
          }}>
          <CodeStudioFolderIcon open />
          <span className="shrink-0 font-semibold text-text-1">{session.project.name}</span>
          <span className="truncate text-[11px] text-text-4">{session.project.rootPath}</span>
        </div>
        {entries.slice(0, rootLimit).map((entry) => <DirectoryNode key={entry.relativePath} sessionId={session.id} entry={entry} depth={2} activePath={activePath} onContext={onContext} onKey={onKey} onMove={onMove} dropTarget={dropTarget} setDropTarget={setDropTarget} marks={marks} directoryMarks={directoryMarks} />)}
        {entries.length > rootLimit && <ShowMoreRow hidden={entries.length - rootLimit} depth={2} onShow={() => setRootLimit((value) => value + TREE_PAGE)} />}
        {entries.length === 0 && <p className="px-4 py-3 text-[11px] text-text-4">This folder is empty.</p>}
      </div>
      <div className="shrink-0 px-4 py-2 text-[10.5px] leading-4 text-text-4">
        {projectProfile(session.project, IDE_LANGUAGE_NAMES).summary}
      </div>
      {menu && <ContextMenu appearance="studio" x={menu.x} y={menu.y} items={buildTreeMenu(menu.entry, menuContext)} onSelect={selectMenuItem} onClose={() => setMenu(null)} />}
      <CodeStudioPathDialog sessionId={session.id} request={pathRequest} onClose={() => setPathRequest(null)} />
      <CodeStudioCompareDialog sessionId={session.id} sourcePath={compareRequest?.path ?? null} sourceDirectory={compareRequest?.directory ?? false} onClose={() => setCompareRequest(null)} />
      <CodeStudioGistDialog sessionId={session.id} relativePath={gistRequest} onClose={() => setGistRequest(null)} />
    </aside>
  )
})
