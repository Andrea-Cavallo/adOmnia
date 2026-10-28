import { IDE_LANGUAGE_NAMES } from '@/components/ide/languages'

/** Il minimo che serve di una unità di build: linguaggio, tipo e radice assoluta. */
export interface UnitRef {
  language: string
  kind?: string
  root: string
  name?: string
}

/** Il minimo che serve del progetto: radice e unità rilevate dagli adapter. */
export interface ProjectRef {
  rootPath: string
  units?: ReadonlyArray<UnitRef> | null
}

/** Toglie le barre finali senza `/\/+$/`, che ha backtracking non lineare sui percorsi lunghi. */
const withoutTrailingSlashes = (value: string): string => {
  let end = value.length
  while (end > 0 && value[end - 1] === '/') end -= 1
  return value.slice(0, end)
}

export const normalizePath = (path: string): string => withoutTrailingSlashes(path.replace(/\\/g, '/'))

/**
 * Unità a cui appartiene un file: la radice **più specifica** che lo contiene (un crate dentro un
 * workspace appartiene al crate, non al workspace). `path` può essere assoluto o relativo alla
 * radice del progetto; il confronto ignora il case, perché su Windows lo stesso file arriva in due
 * forme. `null` quando il file è fuori da ogni unità (SDK, dipendenze, file di configurazione).
 */
export function unitForPath(project: ProjectRef | null | undefined, path: string): UnitRef | null {
  if (!project || !path) return null
  const units = project.units ?? []
  if (units.length === 0) return null
  const base = normalizePath(project.rootPath ?? '')
  let target = normalizePath(path)
  if (!target.startsWith('/') && !/^[a-z]:/i.test(target)) {
    if (!base) return null
    target = `${base}/${target}`
  }
  const lowerTarget = target.toLowerCase()
  let best: UnitRef | null = null
  let bestLength = -1
  for (const unit of units) {
    const root = normalizePath(unit.root)
    if (!root) continue
    const lowerRoot = root.toLowerCase()
    const inside = lowerTarget === lowerRoot || lowerTarget.startsWith(`${lowerRoot}/`)
    if (!inside) continue
    if (root.length > bestLength) {
      best = unit
      bestLength = root.length
    }
  }
  return best
}

/** Nome mostrato del linguaggio, dallo stesso registro della UI; l'id se non è registrato. */
export function languageName(language: string): string {
  const name = IDE_LANGUAGE_NAMES[language]
  if (name) return name
  if (!language) return 'Other'
  return language.charAt(0).toUpperCase() + language.slice(1)
}

/**
 * Linguaggio di un file per le etichette: prima l'unità (il caso normale), poi l'estensione per i
 * file fuori progetto (SDK, `go.mod`, un `.md`) dove l'unità non c'è.
 */
const EXTENSIONS: Readonly<Record<string, string>> = {
  go: 'go', py: 'python', pyi: 'python', java: 'java', kt: 'kotlin', rs: 'rust',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'typescript', jsx: 'typescript', mjs: 'typescript', cjs: 'typescript',
  html: 'html', htm: 'html', css: 'css', scss: 'css', less: 'css',
  json: 'json', jsonc: 'json',
}

/** Linguaggio di un file: `{ id, name }`, o `null` se non è riconoscibile. */
export function languageOfPath(project: ProjectRef | null | undefined, path: string): { id: string; name: string } | null {
  const unit = unitForPath(project, path)
  if (unit) return { id: unit.language, name: languageName(unit.language) }
  const file = normalizePath(path).split('/').pop() ?? ''
  const lower = file.toLowerCase()
  if (lower === 'go.mod' || lower === 'go.sum' || lower === 'go.work') return { id: 'go', name: languageName('go') }
  const extension = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : ''
  const language = EXTENSIONS[extension]
  if (!language) return null
  return { id: language, name: languageName(language) }
}

/** Percorso dell'unità relativo al progetto, per l'intestazione dei gruppi ('' per la radice). */
export function unitLabel(project: ProjectRef | null | undefined, unit: UnitRef | null, fallback = ''): string {
  if (!unit) return fallback
  const root = normalizePath(unit.root)
  const base = normalizePath(project?.rootPath ?? '')
  let relative = root
  if (base && root.toLowerCase() === base.toLowerCase()) relative = ''
  else if (base && root.toLowerCase().startsWith(`${base.toLowerCase()}/`)) relative = root.slice(base.length + 1)
  const name = unit.name || relative.split('/').pop() || base.split('/').pop() || ''
  return relative && relative !== name ? `${name} · ${relative}` : name
}

/**
 * Etichette delle unità per l'albero: percorso relativo della radice → nome del linguaggio. L'albero
 * le mostra sulle cartelle che sono unità di build, così un monorepo misto non resta senza nomi (6.5).
 */
export function unitBadges(project: ProjectRef | null | undefined): Record<string, string> {
  const badges: Record<string, string> = {}
  const base = normalizePath(project?.rootPath ?? '')
  for (const unit of project?.units ?? []) {
    const root = normalizePath(unit.root)
    if (!root) continue
    let relative = root
    if (base && root.toLowerCase().startsWith(`${base.toLowerCase()}/`)) relative = root.slice(base.length + 1)
    else if (base && root.toLowerCase() === base.toLowerCase()) relative = ''
    // La radice del progetto non ha una riga propria nell'albero: niente badge da mostrare.
    if (!relative) continue
    if (!(relative in badges)) badges[relative] = languageName(unit.language)
  }
  return badges
}
