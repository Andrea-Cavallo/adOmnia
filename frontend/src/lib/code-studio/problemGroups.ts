import { languageName, unitForPath, unitLabel, type ProjectRef, type UnitRef } from './projectUnits'

/** Un file con i suoi problemi: la forma minima che serve a raggruppare (6.5). */
export interface ProblemReportRef {
  path: string
  relativePath?: string
  diagnostics: ReadonlyArray<unknown>
}

/** Gruppo di problemi di una unità (o dei file fuori unità, ultimo). */
export interface ProblemGroup<R> {
  key: string
  label: string
  language: { id: string; name: string } | null
  reports: R[]
  count: number
}

const groupKey = (unit: UnitRef | null) => (unit ? `${unit.language}|${unit.root}` : '')

/**
 * Raggruppa per unità di build, nell'ordine in cui gli adapter le hanno rilevate; i file fuori da
 * ogni unità (SDK, dipendenze) finiscono in un gruppo finale invece di mescolarsi ai linguaggi del
 * progetto. Dentro il gruppo l'ordine arriva dal chiamante e non viene toccato.
 */
export function groupProblemReports<R extends ProblemReportRef>(project: ProjectRef | null | undefined, reports: readonly R[]): ProblemGroup<R>[] {
  const units = project?.units ?? []
  const groups = new Map<string, ProblemGroup<R>>()
  for (const unit of units) {
    const key = groupKey(unit)
    if (groups.has(key)) continue
    groups.set(key, {
      key,
      label: unitLabel(project, unit),
      language: { id: unit.language, name: languageName(unit.language) },
      reports: [],
      count: 0,
    })
  }
  const outside: ProblemGroup<R> = { key: '', label: 'Outside the project', language: null, reports: [], count: 0 }
  for (const report of reports) {
    const unit = unitForPath(project, report.path)
    const group = (unit ? groups.get(groupKey(unit)) : outside) ?? outside
    group.reports.push(report)
    group.count += report.diagnostics.length
  }
  const result = [...groups.values()].filter((group) => group.reports.length > 0)
  if (outside.reports.length > 0) result.push(outside)
  return result
}

/** Filtro dei problemi: testo del messaggio, sorgente, percorso o severità (`error`, `warning`). */
export function matchesProblemQuery(query: string, ...fields: ReadonlyArray<string | undefined>): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return fields.some((field) => (field ?? '').toLowerCase().includes(needle))
}

const severityWord = (severity: number): string => (severity === 1 ? 'error' : severity === 2 ? 'warning' : 'info')

/** Un file resta se il percorso o uno dei suoi diagnostici corrisponde al filtro. */
export function reportMatchesQuery(
  report: { path: string; relativePath?: string; diagnostics: ReadonlyArray<{ message: string; source?: string; severity: number }> },
  query: string,
): boolean {
  if (!query.trim()) return true
  return matchesProblemQuery(query, report.relativePath, report.path)
    || report.diagnostics.some((diagnostic) => matchesProblemQuery(query, diagnostic.message, diagnostic.source, severityWord(diagnostic.severity)))
}

/** Un problema di build resta se il testo o il percorso corrisponde al filtro. */
export function buildProblemMatchesQuery(problem: { text: string; path: string }, query: string): boolean {
  return matchesProblemQuery(query, problem.text, problem.path)
}

/** Numero di problemi (diagnostici, non file) di un gruppo. */
export const problemCount = (groups: ReadonlyArray<ProblemGroup<ProblemReportRef>>): number =>
  groups.reduce((total, group) => total + group.count, 0)
