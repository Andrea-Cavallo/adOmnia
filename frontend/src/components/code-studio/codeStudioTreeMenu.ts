import {
  Bug, ClipboardPaste, Copy, CopyPlus, Ellipsis, FileCode2, FilePlus, FolderOpen, GitBranch, GitCompare, KeyRound, Pencil, Play, Radio, Scissors, Search, Send, Trash2, Undo2, Wand2,
} from 'lucide-react'
import type { ContextMenuItem } from '@/components/ui/ContextMenu'
import type { GoIDEFileEntry } from '@/lib/code-studio-api'
import { isApiCollectionCandidate, isPemCandidate } from './codeStudioFileHandoffs'

export interface TreeMenuContext {
  /** C'è qualcosa negli appunti dell'albero da incollare. */
  canPaste: boolean
  /** Il progetto è in un repository Git. */
  vcsAvailable: boolean
  /** Il progetto ha almeno un go.mod: l'import path ha senso. */
  hasGoModule: boolean
  /** Il progetto ha un'unità Java: compaiono New Java Class/Package. */
  hasJava?: boolean
  /** Percorsi modificati rispetto a HEAD, relativi alla radice del progetto. */
  changedPaths: string[]
}

type Entry = GoIDEFileEntry | null

/*
 * Menu pulito: al primo livello solo le azioni frequenti, una icona distinta per gruppo,
 * il resto in sottomenu senza icone ripetute. Gli id non cambiano: scorciatoie e azioni restano le stesse.
 */

const JAVA_NEW_ITEMS: ContextMenuItem[] = [
  { id: 'newJavaClass', label: 'Java Class…' },
  { id: 'newJavaInterface', label: 'Java Interface…' },
  { id: 'newJavaEnum', label: 'Java Enum…' },
  { id: 'newJavaRecord', label: 'Java Record…' },
  { id: 'newJavaPackage', label: 'Java Package…' },
]

const NEW_ITEMS: ContextMenuItem[] = [
  { id: 'newFile', label: 'File…' },
  { id: 'newFolder', label: 'Folder…' },
  { id: 'newGoFile', label: 'Go File…', separatorBefore: true },
  { id: 'newGitignore', label: '.gitignore', submenu: [
    { id: 'newGitignoreGo', label: 'Go + Common Tools' },
    { id: 'newGitignoreNode', label: 'Node.js + Common Tools' },
    { id: 'newGitignorePython', label: 'Python + Common Tools' },
    { id: 'newGitignoreJava', label: 'Java / Kotlin + Common Tools' },
    { id: 'newGitignoreCommon', label: 'Common Tools Only', separatorBefore: true },
  ] },
]

const isGoFile = (entry: Entry): entry is GoIDEFileEntry => !!entry && !entry.directory && entry.name.endsWith('.go')

/** I file HTML si aprono nella preview integrata (browser), quindi "Open In → Browser" vale solo per loro. */
function isHtmlFile(entry: Entry): boolean {
  return !!entry && !entry.directory && /\.html?$/i.test(entry.relativePath)
}

function openItems(entry: Entry): ContextMenuItem[] {
  if (!entry || entry.directory) return []
  return [
    { id: 'open', label: 'Open', icon: FileCode2 },
    ...(isHtmlFile(entry) ? [{ id: 'openWithLivePreview', label: 'Open with Live Preview', icon: Radio }] : []),
  ]
}

function newItem(entry: Entry, context: TreeMenuContext): ContextMenuItem {
  return { id: 'new', label: 'New', icon: FilePlus, separatorBefore: !!entry && !entry.directory, submenu: context.hasJava ? [...NEW_ITEMS, { ...JAVA_NEW_ITEMS[0], separatorBefore: true }, ...JAVA_NEW_ITEMS.slice(1)] : NEW_ITEMS }
}

function copyReferenceItems(entry: Entry, context: TreeMenuContext): ContextMenuItem[] {
  const isGoPackage = !entry || entry.directory || entry.name.endsWith('.go')
  return [
    { id: 'copyAbsolutePath', label: 'Absolute Path', shortcut: 'Ctrl+Shift+C' },
    ...(entry ? [{ id: 'copyRelativePath', label: 'Path From Project Root', shortcut: 'Ctrl+Alt+Shift+C' }] : []),
    { id: 'copyFileName', label: entry?.directory === false ? 'File Name' : 'Folder Name' },
    ...(isGoPackage && context.hasGoModule ? [{ id: 'copyImportPath', label: 'Go Import Path' }] : []),
  ]
}

function clipboardItems(entry: Entry, context: TreeMenuContext): ContextMenuItem[] {
  return [
    ...(entry ? [
      { id: 'cut', label: 'Cut', icon: Scissors, shortcut: 'Ctrl+X', separatorBefore: true },
      { id: 'copy', label: 'Copy', icon: Copy, shortcut: 'Ctrl+C' },
    ] : []),
    { id: 'paste', label: 'Paste', icon: ClipboardPaste, shortcut: 'Ctrl+V', separatorBefore: !entry, disabled: !context.canPaste, disabledReason: 'Copy or cut a file or folder first' },
    { id: 'copyReference', label: 'Copy Path', submenu: copyReferenceItems(entry, context) },
  ]
}

function refactorItem(entry: GoIDEFileEntry): ContextMenuItem | null {
  if (entry.directory) return { id: 'refactor', label: 'Refactor', icon: Wand2, submenu: [
    { id: 'rename', label: 'Rename…', shortcut: 'Shift+F6' },
    { id: 'moveDirectory', label: 'Move Directory…', shortcut: 'F6' },
    { id: 'copyClasses', label: 'Copy Files…', shortcut: 'F5' },
    { id: 'safeDelete', label: 'Safe Delete…', shortcut: 'Alt+Delete', disabled: true, disabledReason: 'Package-safe delete analysis is not available for directories yet' },
    { id: 'migratePackages', label: 'Migrate Packages and Classes', disabled: true, disabledReason: 'No migration target is configured' },
  ] }
  if (!isGoFile(entry)) return null
  return { id: 'refactor', label: 'Refactor', icon: Wand2, submenu: [
    { id: 'semanticRename', label: 'Rename Symbol…', shortcut: 'Shift+F6' },
    { id: 'refactorThis', label: 'Refactor This…' },
    { id: 'moveToNewFile', label: 'Move to New File' },
    { id: 'moveSymbol', label: 'Move Symbol to Package…' },
    { id: 'copyClasses', label: 'Copy File…', shortcut: 'F5' },
    { id: 'safeDelete', label: 'Safe Delete…', shortcut: 'Alt+Delete', disabled: true, disabledReason: 'Use Find Usages before deleting a symbol' },
    { id: 'migratePackages', label: 'Migrate Packages and Classes', disabled: true, disabledReason: 'No migration target is configured' },
    { id: 'reformat', label: 'Reformat Code', shortcut: 'Ctrl+Alt+L', separatorBefore: true },
    { id: 'optimizeImports', label: 'Optimize Imports', shortcut: 'Ctrl+Alt+O' },
  ] }
}

function editItems(entry: Entry): ContextMenuItem[] {
  if (!entry) return []
  const refactor = refactorItem(entry)
  return [
    { id: 'rename', label: 'Rename…', icon: Pencil, shortcut: 'Shift+F6', separatorBefore: true },
    { id: 'duplicate', label: 'Duplicate…', icon: CopyPlus },
    ...(refactor ? [refactor] : []),
    { id: 'delete', label: 'Delete…', icon: Trash2, shortcut: 'Delete', danger: true },
  ]
}

function findItem(entry: Entry): ContextMenuItem {
  const goFile = isGoFile(entry)
  return { id: 'find', label: 'Find', icon: Search, separatorBefore: true, submenu: [
    ...(goFile ? [{ id: 'findUsages', label: 'Find Usages', shortcut: 'Alt+F7' }] : []),
    ...(entry && !entry.directory ? [] : [{ id: 'findInFolder', label: 'Find in Folder…' }]),
    { id: 'findInFiles', label: 'Find in Files…', shortcut: 'Ctrl+Shift+F' },
    { id: 'replaceInFiles', label: 'Replace in Files…', shortcut: 'Ctrl+Shift+R' },
    ...(goFile ? [{ id: 'inspectCode', label: 'Inspect Code…', separatorBefore: true }] : []),
  ] }
}

function goItems(entry: Entry): ContextMenuItem[] {
  if (entry && !entry.directory && !entry.name.endsWith('.go')) return []
  return [
    { id: 'goPackage', label: 'Go Package', icon: Play, submenu: [
      { id: 'testPackage', label: 'Test Package' },
      { id: 'testPackageCoverage', label: 'Test Package with Coverage' },
      { id: 'buildPackage', label: 'Build Package', separatorBefore: true },
      { id: 'vetPackage', label: 'Vet Package' },
      { id: 'generatePackage', label: 'Go Generate' },
    ] },
    { id: 'runCurrent', label: 'Run Current Configuration', icon: Play, iconClassName: 'text-success' },
    { id: 'debugCurrent', label: 'Debug Current Configuration', icon: Bug },
  ]
}

function gitItems(entry: Entry, context: TreeMenuContext): ContextMenuItem[] {
  const compare: ContextMenuItem[] = entry ? [{ id: 'compareWith', label: 'Compare With…', icon: GitCompare, shortcut: 'Ctrl+D', separatorBefore: !context.vcsAvailable }] : []
  if (!context.vcsAvailable) return compare
  const selectedPath = entry?.relativePath ?? ''
  const prefix = selectedPath ? `${selectedPath}/` : ''
  const hasChanges = context.changedPaths.some((path) => !selectedPath || path === selectedPath || (!!entry?.directory && path.startsWith(prefix)))
  const isFile = !!entry && !entry.directory
  return [{
    id: 'git', label: 'Git', icon: GitBranch, separatorBefore: true,
    submenu: [
      { id: 'gitCommit', label: 'Commit…' },
      { id: 'gitPull', label: 'Pull' },
      { id: 'gitPush', label: 'Push…' },
      ...(entry ? [
        { id: 'gitStage', label: 'Add / Stage', separatorBefore: true },
        { id: 'gitUnstage', label: 'Unstage' },
        { id: 'gitRevert', label: 'Revert Local Changes…', danger: true },
      ] : []),
      ...(hasChanges ? [{ id: 'gitResetHead', label: 'Reset to HEAD…', icon: Undo2, danger: true, separatorBefore: !entry }] : []),
      ...(isFile ? [
        { id: 'gitDiff', label: 'Show Diff', separatorBefore: true },
        { id: 'gitHistory', label: 'Show File History…' },
        { id: 'gitAnnotate', label: 'Annotate with Git Blame' },
      ] : []),
      { id: 'gitStudio', label: 'Open Project Git', separatorBefore: true },
    ],
  }, ...compare]
}

function openInItem(entry: Entry): ContextMenuItem {
  const isFile = !!entry && !entry.directory
  return { id: 'openInGroup', label: 'Open In', icon: FolderOpen, separatorBefore: true, submenu: [
    ...(isFile ? [{ id: 'splitRight', label: 'Split Right' }, { id: 'splitDown', label: 'Split Down' }] : []),
    ...(isHtmlFile(entry) ? [{ id: 'openInBrowser', label: 'Browser', separatorBefore: true }] : []),
    { id: 'reveal', label: 'File Explorer', separatorBefore: isFile && !isHtmlFile(entry) },
    { id: 'terminal', label: 'Terminal' },
  ] }
}

/** Azioni rare raccolte in un solo punto: non affollano il primo livello. */
function moreItem(entry: Entry): ContextMenuItem {
  const isFile = !!entry && !entry.directory
  return { id: 'more', label: 'More', icon: Ellipsis, submenu: [
    isFile ? { id: 'reloadFromDisk', label: 'Reload from Disk' } : { id: 'refreshProject', label: entry ? 'Refresh Folder' : 'Refresh Project' },
    { id: 'repairIde', label: 'Repair IDE on File' },
    ...(isFile ? [{ id: 'localHistory', label: 'Local History…', separatorBefore: true }] : []),
    ...(isGoFile(entry) ? [
      { id: 'toggleBookmark', label: 'Toggle Bookmark', shortcut: 'F11', separatorBefore: !isFile },
      { id: 'showBookmarks', label: 'Show Bookmarks…', shortcut: 'Shift+F11' },
    ] : []),
    ...(entry?.directory ? [{ id: 'markDirectory', label: 'Mark Directory As', separatorBefore: true, submenu: [
      { id: 'markSources', label: 'Sources Root' },
      { id: 'markTests', label: 'Test Sources Root' },
      { id: 'markResources', label: 'Resources Root' },
      { id: 'markExcluded', label: 'Excluded' },
      { id: 'unmarkDirectory', label: 'Cancel Marking', separatorBefore: true },
    ] }] : []),
    ...(isFile ? [{ id: 'createGist', label: 'Create Gist…' }] : []),
    { id: 'diagrams', label: 'Diagrams', separatorBefore: true, submenu: [
      { id: 'diagramDependencies', label: 'Package & Dependency Graph' },
      { id: 'diagramCalls', label: 'Call Graph' },
      { id: 'diagramInterfaces', label: 'Interface Diagram' },
    ] },
  ] }
}

function handoffItems(entry: Entry): ContextMenuItem[] {
  if (!entry || entry.directory) return []
  return [
    ...(isApiCollectionCandidate(entry.relativePath) ? [{ id: 'sendToApi', label: 'Send to API Workspace', icon: Send, separatorBefore: true }] : []),
    ...(/\.(wsdl|xml)$/i.test(entry.relativePath) ? [{ id: 'soapTools', label: 'Open in SOAP Studio', icon: Send, separatorBefore: true }, { id: 'soapSecurity', label: 'Configure WS-Security', icon: KeyRound }] : []),
    ...(/\.(xml|xsd|wsdl)$/i.test(entry.relativePath) ? [{ id: 'xmlTools', label: 'Open in XML Tools', icon: FileCode2 }] : []),
    ...(/\.(pem|crt|cer)$/i.test(entry.relativePath) ? [{ id: 'mtlsTools', label: 'Configure HTTP mTLS', icon: KeyRound }] : []),
    ...(isPemCandidate(entry.relativePath) ? [{ id: 'pemTools', label: 'Inspect certificate / keystore', icon: KeyRound, separatorBefore: true }] : []),
  ]
}

/** Menu contestuale del Project view. entry null = radice del progetto. */
export function buildTreeMenu(entry: Entry, context: TreeMenuContext): ContextMenuItem[] {
  return [
    ...openItems(entry),
    newItem(entry, context),
    ...clipboardItems(entry, context),
    ...editItems(entry),
    findItem(entry),
    ...goItems(entry),
    ...gitItems(entry, context),
    openInItem(entry),
    moreItem(entry),
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
