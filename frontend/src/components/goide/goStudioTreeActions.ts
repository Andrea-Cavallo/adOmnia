import { goModules } from '@/lib/goide/goProject'
import { create } from 'zustand'
import { duplicateGoIDEPath, moveGoIDEPath, type GoIDESession } from '@/lib/goide-api'
import type { GoIDEQuickRunKind, GoIDESplitOrientation } from '@/stores/goide'
import { useGoIDEStore } from '@/stores/goide'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { useGoIDETestsStore } from '@/stores/goideTests'
import { absolutePath, baseName, duplicateName, joinRelative, parentOf } from './goStudioFileActions'
import { moduleScopeFor, quickRunFor } from './goStudioQuickActions'

/** Placeholder di file usato per chiedere il package di una cartella a moduleScopeFor, che ragiona per file. */
const DIRECTORY_PROBE = '.'
/** Tentativi massimi per trovare un nome libero incollando in una cartella che ha già l'elemento. */
const MAX_PASTE_NAME_ATTEMPTS = 50

export type GoStudioCopyReference = 'absolute' | 'relative' | 'name' | 'import'

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
export const useGoStudioTreeClipboard = create<TreeClipboardState>((set) => ({
  clipboard: null,
  setClipboard: (clipboard) => set({ clipboard }),
}))

function reportError(error: unknown): void {
  useGoIDEStore.setState({ error: error instanceof Error ? error.message : String(error) })
}

function report(message: string): void {
  useGoIDELspStore.setState({ message })
}

/** Import path Go della cartella (o della cartella del file): modulo più interno + percorso relativo. */
export function goImportPath(session: Pick<GoIDESession, 'project'>, relativePath: string, directory: boolean): string | null {
  const packageDirectory = directory ? relativePath : parentOf(relativePath)
  const scope = moduleScopeFor(session, joinRelative(packageDirectory, DIRECTORY_PROBE))
  const module = (goModules(session.project)).find((item) => {
    const root = session.project.realPath.replace(/\\/g, '/').replace(/\/+$/, '')
    const path = item.path.replace(/\\/g, '/').replace(/\/+$/, '')
    return path === (scope.moduleDirectory ? `${root}/${scope.moduleDirectory}` : root)
  })
  if (!module?.modulePath) return null
  const inner = scope.packageTarget === '.' ? '' : scope.packageTarget.replace(/^\.\//, '')
  return inner ? `${module.modulePath}/${inner}` : module.modulePath
}

export function referenceText(session: GoIDESession, relativePath: string, directory: boolean, kind: GoStudioCopyReference): string | null {
  switch (kind) {
    case 'absolute': return absolutePath(session.project.rootPath, relativePath)
    case 'relative': return relativePath
    case 'name': return baseName(relativePath) || session.project.name
    case 'import': return goImportPath(session, relativePath, directory)
  }
}

export async function copyReference(session: GoIDESession, relativePath: string, directory: boolean, kind: GoStudioCopyReference): Promise<void> {
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

/** Incolla nella cartella: Copy duplica, Cut sposta. Non sovrascrive mai: in caso di nome occupato ne sceglie uno libero. */
export async function pasteInto(sessionId: string, folder: string): Promise<void> {
  const { clipboard, setClipboard } = useGoStudioTreeClipboard.getState()
  if (!clipboard || clipboard.sessionId !== sessionId) return report('Nothing to paste: copy or cut a file in this project first.')
  if (isInside(folder, clipboard.relativePath)) return report('A folder cannot be pasted inside itself.')
  const store = useGoIDEStore.getState()
  if (clipboard.mode === 'cut' && parentOf(clipboard.relativePath) === folder) return setClipboard(null)
  await store.loadDirectory(folder)
  const siblings = useGoIDEStore.getState().directoryEntries[sessionId]?.[folder] ?? []
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
  const store = useGoIDEStore.getState()
  const previous = store.activeDocumentBySession[sessionId]
  await store.openDocument(relativePath)
  const state = useGoIDEStore.getState()
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
  const request = quickRunFor(kind, 'package', moduleScopeFor(session, joinRelative(packageDirectory, DIRECTORY_PROBE)))
  try {
    if (kind === 'test') {
      await useGoIDETestsStore.getState().start({ sessionId: session.id, workingDirectory: request.workingDirectory, packages: [request.target], coverage, race: false })
      return
    }
    await useGoIDEStore.getState().startRun(kind, { target: request.target, workingDirectory: request.workingDirectory })
  } catch (error) {
    reportError(error)
  }
}

/** Find in Files limitato alla cartella, come "Find in Folder…" di IntelliJ. */
export function findInFolder(relativePath: string): void {
  useGoIDELspStore.getState().requestFind('', relativePath ? `${relativePath}/**` : '')
}

/** Nuovo terminale già posizionato nella cartella. */
export function openTerminalIn(relativePath: string): void {
  useGoIDELspStore.getState().requestTerminal(relativePath)
}
