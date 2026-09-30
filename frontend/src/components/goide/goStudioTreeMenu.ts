import {
  Bookmark, Bug, ClipboardPaste, Columns2, Copy, CopyPlus, FileCode2, FilePlus, FlaskConical, FolderOpen, FolderPlus, FolderSearch, GitBranch,
  Hammer, History, KeyRound, Pencil, Play, RefreshCw, Rows2, ScanSearch, Scissors, Search, Send, SquareTerminal, Trash2, Wand2,
} from 'lucide-react'
import type { ContextMenuItem } from '@/components/ui/ContextMenu'
import type { GoIDEFileEntry } from '@/lib/goide-api'
import { isApiCollectionCandidate, isPemCandidate } from './goStudioFileHandoffs'

export interface TreeMenuContext {
  /** C'è qualcosa negli appunti dell'albero da incollare. */
  canPaste: boolean
  /** Il progetto è in un repository Git. */
  vcsAvailable: boolean
  /** Il progetto ha almeno un go.mod: l'import path ha senso. */
  hasGoModule: boolean
}

const NEW_ITEMS: ContextMenuItem[] = [
  { id: 'newGoFile', label: 'Go File…', icon: FileCode2 },
  { id: 'newFile', label: 'File…', icon: FilePlus },
  { id: 'newFolder', label: 'Folder…', icon: FolderPlus },
]

function copyReferenceItems(entry: GoIDEFileEntry | null, context: TreeMenuContext): ContextMenuItem[] {
  const isGoPackage = !entry || entry.directory || entry.name.endsWith('.go')
  return [
    { id: 'copyAbsolutePath', label: 'Absolute Path', shortcut: 'Ctrl+Shift+C' },
    ...(entry ? [{ id: 'copyRelativePath', label: 'Path From Project Root', shortcut: 'Ctrl+Alt+Shift+C' }] : []),
    { id: 'copyFileName', label: entry?.directory === false ? 'File Name' : 'Folder Name' },
    ...(isGoPackage && context.hasGoModule ? [{ id: 'copyImportPath', label: 'Go Import Path' }] : []),
  ]
}

function clipboardItems(entry: GoIDEFileEntry | null, context: TreeMenuContext): ContextMenuItem[] {
  return [
    ...(entry ? [
      { id: 'cut', label: 'Cut', icon: Scissors, shortcut: 'Ctrl+X', separatorBefore: true },
      { id: 'copy', label: 'Copy', icon: Copy, shortcut: 'Ctrl+C' },
    ] : []),
    { id: 'copyReference', label: 'Copy Path/Reference…', icon: Copy, separatorBefore: !entry, submenu: copyReferenceItems(entry, context) },
    { id: 'paste', label: 'Paste', icon: ClipboardPaste, shortcut: 'Ctrl+V', disabled: !context.canPaste, disabledReason: 'Copy or cut a file or folder first' },
  ]
}

function goItems(entry: GoIDEFileEntry | null): ContextMenuItem[] {
  if (entry && !entry.directory && !entry.name.endsWith('.go')) return []
  return [{
    id: 'goPackage', label: 'Go Package', icon: Play, iconClassName: 'text-success', separatorBefore: true,
    submenu: [
      { id: 'testPackage', label: 'Test Package', icon: FlaskConical },
      { id: 'testPackageCoverage', label: 'Test Package with Coverage', icon: FlaskConical },
      { id: 'buildPackage', label: 'Build Package', icon: Hammer, separatorBefore: true },
      { id: 'vetPackage', label: 'Vet Package', icon: ScanSearch },
      { id: 'generatePackage', label: 'Go Generate', icon: Wand2 },
    ],
  },
  { id: 'runCurrent', label: 'Run Current Configuration', icon: Play, iconClassName: 'text-success', separatorBefore: true },
  { id: 'debugCurrent', label: 'Debug Current Configuration', icon: Bug, iconClassName: 'text-danger' }]
}

/** Azioni semantiche già offerte dall'editor, rese raggiungibili anche dal Project view. */
function ideItems(entry: GoIDEFileEntry | null): ContextMenuItem[] {
  if (!entry || entry.directory || !entry.name.endsWith('.go')) return []
  return [
    { id: 'findUsages', label: 'Find Usages', icon: Search, shortcut: 'Alt+F7', separatorBefore: true },
    { id: 'analyze', label: 'Analyze', icon: ScanSearch, submenu: [
      { id: 'inspectCode', label: 'Inspect Code…', icon: ScanSearch },
    ] },
  ]
}

/** Gruppo code nello stesso punto del menu di IntelliJ: dopo Rename, prima di Delete. */
function codeItems(entry: GoIDEFileEntry | null): ContextMenuItem[] {
  if (!entry || entry.directory || !entry.name.endsWith('.go')) return []
  return [
    { id: 'refactor', label: 'Refactor', icon: Wand2, submenu: [
      { id: 'refactorThis', label: 'Refactor This…', icon: Wand2 },
      { id: 'moveToNewFile', label: 'Move to New File', icon: FilePlus },
    ] },
    { id: 'bookmarks', label: 'Bookmarks', icon: Bookmark, submenu: [
      { id: 'toggleBookmark', label: 'Toggle Bookmark', icon: Bookmark, shortcut: 'F11' },
      { id: 'showBookmarks', label: 'Show Bookmarks…', icon: Bookmark, shortcut: 'Shift+F11' },
    ] },
    { id: 'reformat', label: 'Reformat Code', icon: Wand2, shortcut: 'Ctrl+Alt+L', separatorBefore: true },
    { id: 'optimizeImports', label: 'Optimize Imports', icon: Wand2, shortcut: 'Ctrl+Alt+O' },
  ]
}

function historyItems(entry: GoIDEFileEntry | null, context: TreeMenuContext): ContextMenuItem[] {
  if (!entry || entry.directory) return []
  return [
    { id: 'localHistory', label: 'Local History…', icon: History, separatorBefore: true },
    ...(context.vcsAvailable ? [{
      id: 'git', label: 'Git', icon: GitBranch,
      submenu: [
        { id: 'gitHistory', label: 'Show File History…', icon: History },
        { id: 'gitAnnotate', label: 'Annotate with Git Blame' },
      ],
    }] : []),
  ]
}

function handoffItems(entry: GoIDEFileEntry | null): ContextMenuItem[] {
  if (!entry || entry.directory) return []
  return [
    ...(isApiCollectionCandidate(entry.relativePath) ? [{ id: 'sendToApi', label: 'Send to API Workspace', icon: Send, separatorBefore: true }] : []),
    ...(isPemCandidate(entry.relativePath) ? [{ id: 'pemTools', label: 'Open in Power Tools: Inspect / Encrypt Key', icon: KeyRound, separatorBefore: true }] : []),
  ]
}

/** Menu contestuale del Project view, nell'ordine di GoLand. entry null = radice del progetto. */
export function buildTreeMenu(entry: GoIDEFileEntry | null, context: TreeMenuContext): ContextMenuItem[] {
  const isFile = !!entry && !entry.directory
  const code = codeItems(entry)
  return [
    ...(isFile ? [
      { id: 'open', label: 'Open', icon: FileCode2 },
      { id: 'openIn', label: 'Open in Split', icon: Columns2, submenu: [
        { id: 'splitRight', label: 'Split Right', icon: Columns2 },
        { id: 'splitDown', label: 'Split Down', icon: Rows2 },
      ] },
    ] : []),
    { id: 'new', label: 'New', icon: FilePlus, separatorBefore: isFile, submenu: NEW_ITEMS },
    ...clipboardItems(entry, context),
    ...ideItems(entry),
    ...(entry ? [
      { id: 'rename', label: 'Rename…', icon: Pencil, shortcut: 'Shift+F6', separatorBefore: true },
      { id: 'duplicate', label: 'Duplicate…', icon: CopyPlus },
      ...code,
      { id: 'delete', label: 'Delete…', icon: Trash2, shortcut: 'Delete', danger: true, separatorBefore: code.length > 0 },
    ] : []),
    ...(isFile
      ? [{ id: 'reloadFromDisk', label: 'Reload from Disk', icon: RefreshCw, separatorBefore: true }]
      : [{ id: 'refreshProject', label: entry ? 'Refresh Folder' : 'Refresh Project', icon: RefreshCw, separatorBefore: true }]),
    ...(isFile ? [] : [{ id: 'findInFolder', label: 'Find in Folder…', icon: Search, separatorBefore: true }]),
    ...goItems(entry),
    { id: 'openInGroup', label: 'Open In', icon: FolderOpen, separatorBefore: true, submenu: [
      { id: 'reveal', label: 'File Explorer', icon: FolderSearch },
      { id: 'terminal', label: 'Terminal', icon: SquareTerminal },
    ] },
    ...historyItems(entry, context),
    ...handoffItems(entry),
  ]
}

/** Scorciatoie del Project view di GoLand; Cmd vale come Ctrl su macOS. */
export function treeKeyAction(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): string | null {
  const mod = event.ctrlKey || event.metaKey
  const key = event.key.toLowerCase()
  if (event.key === 'F2' || (event.key === 'F6' && event.shiftKey)) return 'rename'
  if (event.key === 'Delete') return 'delete'
  if (!mod) return null
  if (key === 'c' && event.shiftKey && event.altKey) return 'copyRelativePath'
  if (key === 'c' && event.shiftKey) return 'copyAbsolutePath'
  if (event.shiftKey || event.altKey) return null
  if (key === 'x') return 'cut'
  if (key === 'c') return 'copy'
  if (key === 'v') return 'paste'
  return null
}
