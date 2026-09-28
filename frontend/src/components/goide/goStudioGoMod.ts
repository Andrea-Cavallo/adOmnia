/** Azioni sulle dipendenze supportate dal backend (StartDependencyAction). */
export type GoModDependencyAction =
  | 'updateall' | 'updatepatch' | 'tidy' | 'download' | 'verify'
  | 'update' | 'remove' | 'replace' | 'dropreplace'

export interface GoModRequirement {
  line: number
  path: string
  version: string
  indirect: boolean
}

export interface GoModReplacement {
  line: number
  path: string
  target: string
}

export interface GoModOutline {
  /** Riga della direttiva module, 1 se assente. */
  moduleLine: number
  requirements: GoModRequirement[]
  replacements: GoModReplacement[]
}

export interface GoModLens {
  line: number
  title: string
  tooltip: string
  action: GoModDependencyAction
  modulePath?: string
}

const MODULE_DIRECTIVE = /^\s*module\s+\S+/
const BLOCK_START = /^\s*(require|replace)\s*\(\s*(\/\/.*)?$/
const SINGLE_DIRECTIVE = /^\s*(require|replace)\s+(.+)$/
const INDIRECT_COMMENT = /\/\/\s*indirect\b/

function stripComment(text: string): string {
  const index = text.indexOf('//')
  return (index < 0 ? text : text.slice(0, index)).trim()
}

function parseRequirement(text: string, line: number): GoModRequirement | null {
  const [path, version] = stripComment(text).split(/\s+/)
  if (!path || !version) return null
  return { line, path, version, indirect: INDIRECT_COMMENT.test(text) }
}

function parseReplacement(text: string, line: number): GoModReplacement | null {
  const [left, right] = stripComment(text).split('=>')
  const path = left?.trim().split(/\s+/)[0]
  const target = right?.trim()
  if (!path || !target) return null
  return { line, path, target }
}

/** Estrae module, require e replace da un go.mod senza dipendere dal language server. */
export function parseGoMod(text: string): GoModOutline {
  const outline: GoModOutline = { moduleLine: 1, requirements: [], replacements: [] }
  let block: 'require' | 'replace' | null = null
  let moduleFound = false
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1
    if (block) {
      if (raw.trim().startsWith(')')) { block = null; return }
      if (block === 'require') pushDefined(outline.requirements, parseRequirement(raw, line))
      else pushDefined(outline.replacements, parseReplacement(raw, line))
      return
    }
    if (!moduleFound && MODULE_DIRECTIVE.test(raw)) { outline.moduleLine = line; moduleFound = true; return }
    const blockMatch = BLOCK_START.exec(raw)
    if (blockMatch) { block = blockMatch[1] as 'require' | 'replace'; return }
    const single = SINGLE_DIRECTIVE.exec(raw)
    if (!single) return
    if (single[1] === 'require') pushDefined(outline.requirements, parseRequirement(single[2], line))
    else pushDefined(outline.replacements, parseReplacement(single[2], line))
  })
  return outline
}

function pushDefined<T>(target: T[], value: T | null): void {
  if (value) target.push(value)
}

const MODULE_WIDE_LENSES: ReadonlyArray<Omit<GoModLens, 'line'>> = [
  { title: '↑ Update all', tooltip: 'go get -u ./...', action: 'updateall' },
  { title: 'Update patches', tooltip: 'go get -u=patch ./...', action: 'updatepatch' },
  { title: 'Tidy', tooltip: 'go mod tidy', action: 'tidy' },
  { title: 'Download', tooltip: 'go mod download', action: 'download' },
  { title: 'Verify', tooltip: 'go mod verify', action: 'verify' },
]

/** Pulsanti rapidi sopra module e su ogni require/replace del go.mod. */
export function goModLenses(outline: GoModOutline): GoModLens[] {
  const lenses: GoModLens[] = MODULE_WIDE_LENSES.map((lens) => ({ ...lens, line: outline.moduleLine }))
  const replaced = new Set(outline.replacements.map((replacement) => replacement.path))
  for (const requirement of outline.requirements) {
    const { line, path } = requirement
    lenses.push({ line, title: '↑ Update', tooltip: `go get ${path}@latest`, action: 'update', modulePath: path })
    lenses.push(replaced.has(path)
      ? { line, title: 'Drop replace', tooltip: `go mod edit -dropreplace=${path}`, action: 'dropreplace', modulePath: path }
      : { line, title: 'Replace with local…', tooltip: `go mod edit -replace=${path}=<folder>`, action: 'replace', modulePath: path })
    lenses.push({ line, title: 'Remove', tooltip: `go get ${path}@none`, action: 'remove', modulePath: path })
  }
  for (const replacement of outline.replacements) {
    lenses.push({ line: replacement.line, title: 'Drop replace', tooltip: `go mod edit -dropreplace=${replacement.path}`, action: 'dropreplace', modulePath: replacement.path })
  }
  return lenses
}

/** Riga di comando mostrata nella conferma, identica a quella che eseguirà il backend. */
export function goModCommandLine(action: GoModDependencyAction, modulePath = '', localPath = ''): string {
  switch (action) {
    case 'updateall': return 'go get -u ./...'
    case 'updatepatch': return 'go get -u=patch ./...'
    case 'tidy': return 'go mod tidy'
    case 'download': return 'go mod download'
    case 'verify': return 'go mod verify'
    case 'update': return `go get ${modulePath}@latest`
    case 'remove': return `go get ${modulePath}@none`
    case 'replace': return `go mod edit -replace=${modulePath}=${localPath || '<folder>'}`
    case 'dropreplace': return `go mod edit -dropreplace=${modulePath}`
  }
}

/** Le azioni locali non toccano la rete: verify e le modifiche a replace non chiedono conferma. */
export function goModActionNeedsConfirmation(action: GoModDependencyAction): boolean {
  return action !== 'dropreplace' && action !== 'replace' && action !== 'verify'
}
