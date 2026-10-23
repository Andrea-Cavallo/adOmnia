import type { GoIDESession } from '@/lib/code-studio-api'
import { GO_LANGUAGE_ID } from './goLanguage'

type ProjectUnits = Pick<GoIDESession['project'], 'rootPath' | 'units'>

export interface GoProjectModule {
  /** Cartella del modulo, assoluta. */
  path: string
  modulePath?: string
}

/** Vista Go di un progetto: moduli, go.work e cartelle sciolte, ricavati dalle unità del backend. */
export interface GoProjectLayout {
  /** go.mod nella radice del progetto, vuoto se la radice non è un modulo. */
  goModPath: string
  goWorkPath: string
  modules: GoProjectModule[]
  /** Cartelle con file .go fuori da ogni modulo, relative alla radice con '/'. */
  looseGoDirs: string[]
}

/** Trailing slashes removed without `/\/+$/`, whose unbounded repetition before the end anchor is quadratic. */
const withoutTrailingSlashes = (path: string): string => {
  let end = path.length
  while (end > 0 && path[end - 1] === '/') end -= 1
  return path.slice(0, end)
}

const normalize = (path: string) => withoutTrailingSlashes(path.replace(/\\/g, '/'))

export function goProjectLayout(project: ProjectUnits): GoProjectLayout {
  const root = normalize(project.rootPath ?? '')
  const layout: GoProjectLayout = { goModPath: '', goWorkPath: '', modules: [], looseGoDirs: [] }
  for (const unit of project.units ?? []) {
    if (unit.language !== GO_LANGUAGE_ID) continue
    const unitRoot = normalize(unit.root)
    if (unit.kind === 'module') {
      layout.modules.push({ path: unit.root, modulePath: unit.name })
      if (unitRoot === root) layout.goModPath = unit.manifest ?? ''
    } else if (unit.kind === 'workspace') {
      layout.goWorkPath = unit.manifest ?? ''
    } else if (unit.kind === 'loose') {
      layout.looseGoDirs.push(unitRoot === root ? '.' : unitRoot.startsWith(`${root}/`) ? unitRoot.slice(root.length + 1) : unitRoot)
    }
  }
  return layout
}

/** Moduli Go del progetto (scorciatoia per i dialog che offrono un modulo da scegliere). */
export function goModules(project: ProjectUnits): GoProjectModule[] {
  return goProjectLayout(project).modules
}
