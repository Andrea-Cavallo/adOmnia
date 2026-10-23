import { goModules } from '@/lib/code-studio/goProject'
import { create } from 'zustand'
import { duplicateGoIDEPath, moveGoIDEPath, type GoIDESession } from '@/lib/code-studio-api'
import type { GoIDEQuickRunKind, GoIDESplitOrientation } from '@/stores/codeStudio'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { useCodeStudioTestsStore } from '@/stores/codeStudioTests'
import { absolutePath, baseName, duplicateName, joinRelative, parentOf } from './codeStudioFileActions'
import { moduleScopeFor, quickRunFor } from './codeStudioQuickActions'
import { pullGoIDERepository, pushGoIDERepository, revertGoIDEFiles, stageGoIDEFiles, type GoIDEVCSFileChange } from '@/lib/code-studio-vcs-api'
import { useCodeStudioVCSStore } from '@/stores/codeStudioVcs'
import { confirm } from '@/lib/confirmDialog'
import { presentGitFailure } from '@/lib/git/gitFailure'

/** Placeholder di file usato per chiedere il package di una cartella a moduleScopeFor, che ragiona per file. */
const DIRECTORY_PROBE = '.'
/** Tentativi massimi per trovare un nome libero incollando in una cartella che ha già l'elemento. */
const MAX_PASTE_NAME_ATTEMPTS = 50

export type CodeStudioCopyReference = 'absolute' | 'relative' | 'name' | 'import'

interface TreeClipboard {
  sessionId: string
  relativePath: string
  mode: 'copy' | 'cut'
}

interface TreeClipboardState {
  clipboard: TreeClipboard | null
  setClipboard: (clipboard: TreeClipboard | null) => void
}

/** Appunti dell'albero: separati da quelli di sistema, così Ctrl+C sul file non sovrascrive il testo copiato. */
export const useCodeStudioTreeClipboard = create<TreeClipboardState>((set) => ({
  clipboard: null,
  setClipboard: (clipboard) => set({ clipboard }),
}))

function reportError(error: unknown): void {
  useCodeStudioStore.setState({ error: error instanceof Error ? error.message : String(error) })
}

function report(message: string): void {
  useCodeStudioLspStore.setState({ message })
}

/**
 * Toglie le barre finali camminando dalla coda: `\/+$` su un percorso arbitrario è
 * backtracking non lineare, e qui il percorso può arrivare dall'utente.
 */
function withoutTrailingSlashes(value: string): string {
  let end = value.length
  while (end > 0 && value[end - 1] === '/') end -= 1
  return value.slice(0, end)
}

function withoutEdgeSlashes(value: string): string {
  let start = 0
  while (start < value.length && value[start] === '/') start += 1
  return withoutTrailingSlashes(value.slice(start))
}

/** Import path Go della cartella (o della cartella del file): modulo più interno + percorso relativo. */
export function goImportPath(session: Pick<GoIDESession, 'project'>, relativePath: string, directory: boolean): string | null {
  const packageDirectory = directory ? relativePath : parentOf(relativePath)
  const scope = moduleScopeFor(session, joinRelative(packageDirectory, DIRECTORY_PROBE))
  const module = (goModules(session.project)).find((item) => {
    const root = withoutTrailingSlashes(session.project.realPath.replace(/\\/g, '/'))
    const path = withoutTrailingSlashes(item.path.replace(/\\/g, '/'))
    return path === (scope.moduleDirectory ? `${root}/${scope.moduleDirectory}` : root)
  })
  if (!module?.modulePath) return null
  const inner = scope.packageTarget === '.' ? '' : scope.packageTarget.replace(/^\.\//, '')
  return inner ? `${module.modulePath}/${inner}` : module.modulePath
}

export function referenceText(session: GoIDESession, relativePath: string, directory: boolean, kind: CodeStudioCopyReference): string | null {
  switch (kind) {
    case 'absolute': return absolutePath(session.project.rootPath, relativePath)
    case 'relative': return relativePath
    case 'name': return baseName(relativePath) || session.project.name
    case 'import': return goImportPath(session, relativePath, directory)
  }
}

export async function copyReference(session: GoIDESession, relativePath: string, directory: boolean, kind: CodeStudioCopyReference): Promise<void> {
  const text = referenceText(session, relativePath, directory, kind)
  if (!text) return report('No Go module owns this folder: there is no import path to copy.')
  try {
    await navigator.clipboard.writeText(text)
    report(`Copied ${text}`)
  } catch (error) {
    reportError(error)
  }
}

/** Primo nome libero nella cartella: main.go, poi main_copy.go, main_copy_copy.go… come il Duplicate. */
export function freeName(name: string, taken: ReadonlySet<string>): string | null {
  let candidate = name
  for (let attempt = 0; attempt < MAX_PASTE_NAME_ATTEMPTS; attempt += 1) {
    if (!taken.has(candidate)) return candidate
    candidate = duplicateName(candidate)
  }
  return null
}

function isInside(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`)
}

/** Destinazione di un drop nel Project tree. Null significa drop non valido o nessuno spostamento. */
export function treeDropDestination(source: string, targetFolder: string): string | null {
  const normalizedSource = withoutEdgeSlashes(source.replace(/\\/g, '/'))
  const normalizedTarget = withoutEdgeSlashes(targetFolder.replace(/\\/g, '/'))
  if (!normalizedSource || isInside(normalizedTarget, normalizedSource)) return null
  const destination = joinRelative(normalizedTarget, baseName(normalizedSource))
  return destination === normalizedSource ? null : destination
}

/** Drag & drop: sposta un elemento nella cartella scelta senza rinominare o sovrascrivere. */
export async function moveTreePath(sessionId: string, source: string, targetFolder: string): Promise<boolean> {
  const destination = treeDropDestination(source, targetFolder)
  if (!destination) {
    report(parentOf(source) === targetFolder ? 'The item is already in this folder.' : 'A folder cannot be moved inside itself.')
    return false
  }
  const store = useCodeStudioStore.getState()
  const semanticGoMove = /\.go$/i.test(source) && parentOf(source) !== targetFolder
  const dirty = store.documents.filter((item) => item.document.sessionId === sessionId && item.dirty && (semanticGoMove ? /\.go$/i.test(item.document.relativePath) : isInside(item.document.relativePath, source)))
  if (dirty.length > 0) {
    report(`Save or discard the changes in ${dirty.map((item) => item.document.relativePath).join(', ')} before moving it.`)
    return false
  }
  await store.loadDirectory(targetFolder)
  const siblings = useCodeStudioStore.getState().directoryEntries[sessionId]?.[targetFolder] ?? []
  if (siblings.some((entry) => entry.name === baseName(source))) {
    report(`${destination} already exists. Rename one of the items before moving it.`)
    return false
  }
  try {
    const open = store.documents.filter((item) => item.document.sessionId === sessionId && isInside(item.document.relativePath, source))
    for (const item of open) await store.closeDocument(item.document.id)
    await moveGoIDEPath(sessionId, source, destination)
    await store.refreshProject()
    report(semanticGoMove ? `Moved ${source} to ${destination} and updated Go references.` : `Moved ${source} to ${destination}`)
    return true
  } catch (error) {
    reportError(error)
    return false
  }
}

export function gitChangesUnder(changes: GoIDEVCSFileChange[], relativePath: string, directory: boolean): GoIDEVCSFileChange[] {
  if (!relativePath) return changes
  const prefix = `${relativePath}/`
  return changes.filter((change) => change.relativePath === relativePath || (directory && change.relativePath.startsWith(prefix)))
}

/** Operazioni Git del menu Project. Resta tutto nel repository locale salvo Pull/Push espliciti. */
export async function runTreeGitAction(sessionId: string, id: 'stage' | 'unstage' | 'revert' | 'reset' | 'pull' | 'push', relativePath: string, directory: boolean): Promise<void> {
  const vcs = useCodeStudioVCSStore.getState()
  const status = vcs.status[sessionId]
  if (!status?.available) return report('This project is not in a Git repository.')
  try {
    if (id === 'pull') {
      await pullGoIDERepository(sessionId)
      await Promise.all([vcs.refreshStatus(sessionId), useCodeStudioStore.getState().refreshProject()])
      return report('Pull completed.')
    }
    if (id === 'push') {
      const accepted = await confirm({ title: 'Push current branch?', message: `Publish ${status.branch || 'the current branch'} to origin.`, confirmLabel: 'Push' })
      if (!accepted) return
      await pushGoIDERepository(sessionId)
      await vcs.refreshStatus(sessionId)
      return report('Push completed.')
    }
    const selected = gitChangesUnder(status.changes, relativePath, directory)
    if (selected.length === 0) return report('No Git changes in this selection.')
    const paths = selected.map((change) => change.relativePath)
    if (id === 'revert' || id === 'reset') {
      const scope = relativePath || 'the project'
      const accepted = await confirm({
        title: id === 'reset' ? `Reset ${scope} to HEAD?` : `Revert ${paths.length === 1 ? paths[0] : `${paths.length} files`}?`,
        message: 'Tracked changes will be replaced with HEAD. New files will be removed from disk and kept in Local History.',
        details: paths.slice(0, 8).map((path) => ({ label: 'File', value: path, mono: true })),
        confirmLabel: id === 'reset' ? 'Reset to HEAD' : 'Revert', variant: 'danger',
      })
      if (!accepted) return
      await revertGoIDEFiles(sessionId, paths)
      const changed = new Set(paths)
      const open = useCodeStudioStore.getState().documents.filter((item) => item.document.sessionId === sessionId && changed.has(item.document.relativePath))
      for (const item of open) await useCodeStudioStore.getState().closeDocument(item.document.id)
      await Promise.all([vcs.refreshStatus(sessionId), useCodeStudioStore.getState().refreshProject(relativePath && !directory ? parentOf(relativePath) : relativePath)])
      return report(id === 'reset' ? `Reset ${paths.length} file(s) to HEAD.` : `Reverted ${paths.length} file(s).`)
    }
    await stageGoIDEFiles(sessionId, paths, id === 'stage')
    await vcs.refreshStatus(sessionId)
    report(`${id === 'stage' ? 'Staged' : 'Unstaged'} ${paths.length} file(s).`)
  } catch (error) {
    if (id !== 'pull' && id !== 'push') return reportError(error)
    const refresh = () => Promise.all([vcs.refreshStatus(sessionId), useCodeStudioStore.getState().refreshProject()]).then(() => undefined)
    await presentGitFailure({
      error, operation: id, repoPath: status.repoRoot ?? '',
      retry: () => id === 'pull' ? pullGoIDERepository(sessionId) : pushGoIDERepository(sessionId),
      onSettled: refresh,
    })
  }
}

/** Incolla nella cartella: Copy duplica, Cut sposta. Non sovrascrive mai: in caso di nome occupato ne sceglie uno libero. */
export async function pasteInto(sessionId: string, folder: string): Promise<void> {
  const { clipboard, setClipboard } = useCodeStudioTreeClipboard.getState()
  if (!clipboard || clipboard.sessionId !== sessionId) return report('Nothing to paste: copy or cut a file in this project first.')
  if (isInside(folder, clipboard.relativePath)) return report('A folder cannot be pasted inside itself.')
  const store = useCodeStudioStore.getState()
  if (clipboard.mode === 'cut' && parentOf(clipboard.relativePath) === folder) return setClipboard(null)
  await store.loadDirectory(folder)
  const siblings = useCodeStudioStore.getState().directoryEntries[sessionId]?.[folder] ?? []
  const name = freeName(baseName(clipboard.relativePath), new Set(siblings.map((entry) => entry.name)))
  if (!name) return report('Could not find a free name in the target folder.')
  const destination = joinRelative(folder, name)
  try {
    if (clipboard.mode === 'cut') {
      const dirty = store.documents.filter((item) => item.document.sessionId === sessionId && item.dirty && isInside(item.document.relativePath, clipboard.relativePath))
      if (dirty.length > 0) return report(`Save or discard the changes in ${dirty.map((item) => item.document.relativePath).join(', ')} before moving it.`)
      const open = store.documents.filter((item) => item.document.sessionId === sessionId && isInside(item.document.relativePath, clipboard.relativePath))
      for (const item of open) await store.closeDocument(item.document.id)
      await moveGoIDEPath(sessionId, clipboard.relativePath, destination)
      setClipboard(null)
      await Promise.all([store.loadDirectory(parentOf(clipboard.relativePath)), store.loadDirectory(folder)])
    } else {
      await duplicateGoIDEPath(sessionId, clipboard.relativePath, destination)
      await store.loadDirectory(folder)
    }
  } catch (error) {
    reportError(error)
  }
}

/** Apre il file nello split indicato lasciando nell'editor principale il file che c'era. */
export async function openInSplit(sessionId: string, relativePath: string, orientation: GoIDESplitOrientation): Promise<void> {
  const store = useCodeStudioStore.getState()
  const previous = store.activeDocumentBySession[sessionId]
  await store.openDocument(relativePath)
  const state = useCodeStudioStore.getState()
  const opened = state.activeDocumentBySession[sessionId]
  if (!opened) return
  const hadSplit = !!state.splitBySession[sessionId]
  state.setSplit(orientation)
  if (hadSplit) state.setSplitDocument(opened)
  if (previous && previous !== opened) state.selectDocument(previous)
}

/** Comando go (build, test, vet, generate) sul package della cartella o del file scelto nell'albero. */
export async function runPackageCommand(session: GoIDESession, relativePath: string, directory: boolean, kind: GoIDEQuickRunKind, coverage = false): Promise<void> {
  if (session.project.authorization !== 'tooling-permitted') return reportError('Trust this project first (Go → Trust Project Tools) to run Go commands.')
  const packageDirectory = directory ? relativePath : parentOf(relativePath)
  const request = quickRunFor(kind, 'package', moduleScopeFor(session, joinRelative(packageDirectory, DIRECTORY_PROBE)), { recursive: directory })
  try {
    if (kind === 'test') {
      await useCodeStudioTestsStore.getState().start({ sessionId: session.id, workingDirectory: request.workingDirectory, packages: [request.target], coverage, race: false })
      return
    }
    await useCodeStudioStore.getState().startRun(kind, { target: request.target, workingDirectory: request.workingDirectory })
  } catch (error) {
    reportError(error)
  }
}

/** Find in Files limitato alla cartella. */
export function findInFolder(relativePath: string): void {
  useCodeStudioLspStore.getState().requestFind('', relativePath ? `${relativePath}/**` : '')
}

/** "Repair IDE on File": riavvia gopls (ricostruisce l'indice) e rilegge il progetto. */
export async function repairIde(sessionId: string, relativePath: string, directory: boolean): Promise<void> {
  await useCodeStudioLspStore.getState().restart(sessionId)
  await useCodeStudioStore.getState().refreshProject(directory ? relativePath : '')
}

/** Find in Files globale. */
export function findInFiles(): void {
  useCodeStudioLspStore.getState().requestFind('')
}

/** Replace in Files globale: apre Find in Files con il campo sostituzione pronto. */
export function replaceInFiles(): void {
  useCodeStudioLspStore.getState().requestFind('', undefined, 'replace')
}

/** Apre un file HTML nella preview integrata (browser), come "Open In → Browser". */
export async function previewHtml(relativePath: string): Promise<void> {
  await useCodeStudioStore.getState().openDocument(relativePath)
  useCodeStudioStore.getState().requestHtmlPreview('preview')
}

/** Nuovo terminale già posizionato nella cartella. */
export function openTerminalIn(relativePath: string): void {
  useCodeStudioLspStore.getState().requestTerminal(relativePath)
}
