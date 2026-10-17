interface UnitLike { language: string; kind?: string; root: string }
interface ProjectLike { rootPath: string; units?: ReadonlyArray<UnitLike> | null }

/** Una unità di build su cui "Run all tests" ha senso, con la richiesta da mandare al runner del suo linguaggio. */
export interface TestTarget {
  key: string
  label: string
  language: string
  workingDirectory: string
  packages: string[]
}

const slash = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '')
const basename = (path: string) => slash(path).split('/').pop() || path

function relativeDirectory(project: ProjectLike, root: string): string {
  const base = slash(project.rootPath)
  const unit = slash(root)
  if (unit === base) return ''
  return unit.startsWith(`${base}/`) ? unit.slice(base.length + 1) : unit
}

// Ogni runner strutturato dichiarato dai linguaggi: Go (un modulo) e JS/TS (un package.json, filtri nei LanguageOptions).
const RUNNERS: ReadonlyArray<{ language: string; kind: string; packages: string[]; name: string }> = [
  { language: 'go', kind: 'module', packages: ['./...'], name: 'Go' },
  { language: 'typescript', kind: 'node', packages: [], name: 'JavaScript / TypeScript' },
]

/** Unità del progetto che hanno un test runner strutturato, nell'ordine in cui il backend le ha rilevate. */
export function testTargets(project: ProjectLike): TestTarget[] {
  const targets: TestTarget[] = []
  for (const unit of project.units ?? []) {
    const runner = RUNNERS.find((item) => item.language === unit.language && item.kind === unit.kind)
    if (!runner) continue
    const workingDirectory = relativeDirectory(project, unit.root)
    targets.push({
      key: `${unit.language}|${workingDirectory}`,
      label: `${workingDirectory ? basename(unit.root) : basename(project.rootPath)} · ${runner.name}`,
      language: unit.language,
      workingDirectory,
      packages: [...runner.packages],
    })
  }
  return targets
}

/** Nei progetti senza moduli Go ma con un'unità JS/TS testabile, "Test All" deve usare quella; altrimenti null. */
export function nonGoTestTarget(project: ProjectLike): TestTarget | null {
  const targets = testTargets(project)
  if (targets.some((target) => target.language === 'go')) return null
  return targets[0] ?? null
}
