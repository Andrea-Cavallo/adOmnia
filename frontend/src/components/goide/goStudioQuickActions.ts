import { selectGoIDEFolder, startGoIDEDependencyAction, type GoIDESession } from '@/lib/goide-api'
import { confirm } from '@/lib/confirmDialog'
import { activeGoIDEDocument, useGoIDEStore, type GoIDEEditorDocument, type GoIDEQuickRunKind } from '@/stores/goide'
import { goModActionNeedsConfirmation, goModCommandLine, type GoModDependencyAction } from './goStudioGoMod'

/** Ampiezza di un comando rapido: il package del file corrente o tutto il modulo (./...). */
export type GoStudioQuickScope = 'package' | 'module'

export interface GoStudioModuleScope {
  /** Cartella del modulo relativa al progetto, '' per la radice. */
  moduleDirectory: string
  /** Package del file relativo al modulo, es. "./internal/api" o ".". */
  packageTarget: string
}

export interface GoStudioQuickRun {
  kind: GoIDEQuickRunKind
  workingDirectory: string
  target: string
  label: string
}

const ALL_PACKAGES = './...'

function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

function directoryOf(relativePath: string): string {
  const slash = relativePath.lastIndexOf('/')
  return slash < 0 ? '' : relativePath.slice(0, slash)
}

function relativeTo(root: string, path: string): string | null {
  const base = normalize(root)
  const target = normalize(path)
  if (target === base) return ''
  return target.startsWith(`${base}/`) ? target.slice(base.length + 1) : null
}

function isWithin(directory: string, parent: string): boolean {
  return parent === '' || directory === parent || directory.startsWith(`${parent}/`)
}

/** Trova il modulo più interno che contiene il file, così i comandi go partono dalla cartella giusta. */
export function moduleScopeFor(session: Pick<GoIDESession, 'project'>, relativePath: string | null): GoStudioModuleScope {
  const moduleDirectories = (session.project.modules ?? [])
    .map((module) => relativeTo(session.project.realPath, module.path))
    .filter((directory): directory is string => directory !== null)
  const fileDirectory = relativePath ? directoryOf(normalize(relativePath)) : null
  const owning = fileDirectory === null
    ? moduleDirectories[0]
    : moduleDirectories.filter((directory) => isWithin(fileDirectory, directory)).sort((left, right) => right.length - left.length)[0]
  const moduleDirectory = owning ?? ''
  if (fileDirectory === null || !isWithin(fileDirectory, moduleDirectory)) return { moduleDirectory, packageTarget: '.' }
  const inner = moduleDirectory === '' ? fileDirectory : fileDirectory.slice(moduleDirectory.length + 1)
  return { moduleDirectory, packageTarget: inner ? `./${inner}` : '.' }
}

/** Costruisce la richiesta di un comando rapido (build, test, vet, generate, install). */
export function quickRunFor(kind: GoIDEQuickRunKind, scope: GoStudioQuickScope, moduleScope: GoStudioModuleScope): GoStudioQuickRun {
  const target = scope === 'module' ? ALL_PACKAGES : moduleScope.packageTarget
  return { kind, workingDirectory: moduleScope.moduleDirectory, target, label: `go ${kind} ${target}` }
}

const NOT_TRUSTED_MESSAGE = 'Trust this project first (Go → Trust Project Tools) to run Go commands.'

/** Restituisce la sessione solo se il progetto è fidato; altrimenti lo spiega all'utente. */
function trustedSession(sessionId: string | null): GoIDESession | null {
  if (!sessionId) return null
  const session = useGoIDEStore.getState().sessions.find((item) => item.id === sessionId) ?? null
  if (!session || session.project.authorization === 'tooling-permitted') return session
  useGoIDEStore.setState({ error: NOT_TRUSTED_MESSAGE })
  return null
}

function editableRelativePath(document: GoIDEEditorDocument | null): string | null {
  return document && !document.document.external ? document.document.relativePath : null
}

/** Lancia un comando go rapido sul package del file attivo o sull'intero modulo. */
export async function runGoStudioQuickCommand(kind: GoIDEQuickRunKind, scope: GoStudioQuickScope, document?: GoIDEEditorDocument | null): Promise<void> {
  const state = useGoIDEStore.getState()
  const session = trustedSession(document?.document.sessionId ?? state.activeSessionId)
  if (!session) return
  const source = document === undefined ? activeGoIDEDocument(state) : document
  const request = quickRunFor(kind, scope, moduleScopeFor(session, editableRelativePath(source)))
  await state.startRun(kind, { target: request.target, workingDirectory: request.workingDirectory })
}

async function confirmDependencyAction(action: GoModDependencyAction, modulePath: string, directory: string): Promise<boolean> {
  if (!goModActionNeedsConfirmation(action)) return true
  return confirm({
    title: 'Change module dependencies?',
    message: `Command: ${goModCommandLine(action, modulePath)}\nWorking directory: ${directory || '.'}\n\nThis may contact the configured Go proxy and will update go.mod/go.sum.`,
    confirmLabel: 'Run',
    variant: action === 'remove' ? 'danger' : 'default',
  })
}

interface DependencyActionTarget {
  sessionId: string
  moduleDirectory: string
  action: GoModDependencyAction
  modulePath: string
}

async function startDependencyAction(target: DependencyActionTarget, localPath: string): Promise<void> {
  const store = useGoIDEStore.getState()
  try {
    await startGoIDEDependencyAction({ ...target, version: target.action === 'update' ? 'latest' : '', localPath, confirmed: true })
    store.updateLayout({ bottomOpen: true })
  } catch (error) {
    useGoIDEStore.setState({ error: error instanceof Error ? error.message : String(error) })
  }
}

/** Esegue un'azione rapida del go.mod: salva prima il buffer, poi lancia il comando go nella cartella del modulo. */
export async function runGoModQuickAction(document: GoIDEEditorDocument, action: GoModDependencyAction, modulePath = ''): Promise<void> {
  if (!trustedSession(document.document.sessionId)) return
  const moduleDirectory = directoryOf(normalize(document.document.relativePath))
  let localPath = ''
  if (action === 'replace') {
    localPath = await selectGoIDEFolder(`Replace ${modulePath} with a local folder`)
    if (!localPath) return
  }
  if (!await confirmDependencyAction(action, modulePath, moduleDirectory)) return
  if (document.dirty && !await useGoIDEStore.getState().saveDocument(document.document.id)) return
  await startDependencyAction({ sessionId: document.document.sessionId, moduleDirectory, action, modulePath }, localPath)
}

/** Azione sulle dipendenze dal menu Go: agisce sul modulo del file attivo, o sul primo del progetto. */
export async function runModuleDependencyAction(action: Extract<GoModDependencyAction, 'updateall' | 'updatepatch' | 'download' | 'verify'>): Promise<void> {
  const state = useGoIDEStore.getState()
  const session = trustedSession(state.activeSessionId)
  if (!session) return
  const { moduleDirectory } = moduleScopeFor(session, editableRelativePath(activeGoIDEDocument(state)))
  if (!await confirmDependencyAction(action, '', moduleDirectory)) return
  const goMod = state.documents.find((item) => item.document.sessionId === session.id && item.document.relativePath === (moduleDirectory ? `${moduleDirectory}/go.mod` : 'go.mod'))
  if (goMod?.dirty && !await state.saveDocument(goMod.document.id)) return
  await startDependencyAction({ sessionId: session.id, moduleDirectory, action, modulePath: '' }, '')
}
