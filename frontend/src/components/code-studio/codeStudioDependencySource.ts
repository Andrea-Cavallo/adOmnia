import { monaco } from '@/lib/monacoRef'
import { useCodeStudioStore, type GoIDEEditorDocument } from '@/stores/codeStudio'
import { resolveGoIDEDependencySource, startGoIDEDependencyAction, type GoIDEDependencySource } from '@/lib/code-studio-api'
import { confirm } from '@/lib/confirmDialog'
import { parseGoMod } from './codeStudioGoMod'
import { goModDirectoryOf } from './codeStudioQuickActions'
import { navigateToLocation, type StudioLocation } from './codeStudioNavigation'
import { revealSymbolOrigin } from './codeStudioOriginTree'

const FIRST_LINE = { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 }
/** Oltre questa attesa si rilegge comunque: il messaggio di errore dice cosa manca. */
const DOWNLOAD_WAIT_MS = 120_000

/** Si risolve quando il comando è finito: l'avvio ritorna subito, il modulo arriva dopo. */
function executionFinished(id: string): Promise<void> {
  const finished = () => useCodeStudioStore.getState().executions.some((item) => item.id === id && item.status !== 'running')
  return new Promise((resolve) => {
    if (finished()) { resolve(); return }
    const stop = () => { clearTimeout(timer); unsubscribe(); resolve() }
    const timer = setTimeout(stop, DOWNLOAD_WAIT_MS)
    const unsubscribe = useCodeStudioStore.subscribe(() => { if (finished()) stop() })
  })
}

function normalizePath(path: string): string {
  // `(?<!\/)` ancora il gruppo di barre finali: senza, la regex riprova da ogni posizione.
  return path.replace(/\\/g, '/').replace(/(?<!\/)\/+$/, '')
}

function isWithin(path: string, root: string): boolean {
  const target = normalizePath(path).toLowerCase()
  const parent = normalizePath(root).toLowerCase()
  return target === parent || target.startsWith(`${parent}/`)
}

function joinRelative(base: string, file: string): string {
  return [normalizePath(base), normalizePath(file)].filter(Boolean).join('/')
}

/** Il file da aprire per primo nel sorgente di una dipendenza. */
export function entryFileOf(source: GoIDEDependencySource): string {
  return source.entryPath || source.files[0]?.path || ''
}

/** Il progetto importato che contiene il percorso, se ce n'è uno: il suo codice si apre in modifica. */
function ownerSessionOf(path: string): { id: string; root: string } | null {
  for (const session of useCodeStudioStore.getState().sessions) {
    for (const root of [session.project.realPath, session.project.rootPath]) {
      if (root && isWithin(path, root)) {
        return { id: session.id, root }
      }
    }
  }
  return null
}

/** Percorso assoluto relativo alla radice del progetto che lo contiene. */
function relativeToRoot(root: string, path: string): string {
  const parent = normalizePath(root)
  const target = normalizePath(path)
  return target.toLowerCase().startsWith(`${parent.toLowerCase()}/`) ? target.slice(parent.length + 1) : target
}

/**
 * Dove aprire un file del sorgente di una dipendenza: dentro il progetto in modifica, in un progetto
 * importato lì, altrimenti in sola lettura come SDK Go e module cache. Niente URI: serve Monaco, che
 * non è ancora caricato quando dall'albero si apre il primo file.
 */
function goModSourceTarget(source: GoIDEDependencySource, sessionId: string, file: string): Omit<StudioLocation, 'uri'> | null {
  if (!source.directory || !file) return null
  const path = `${source.directory}/${normalizePath(file)}`
  if (source.relativeDir) {
    return { path, relativePath: joinRelative(source.relativeDir, file), external: false, targetSessionId: sessionId, range: FIRST_LINE }
  }
  const owner = ownerSessionOf(source.directory)
  if (owner) {
    return { path, relativePath: relativeToRoot(owner.root, path), external: false, targetSessionId: owner.id, range: FIRST_LINE }
  }
  return { path, relativePath: normalizePath(path), external: true, range: FIRST_LINE }
}

/** Posizione per i provider dell'editor (Ctrl+click, F12), che girano solo con Monaco caricato. */
export function goModSourceLocation(source: GoIDEDependencySource, sessionId: string, file: string): StudioLocation | null {
  const target = goModSourceTarget(source, sessionId, file)
  return target && { ...target, uri: monaco.Uri.file(target.path).toString() }
}

/** Apre un file del sorgente di una dipendenza; null se il sorgente non ha quel file. */
export function openDependencySourceFile(source: GoIDEDependencySource, sessionId: string, file: string): Omit<StudioLocation, 'uri'> | null {
  const target = goModSourceTarget(source, sessionId, file)
  if (target) navigateToLocation(target)
  return target
}

/**
 * Risolve il sorgente di una dipendenza del go.mod. Se il modulo non è ancora nella module cache
 * propone `go mod download <modulo>`, poi rilegge: senza download non c'è codice da mostrare.
 */
export async function ensureGoModDependencySource(sessionId: string, moduleDirectory: string, modulePath: string): Promise<GoIDEDependencySource | null> {
  try {
    const source = await resolveGoIDEDependencySource(sessionId, moduleDirectory, modulePath)
    if (!source.found) {
      useCodeStudioStore.setState({ error: source.reason || `${modulePath} is not a dependency of this go.mod.` })
      return null
    }
    if (source.downloaded) return source
    const download = await confirm({
      title: 'Download module source?',
      message: `The code of ${modulePath} is not in the Go module cache yet.\n\nCommand: go mod download ${modulePath}\n\nReading the code needs the module downloaded on this machine.`,
      details: [
        { label: 'Module', value: source.version ? `${modulePath} ${source.version}` : modulePath },
        { label: 'Module cache', value: source.directory || '', mono: true },
      ],
      confirmLabel: 'Download',
    })
    if (!download) return null
    const execution = await startGoIDEDependencyAction({ sessionId, moduleDirectory, action: 'download', modulePath, version: '', localPath: '', confirmed: true })
    await executionFinished(execution.id)
    const downloaded = await resolveGoIDEDependencySource(sessionId, moduleDirectory, modulePath)
    if (!downloaded.downloaded) {
      useCodeStudioStore.setState({ error: downloaded.reason || `${modulePath} is not available in the module cache.` })
      return null
    }
    return downloaded
  } catch (error) {
    useCodeStudioStore.setState({ error: error instanceof Error ? error.message : String(error) })
    return null
  }
}

/** Dipendenza del go.mod sulla riga del cursore: il require o il replace di quel modulo. */
export function goModDependencyAt(buffer: string, line: number): string | null {
  const outline = parseGoMod(buffer)
  return outline.requirements.find((item) => item.line === line)?.path
    ?? outline.replacements.find((item) => item.line === line)?.path
    ?? null
}

/** Definizione di una riga del go.mod per Ctrl+click e F12: il sorgente del modulo. */
export async function goModDefinitionLocation(document: GoIDEEditorDocument, line: number): Promise<StudioLocation | null> {
  const modulePath = goModDependencyAt(document.buffer, line)
  if (!modulePath) return null
  const source = await ensureGoModDependencySource(document.document.sessionId, goModDirectoryOf(document), modulePath)
  if (!source) return null
  return goModSourceLocation(source, document.document.sessionId, entryFileOf(source))
}

/** Apre il file di ingresso di una dipendenza e mostra il modulo nell'albero a sinistra, per esplorarlo. */
export async function openGoModDependencySource(document: GoIDEEditorDocument, modulePath: string): Promise<void> {
  const sessionId = document.document.sessionId
  const source = await ensureGoModDependencySource(sessionId, goModDirectoryOf(document), modulePath)
  if (!source) return
  const location = openDependencySourceFile(source, sessionId, entryFileOf(source))
  if (!location) return
  // Un file esterno lo rivela External Libraries quando diventa attivo; uno di progetto l'albero del progetto.
  if (location.external) useCodeStudioStore.getState().updateLayout({ projectOpen: true })
  else if (location.relativePath) revealSymbolOrigin(location.targetSessionId ?? sessionId, location.relativePath)
}
