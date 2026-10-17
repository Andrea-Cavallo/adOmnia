import { nonGoTestTarget } from '@/lib/code-studio/testTargets'
import { goModules } from '@/lib/code-studio/goProject'
import { selectGoIDEFolder, startGoIDEDependencyAction, type GoIDESession } from '@/lib/code-studio-api'
import { confirm } from '@/lib/confirmDialog'
import { useCodeStudioTestsStore } from '@/stores/codeStudioTests'
import { activeGoIDEDocument, useCodeStudioStore, type GoIDEEditorDocument, type GoIDEQuickRunKind } from '@/stores/codeStudio'
import { affectedGoIDETestPackages, type GoIDETestRunRequest } from '@/lib/code-studio-tests-api'
import type { GoIDEVCSFileChange } from '@/lib/code-studio-vcs-api'
import { useCodeStudioVCSStore } from '@/stores/codeStudioVcs'
import type { GoIDEDebugRequest } from '@/lib/code-studio-debug-api'
import { benchmarkDebugArguments, runPatternFor } from '@/lib/code-studio/codeStudioTestTree'
import type { CodeStudioGoRunTarget } from './codeStudioRunTargets'
import { goModActionNeedsConfirmation, goModCommandLine, type GoModDependencyAction } from './codeStudioGoMod'

/** Ampiezza di un comando rapido: il package del file corrente o tutto il modulo (./...). */
export type CodeStudioQuickScope = 'package' | 'module'

export interface CodeStudioModuleScope {
  /** Cartella del modulo relativa al progetto, '' per la radice. */
  moduleDirectory: string
  /** Package del file relativo al modulo, es. "./internal/api" o ".". */
  packageTarget: string
}

export interface CodeStudioQuickRun {
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
  const baseKey = base.toLocaleLowerCase()
  const targetKey = target.toLocaleLowerCase()
  if (targetKey === baseKey) return ''
  return targetKey.startsWith(`${baseKey}/`) ? target.slice(base.length + 1) : null
}

function isWithin(directory: string, parent: string): boolean {
  return parent === '' || directory === parent || directory.startsWith(`${parent}/`)
}

/** Trova il modulo più interno che contiene il file, così i comandi go partono dalla cartella giusta. */
export function moduleScopeFor(session: Pick<GoIDESession, 'project'>, relativePath: string | null): CodeStudioModuleScope {
  const moduleDirectories = (goModules(session.project))
    .map((module) => relativeTo(session.project.realPath, module.path) ?? relativeTo(session.project.rootPath, module.path))
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

/**
 * Una richiesta di test per modulo con i package che contengono file Go modificati
 * (staged, unstaged o nuovi); i file cancellati non hanno più un package da testare.
 */
export function changedPackageTestRequests(session: Pick<GoIDESession, 'id' | 'project'>, changes: GoIDEVCSFileChange[]): GoIDETestRunRequest[] {
  const byModule = new Map<string, Set<string>>()
  for (const change of changes) {
    const path = normalize(change.relativePath)
    if (!path.endsWith('.go') || change.status.includes('D')) continue
    const scope = moduleScopeFor(session, path)
    const packages = byModule.get(scope.moduleDirectory) ?? new Set<string>()
    byModule.set(scope.moduleDirectory, packages.add(scope.packageTarget))
  }
  return [...byModule].map(([workingDirectory, packages]) => ({ sessionId: session.id, workingDirectory, packages: [...packages].sort(), run: '', bench: '', coverage: false }))
}

/** Esegue i test dei package toccati dalle modifiche locali e di quelli che li importano. */
export async function runCodeStudioChangedTests(): Promise<void> {
  const session = trustedSession(useCodeStudioStore.getState().activeSessionId)
  if (!session) return
  await useCodeStudioVCSStore.getState().refreshStatus(session.id)
  const status = useCodeStudioVCSStore.getState().status[session.id]
  if (!status?.available) return void useCodeStudioStore.setState({ error: 'The project is not in a Git repository.' })
  const requests = changedPackageTestRequests(session, status.changes)
  if (requests.length === 0) return void useCodeStudioStore.setState({ error: 'No changed Go files: nothing to test.' })
  for (const request of requests) {
    // Se go list fallisce (modulo che non compila) si testano almeno i package modificati.
    const packages = await affectedGoIDETestPackages(session.id, request.workingDirectory, request.packages).catch(() => request.packages)
    await useCodeStudioTestsStore.getState().start({ ...request, packages })
  }
}

/** Costruisce la richiesta di un comando rapido (build, test, vet, generate, install). */
export function quickRunFor(kind: GoIDEQuickRunKind, scope: CodeStudioQuickScope, moduleScope: CodeStudioModuleScope, options: { recursive?: boolean } = {}): CodeStudioQuickRun {
  const packageTarget = options.recursive
    ? moduleScope.packageTarget === '.' ? ALL_PACKAGES : `${moduleScope.packageTarget.replace(/\/$/, '')}/...`
    : moduleScope.packageTarget
  const target = scope === 'module' ? ALL_PACKAGES : packageTarget
  return { kind, workingDirectory: moduleScope.moduleDirectory, target, label: `go ${kind} ${target}` }
}

const NOT_TRUSTED_MESSAGE = 'Trust this project first (Go → Trust Project Tools) to run Go commands.'

/** Restituisce la sessione solo se il progetto è fidato; altrimenti lo spiega all'utente. */
function trustedSession(sessionId: string | null): GoIDESession | null {
  if (!sessionId) return null
  const session = useCodeStudioStore.getState().sessions.find((item) => item.id === sessionId) ?? null
  if (!session || session.project.authorization === 'tooling-permitted') return session
  useCodeStudioStore.setState({ error: NOT_TRUSTED_MESSAGE })
  return null
}

function editableRelativePath(document: GoIDEEditorDocument | null): string | null {
  return document && !document.document.external ? document.document.relativePath : null
}

/** Lancia un comando go rapido sul package del file attivo o sull'intero modulo. */
export async function runCodeStudioQuickCommand(kind: GoIDEQuickRunKind, scope: CodeStudioQuickScope, document?: GoIDEEditorDocument | null, options: { coverage?: boolean; race?: boolean } = {}): Promise<void> {
  const state = useCodeStudioStore.getState()
  const session = trustedSession(document?.document.sessionId ?? state.activeSessionId)
  if (!session) return
  const source = document === undefined ? activeGoIDEDocument(state) : document
  const request = quickRunFor(kind, scope, moduleScopeFor(session, editableRelativePath(source)))
  // I test passano dal runner strutturato (albero, rerun, coverage), non dalla console grezza.
  if (kind === 'test') {
    // Senza moduli Go, "Test All" gira sul runner dell'unità JS/TS invece di un `go test` che non ha nulla da testare.
    const fallback = scope === 'module' ? nonGoTestTarget(session.project) : null
    if (fallback) {
      await useCodeStudioTestsStore.getState().start({ sessionId: session.id, language: fallback.language, workingDirectory: fallback.workingDirectory, packages: fallback.packages })
      return
    }
    await useCodeStudioTestsStore.getState().start({ sessionId: session.id, workingDirectory: request.workingDirectory, packages: [request.target], coverage: options.coverage ?? false, race: options.race ?? false })
    return
  }
  await state.startRun(kind, { target: request.target, workingDirectory: request.workingDirectory })
}

/** Esegue tutti i benchmark del package o del modulo nel runner strutturato, con `-benchmem`. */
export async function runCodeStudioBenchmarks(scope: CodeStudioQuickScope, document?: GoIDEEditorDocument | null): Promise<void> {
  const state = useCodeStudioStore.getState()
  const session = trustedSession(document?.document.sessionId ?? state.activeSessionId)
  if (!session) return
  const source = document === undefined ? activeGoIDEDocument(state) : document
  const request = quickRunFor('test', scope, moduleScopeFor(session, editableRelativePath(source)))
  await useCodeStudioTestsStore.getState().start({ sessionId: session.id, workingDirectory: request.workingDirectory, packages: [request.target], run: '', bench: '.', coverage: false })
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
  const store = useCodeStudioStore.getState()
  try {
    await startGoIDEDependencyAction({ ...target, version: target.action === 'update' ? 'latest' : '', localPath, confirmed: true })
    store.updateLayout({ bottomOpen: true })
  } catch (error) {
    useCodeStudioStore.setState({ error: error instanceof Error ? error.message : String(error) })
  }
}

/** Cartella del modulo del go.mod aperto, relativa al progetto ('' per la radice). */
export function goModDirectoryOf(document: Pick<GoIDEEditorDocument, 'document'>): string {
  return directoryOf(normalize(document.document.relativePath))
}

/** Esegue un'azione rapida del go.mod: salva prima il buffer, poi lancia il comando go nella cartella del modulo. */
export async function runGoModQuickAction(document: GoIDEEditorDocument, action: GoModDependencyAction, modulePath = ''): Promise<void> {
  if (!trustedSession(document.document.sessionId)) return
  const moduleDirectory = goModDirectoryOf(document)
  let localPath = ''
  if (action === 'replace') {
    localPath = await selectGoIDEFolder(`Replace ${modulePath} with a local folder`)
    if (!localPath) return
  }
  if (!await confirmDependencyAction(action, modulePath, moduleDirectory)) return
  if (document.dirty && !await useCodeStudioStore.getState().saveDocument(document.document.id)) return
  await startDependencyAction({ sessionId: document.document.sessionId, moduleDirectory, action, modulePath }, localPath)
}

/** Azione sulle dipendenze dal menu Go: agisce sul modulo del file attivo, o sul primo del progetto. */
export async function runModuleDependencyAction(action: Extract<GoModDependencyAction, 'updateall' | 'updatepatch' | 'download' | 'verify'>): Promise<void> {
  const state = useCodeStudioStore.getState()
  const session = trustedSession(state.activeSessionId)
  if (!session) return
  const { moduleDirectory } = moduleScopeFor(session, editableRelativePath(activeGoIDEDocument(state)))
  if (!await confirmDependencyAction(action, '', moduleDirectory)) return
  const goMod = state.documents.find((item) => item.document.sessionId === session.id && item.document.relativePath === (moduleDirectory ? `${moduleDirectory}/go.mod` : 'go.mod'))
  if (goMod?.dirty && !await state.saveDocument(goMod.document.id)) return
  await startDependencyAction({ sessionId: session.id, moduleDirectory, action, modulePath: '' }, '')
}

/** Modulo e package di un target del gutter: i comandi go partono dal modulo che lo contiene. */
export function targetScope(session: Pick<GoIDESession, 'project'>, target: CodeStudioGoRunTarget): CodeStudioModuleScope {
  return moduleScopeFor(session, `${target.packagePath.replace(/^\.\/?/, '')}/_.go`)
}

/** Richiesta per il ▶ nel gutter di un test o benchmark: solo quella funzione, nel suo modulo. */
export function testRequestForTarget(session: Pick<GoIDESession, 'id' | 'project'>, target: CodeStudioGoRunTarget, coverage = false): GoIDETestRunRequest {
  const scope = targetScope(session, target)
  const pattern = runPatternFor(target.name)
  const benchmark = target.kind === 'benchmark'
  return { sessionId: session.id, workingDirectory: scope.moduleDirectory, packages: [scope.packageTarget], run: benchmark ? '' : pattern, bench: benchmark ? pattern : '', coverage }
}

/** Fuzzing esplicito e limitato: il tempo è visibile nel menu e l'utente può sempre fermare il processo. */
export function fuzzRunRequestForTarget(session: Pick<GoIDESession, 'project'>, target: CodeStudioGoRunTarget, fuzzTime = '30s', workers = 0) {
  const scope = targetScope(session, target)
  // fuzzTime vuoto: fuzzing finché l'utente non ferma il processo. workers 0: GOMAXPROCS, il default di Go.
  const programArguments = ['-run', '^$', '-fuzz', runPatternFor(target.name), ...(fuzzTime ? [`-fuzztime=${fuzzTime}`] : []), ...(workers > 0 ? [`-parallel=${workers}`] : [])]
  return { workingDirectory: scope.moduleDirectory, target: scope.packageTarget, programArguments }
}

/** Riesegue il target sul corpus in testdata/fuzz (tutto o un solo input), senza fuzzing. */
export function fuzzReplayRequestForTarget(session: Pick<GoIDESession, 'project'>, target: CodeStudioGoRunTarget, inputName?: string) {
  const scope = targetScope(session, target)
  const pattern = runPatternFor(inputName ? `${target.name}/${inputName}` : target.name)
  return { workingDirectory: scope.moduleDirectory, target: scope.packageTarget, programArguments: ['-run', pattern, '-v'] }
}

/** Richiesta di debug per il ▶ del gutter: func main, un test o un benchmark (eseguito una volta). */
export function debugRequestForTarget(session: Pick<GoIDESession, 'id' | 'project'>, target: CodeStudioGoRunTarget): GoIDEDebugRequest {
  const scope = targetScope(session, target)
  const base = { sessionId: session.id, workingDirectory: scope.moduleDirectory, target: scope.packageTarget }
  if (target.kind === 'main') return { ...base, mode: 'debug' }
  const pattern = runPatternFor(target.name)
  if (target.kind === 'benchmark') return { ...base, mode: 'test', testName: '^$', programArguments: benchmarkDebugArguments(pattern) }
  return { ...base, mode: 'test', testName: pattern }
}

/** Esegue test scelti per nome (es. quelli suggeriti dall'analisi d'impatto), raggruppati per modulo e package. */
export async function runCodeStudioNamedTests(sessionId: string, tests: readonly { file: string; packagePath: string; name: string }[]): Promise<void> {
  const session = trustedSession(sessionId)
  if (!session || tests.length === 0) return
  const groups = new Map<string, { workingDirectory: string; packagePath: string; names: Set<string> }>()
  for (const test of tests) {
    const workingDirectory = moduleScopeFor(session, test.file).moduleDirectory
    const key = `${workingDirectory}\u0000${test.packagePath}`
    const group = groups.get(key) ?? { workingDirectory, packagePath: test.packagePath, names: new Set<string>() }
    group.names.add(test.name)
    groups.set(key, group)
  }
  for (const group of groups.values()) {
    await useCodeStudioTestsStore.getState().start({ sessionId, workingDirectory: group.workingDirectory, packages: [group.packagePath], run: `^(${[...group.names].sort().join('|')})$`, bench: '', coverage: false })
  }
}
