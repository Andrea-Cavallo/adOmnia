import {
  Bookmark, Bug, ChartNetwork, ClipboardPaste, Columns2, Copy, CopyPlus, FileCode2, FilePlus, FlaskConical, FolderCog, FolderOpen, FolderPlus, FolderSearch, GitBranch,
  GitCommitHorizontal, GitCompare, GitPullRequestArrow, Globe, Hammer, History, KeyRound, Pencil, Play, RefreshCw, Rows2, ScanSearch, Scissors, Search, Send, SquareTerminal, Trash2, Undo2, Upload, Wand2, Wrench,
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
  /** Percorsi modificati rispetto a HEAD, relativi alla radice del progetto. */
  changedPaths: string[]
}

const NEW_ITEMS: ContextMenuItem[] = [
  { id: 'newGoFile', label: 'Go File…', icon: FileCode2 },
  { id: 'newFile', label: 'File…', icon: FilePlus },
  { id: 'newFolder', label: 'Folder…', icon: FolderPlus },
  { id: 'newGitignore', label: '.gitignore', icon: GitBranch, submenu: [
    { id: 'newGitignoreGo', label: 'Go + Common Tools' },
    { id: 'newGitignoreNode', label: 'Node.js + Common Tools' },
    { id: 'newGitignorePython', label: 'Python + Common Tools' },
    { id: 'newGitignoreJava', label: 'Java / Kotlin + Common Tools' },
    { id: 'newGitignoreCommon', label: 'Common Tools Only', separatorBefore: true },
  ] },
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
  if (!entry) return []
  if (entry.directory) return [
    { id: 'refactor', label: 'Refactor', icon: Wand2, submenu: [
      { id: 'rename', label: 'Rename…', icon: Pencil, shortcut: 'Shift+F6' },
      { id: 'moveDirectory', label: 'Move Directory…', icon: FolderOpen, shortcut: 'F6' },
      { id: 'copyClasses', label: 'Copy Files…', icon: CopyPlus, shortcut: 'F5' },
      { id: 'safeDelete', label: 'Safe Delete…', icon: Trash2, shortcut: 'Alt+Delete', disabled: true, disabledReason: 'Package-safe delete analysis is not available for directories yet' },
      { id: 'migratePackages', label: 'Migrate Packages and Classes', disabled: true, disabledReason: 'No migration target is configured' },
    ] },
  ]
  if (!entry.name.endsWith('.go')) return []
  return [
    { id: 'refactor', label: 'Refactor', icon: Wand2, submenu: [
      { id: 'semanticRename', label: 'Rename Symbol…', icon: Pencil, shortcut: 'Shift+F6' },
      { id: 'refactorThis', label: 'Refactor This…', icon: Wand2 },
      { id: 'moveToNewFile', label: 'Move to New File', icon: FilePlus },
      { id: 'moveSymbol', label: 'Move Symbol to Package…', icon: FolderOpen },
      { id: 'copyClasses', label: 'Copy File…', icon: CopyPlus, shortcut: 'F5' },
      { id: 'safeDelete', label: 'Safe Delete…', icon: Trash2, shortcut: 'Alt+Delete', disabled: true, disabledReason: 'Use Find Usages before deleting a symbol' },
      { id: 'migratePackages', label: 'Migrate Packages and Classes', disabled: true, disabledReason: 'No migration target is configured' },
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
  const local = entry && !entry.directory ? [{ id: 'localHistory', label: 'Local History…', icon: History, separatorBefore: true }] : []
  if (!context.vcsAvailable) return local
  return [...local, {
    id: 'git', label: 'Git', icon: GitBranch, separatorBefore: local.length === 0,
    submenu: [
      { id: 'gitCommit', label: 'Commit…', icon: GitCommitHorizontal },
      { id: 'gitPull', label: 'Pull', icon: GitPullRequestArrow },
      { id: 'gitPush', label: 'Push…', icon: Upload },
      ...(entry ? [
        { id: 'gitStage', label: 'Add / Stage', separatorBefore: true },
        { id: 'gitUnstage', label: 'Unstage' },
        { id: 'gitRevert', label: 'Revert Local Changes…', icon: Undo2, danger: true },
      ] : []),
      ...(!entry || entry.directory ? [] : [
        { id: 'gitDiff', label: 'Show Diff', separatorBefore: true },
        { id: 'gitHistory', label: 'Show File History…', icon: History },
        { id: 'gitAnnotate', label: 'Annotate with Git Blame' },
      ]),
      { id: 'gitStudio', label: 'Open Project Git', icon: GitBranch, separatorBefore: true },
    ],
  }]
}

function quickGitItems(entry: GoIDEFileEntry | null, context: TreeMenuContext): ContextMenuItem[] {
  if (!context.vcsAvailable) return []
  const selectedPath = entry?.relativePath ?? ''
  const prefix = selectedPath ? `${selectedPath}/` : ''
  const hasChanges = context.changedPaths.some((path) => !selectedPath || path === selectedPath || (!!entry?.directory && path.startsWith(prefix)))
  return [
    { id: 'gitPullQuick', label: 'Git Pull', icon: GitPullRequestArrow, separatorBefore: true },
    ...(hasChanges ? [{ id: 'gitResetHead', label: 'Reset to HEAD…', icon: Undo2, danger: true }] : []),
  ]
}

function handoffItems(entry: GoIDEFileEntry | null): ContextMenuItem[] {
  if (!entry || entry.directory) return []
  return [
    ...(isApiCollectionCandidate(entry.relativePath) ? [{ id: 'sendToApi', label: 'Send to API Workspace', icon: Send, separatorBefore: true }] : []),
    ...(/\.(wsdl|xml)$/i.test(entry.relativePath) ? [{ id: 'soapTools', label: 'Open in SOAP Studio', icon: Send, separatorBefore: true }, { id: 'soapSecurity', label: 'Configure WS-Security', icon: KeyRound }] : []),
    ...(/\.(xml|xsd|wsdl)$/i.test(entry.relativePath) ? [{ id: 'xmlTools', label: 'Open in XML Tools', icon: FileCode2 }] : []),
    ...(/\.(pem|crt|cer)$/i.test(entry.relativePath) ? [{ id: 'mtlsTools', label: 'Configure HTTP mTLS', icon: KeyRound }] : []),
    ...(isPemCandidate(entry.relativePath) ? [{ id: 'pemTools', label: 'Inspect certificate / keystore', icon: KeyRound, separatorBefore: true }] : []),
  ]
}

/** I file HTML si aprono nella preview integrata (browser), quindi "Open In → Browser" vale solo per loro. */
function isHtmlFile(entry: GoIDEFileEntry | null): boolean {
  return !!entry && !entry.directory && /\.html?$/i.test(entry.relativePath)
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
    { id: 'repairIde', label: 'Repair IDE on File', icon: Wrench },
    { id: 'findInFiles', label: 'Find in Files…', icon: Search, shortcut: 'Ctrl+Shift+F' },
    { id: 'replaceInFiles', label: 'Replace in Files…', icon: Search, shortcut: 'Ctrl+Shift+R' },
    ...(isFile ? [] : [{ id: 'findInFolder', label: 'Find in Folder…', icon: Search }]),
    ...goItems(entry),
    { id: 'openInGroup', label: 'Open In', icon: FolderOpen, separatorBefore: true, submenu: [
      ...(isHtmlFile(entry) ? [{ id: 'openInBrowser', label: 'Browser', icon: Globe }] : []),
      { id: 'reveal', label: 'File Explorer', icon: FolderSearch },
      { id: 'terminal', label: 'Terminal', icon: SquareTerminal },
    ] },
    ...quickGitItems(entry, context),
    ...historyItems(entry, context),
    ...(entry ? [{ id: 'compareWith', label: 'Compare With…', icon: GitCompare, shortcut: 'Ctrl+D', separatorBefore: true }] : []),
    ...(entry?.directory ? [{ id: 'markDirectory', label: 'Mark Directory As', icon: FolderCog, submenu: [
      { id: 'markSources', label: 'Sources Root' },
      { id: 'markTests', label: 'Test Sources Root' },
      { id: 'markResources', label: 'Resources Root' },
      { id: 'markExcluded', label: 'Excluded' },
      { id: 'unmarkDirectory', label: 'Cancel Marking', separatorBefore: true },
    ] }] : []),
    ...(entry && !entry.directory ? [{ id: 'createGist', label: 'Create Gist…', icon: GitBranch }] : []),
    { id: 'diagrams', label: 'Diagrams', icon: ChartNetwork, submenu: [
      { id: 'diagramDependencies', label: 'Package & Dependency Graph' },
      { id: 'diagramCalls', label: 'Call Graph' },
      { id: 'diagramInterfaces', label: 'Interface Diagram' },
    ] },
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
  if (key === 'd') return 'compareWith'
  return null
}
