interface UnitLike { language: string; root: string }
interface ProjectLike { rootPath: string; units?: ReadonlyArray<UnitLike> | null }
interface ConfigLike { workingDirectory?: string }

export interface RunGroup<T> {
  /** Es. "orders · Go"; vuoto per le configurazioni che non appartengono a nessuna unità. */
  label: string
  language: string
  items: T[]
}

const slash = (path: string) => path.replace(/\\/g, '/').replace(/(?<!\/)\/+$/, '')
const basename = (path: string) => slash(path).split('/').pop() || path

/** L'unità che contiene la working directory della configurazione (la più profonda vince). */
export function unitOfConfiguration(config: ConfigLike, project: ProjectLike): UnitLike | null {
  const root = slash(project.rootPath)
  const relative = slash(config.workingDirectory ?? '').replace(/^\.\/?/, '')
  const directory = relative ? `${root}/${relative}` : root
  let best: UnitLike | null = null
  for (const unit of project.units ?? []) {
    const unitRoot = slash(unit.root)
    const inside = directory === unitRoot || directory.startsWith(`${unitRoot}/`)
    if (inside && (!best || unitRoot.length > slash(best.root).length)) best = unit
  }
  return best
}

/**
 * Raggruppa le configurazioni per unità di build, nell'ordine di apparizione. Con una sola unità (o
 * nessuna) restituisce un unico gruppo senza etichetta: l'intestazione serve solo ai workspace misti.
 */
export function groupConfigurationsByUnit<T extends ConfigLike>(configs: ReadonlyArray<T>, project: ProjectLike, languageNames: Readonly<Record<string, string>> = {}): RunGroup<T>[] {
  const groups = new Map<string, RunGroup<T>>()
  for (const config of configs) {
    const unit = unitOfConfiguration(config, project)
    const key = unit ? `${unit.language}|${slash(unit.root)}` : ''
    if (!groups.has(key)) {
      const label = unit ? `${basename(unit.root)} · ${languageNames[unit.language] ?? unit.language}` : ''
      groups.set(key, { label, language: unit?.language ?? '', items: [] })
    }
    groups.get(key)!.items.push(config)
  }
  const result = [...groups.values()]
  return result.length > 1 ? result : result.map((group) => ({ ...group, label: '' }))
}
