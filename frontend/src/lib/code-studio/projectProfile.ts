import type { GoIDESession } from '@/lib/code-studio-api'
import { goModules, goProjectLayout } from './goProject'
import { GO_LANGUAGE_ID } from './goLanguage'

type Project = Pick<GoIDESession['project'], 'rootPath' | 'units'>

/** Cosa c'è nel progetto aperto, per le parti dell'IDE che oggi parlano solo di Go (barra Run, status bar, albero). */
export interface ProjectProfile {
  /** Il progetto ha almeno un'unità Go (modulo, go.work o cartella sciolta). */
  hasGo: boolean
  /** Linguaggio della prima unità, Go incluso; null se nessuna unità è stata rilevata. */
  primaryLanguage: string | null
  /** Riga di riepilogo dell'albero: moduli Go, app Node, siti statici; "folder mode" se non si riconosce nulla. */
  summary: string
}

const UNIT_NOUNS: Readonly<Record<string, string>> = { node: 'app', static: 'site' }

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function goSummary(project: Project): string {
  const layout = goProjectLayout(project)
  return `${plural(goModules(project).length, 'module')} · ${layout.goWorkPath ? 'go.work' : layout.goModPath ? 'go.mod' : 'folder mode'}`
}

/** `names` mappa l'id del linguaggio al nome mostrato (le contribuzioni UI); senza voce vale l'id. */
export function projectProfile(project: Project, names: Readonly<Record<string, string>> = {}): ProjectProfile {
  const units = project.units ?? []
  const hasGo = units.some((unit) => unit.language === GO_LANGUAGE_ID)
  const counts = new Map<string, number>()
  for (const unit of units) {
    if (unit.language === GO_LANGUAGE_ID) continue
    const label = `${names[unit.language] ?? unit.language} ${UNIT_NOUNS[unit.kind ?? ''] ?? 'project'}`
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  const others = [...counts].map(([label, count]) => plural(count, label))
  const parts = [...(hasGo || others.length === 0 ? [goSummary(project)] : []), ...others]
  return { hasGo, primaryLanguage: units[0]?.language ?? null, summary: parts.join(' · ') }
}
