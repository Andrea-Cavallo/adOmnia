import type { GoIDEProfileReport } from '@/lib/goide-api'

/** Package-level runtime picture of one profile: cost per package and the package→package calls seen. */
export interface PackageRuntime {
  profile: string
  metric: string
  byPackage: Record<string, number>
  calls: string[] // "a → b"
}

const PREFERRED = ['cpu', 'alloc_space', 'inuse_space']

export function packageRuntime(report: GoIDEProfileReport): PackageRuntime {
  const names = report.sampleTypes.map((type) => type.name)
  const preferred = PREFERRED.map((name) => names.indexOf(name)).find((index) => index >= 0)
  const index = preferred ?? Math.max(0, names.length - 1)
  const byPackage: Record<string, number> = {}
  for (const node of report.topFlat ?? []) {
    const pkg = node.function.package
    if (pkg) byPackage[pkg] = (byPackage[pkg] ?? 0) + (node.flat[index] ?? 0)
  }
  const calls = new Set<string>()
  for (const edge of report.edges ?? []) {
    if (edge.caller.package && edge.callee.package && edge.caller.package !== edge.callee.package) calls.add(`${edge.caller.package} → ${edge.callee.package}`)
  }
  return { profile: report.name, metric: names[index] ?? '', byPackage, calls: [...calls] }
}

export interface HeatmapRow {
  package: string
  fanIn: number
  fanOut: number
  blastRadius: number
  functions: number
  /** fanIn × fanOut: a package everyone uses that also uses many others. */
  coupling: number
  /** Share of the profile's samples spent in the package (0..1), when a profile is loaded. */
  runtimeShare: number | null
}

interface HeatmapInput {
  packages: Array<{ package: string; fanIn: number; fanOut: number; blastRadius: number; functions: number }>
  imports: Array<[string, string]>
}

/** Rows sorted by runtime share (with a profile) or coupling, and the static imports no profiled call crossed. */
export function dependencyHeatmap(input: HeatmapInput, runtime: PackageRuntime | null): { rows: HeatmapRow[]; untraversed: string[] } {
  const total = runtime ? Object.values(runtime.byPackage).reduce((sum, value) => sum + value, 0) : 0
  const rows = input.packages.map((item) => ({
    ...item,
    coupling: item.fanIn * item.fanOut,
    runtimeShare: runtime && total > 0 ? (runtime.byPackage[item.package] ?? 0) / total : null,
  }))
  rows.sort((left, right) => (right.runtimeShare ?? 0) - (left.runtimeShare ?? 0) || right.coupling - left.coupling || right.blastRadius - left.blastRadius || left.package.localeCompare(right.package))
  const traversed = new Set(runtime?.calls ?? [])
  const untraversed = runtime ? input.imports.map(([from, to]) => `${from} → ${to}`).filter((edge) => !traversed.has(edge)).sort() : []
  return { rows, untraversed }
}
