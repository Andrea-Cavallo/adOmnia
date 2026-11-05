import type { GoIDEDependencyState } from '@/lib/code-studio-api'

/** Una dipendenza mostrata nell'albero: stessa coppia modulo@versione una volta sola, anche con più go.mod. */
export interface ExternalLibrary {
  path: string
  version: string
  indirect: boolean
  /** Il go.mod che la richiede, da cui risolverne il sorgente. */
  moduleDirectory: string
  replaced: boolean
  local: boolean
  /** Cartella del sorgente, nota in anticipo solo per le replace: non segue lo schema della module cache. */
  directory?: string
}

/**
 * Le dipendenze di tutti i go.mod del progetto, dirette prima. I moduli del progetto stesso restano
 * fuori: il loro codice è già nell'albero sopra.
 */
export function mergeLibraries(states: GoIDEDependencyState[], ownModulePaths: ReadonlySet<string>): ExternalLibrary[] {
  const merged = new Map<string, ExternalLibrary>()
  for (const state of states) {
    for (const dependency of state.dependencies) {
      if (ownModulePaths.has(dependency.path)) continue
      const key = `${dependency.path}@${dependency.version}`
      const known = merged.get(key)
      if (known) {
        merged.set(key, { ...known, indirect: known.indirect && dependency.indirect })
        continue
      }
      const replacement = state.replacements.find((item) => item.path === dependency.path && (!item.version || item.version === dependency.version))
      merged.set(key, { path: dependency.path, version: dependency.version, indirect: dependency.indirect, moduleDirectory: state.moduleDirectory, replaced: !!replacement, local: !!replacement?.local })
    }
  }
  return [...merged.values()].sort((left, right) => Number(left.indirect) - Number(right.indirect) || left.path.localeCompare(right.path))
}

/** Come la module cache scrive percorsi e versioni: una maiuscola diventa `!` più la minuscola. */
function escapeForModuleCache(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `!${letter.toLowerCase()}`)
}

function normalized(path: string): string {
  return path.replace(/\\/g, '/').replace(/(?<!\/)\/+$/, '')
}

/** La dipendenza che contiene un file esterno aperto, e il file relativo al modulo: l'albero lo rivela. */
export function libraryOfPath(path: string, libraries: ExternalLibrary[]): { library: ExternalLibrary; file: string } | null {
  const target = normalized(path)
  // Il confronto è senza maiuscole per i percorsi di Windows; toLowerCase non cambia gli indici su ASCII.
  const folded = target.toLowerCase()
  for (const library of libraries) {
    const directory = library.directory && normalized(library.directory).toLowerCase()
    if (directory && folded.startsWith(`${directory}/`)) return { library, file: target.slice(directory.length + 1) }
    const marker = `/${escapeForModuleCache(library.path)}@${escapeForModuleCache(library.version)}/`.toLowerCase()
    const index = folded.indexOf(marker)
    if (!library.replaced && index >= 0) return { library, file: target.slice(index + marker.length) }
  }
  return null
}

/** Il nome corto di un modulo: l'host è quasi sempre lo stesso e nell'albero stretto nasconderebbe il resto. */
export function displayName(modulePath: string): string {
  const [host, ...rest] = modulePath.split('/')
  return host.includes('.') && rest.length > 0 ? rest.join('/') : modulePath
}

/** Una pseudo-versione dice commit e data, le uniche parti leggibili: v0.0.0-20261001120000-abcdef123456. */
export function displayVersion(version: string): string {
  const pseudo = /[-.](\d{4})(\d{2})(\d{2})\d{6}-([0-9a-f]{12})(?:\+incompatible)?$/.exec(version)
  return pseudo ? `${pseudo[4].slice(0, 7)} · ${pseudo[1]}-${pseudo[2]}-${pseudo[3]}` : version
}
