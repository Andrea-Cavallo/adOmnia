import type { GoIDEProfileReport } from '@/lib/goide-api'

/** Package-level runtime picture of one profile: cost per package and the package→package calls seen. */
export interface PackageRuntime {
  profile: string
  metric: string
  total: number
  /** Project folder → inclusive cost. */
  byPackage: Record<string, number>
  /** Import path (dependencies and standard library too) → inclusive cost. */
  byImport: Record<string, number>
  calls: string[] // "dir → dir"
}

const PREFERRED = ['cpu', 'alloc_space', 'inuse_space']

const dirOf = (file?: string) => (file ? (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '.') : '')

/**
 * Inclusive cost per project folder (a Go package): the most expensive function of the folder by
 * cumulative value, so time spent in the standard library counts for the code that called it.
 * Folders come from the profile's project-relative file paths (pprof names `package main` just "main").
 */
export function packageRuntime(report: GoIDEProfileReport): PackageRuntime {
  const names = report.sampleTypes.map((type) => type.name)
  const preferred = PREFERRED.map((name) => names.indexOf(name)).find((index) => index >= 0)
  const index = preferred ?? Math.max(0, names.length - 1)
  const byPackage: Record<string, number> = {}
  const byImport: Record<string, number> = {}
  for (const node of report.topCum ?? []) {
    const pkg = node.function.package
    if (pkg) byImport[pkg] = Math.max(byImport[pkg] ?? 0, node.cum[index] ?? 0)
    const dir = dirOf(node.function.relative)
    if (dir) byPackage[dir] = Math.max(byPackage[dir] ?? 0, node.cum[index] ?? 0)
  }
  const calls = new Set<string>()
  for (const edge of report.edges ?? []) {
    const from = dirOf(edge.caller.relative)
    const to = dirOf(edge.callee.relative)
    if (from && to && from !== to) calls.add(`${from} → ${to}`)
  }
  return { profile: report.name, metric: names[index] ?? '', total: report.totals?.[index] ?? 0, byPackage, byImport, calls: [...calls] }
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
  packages: Array<{ package: string; fanIn: number; fanOut: number; blastRadius: number; functions: number; dir?: string }>
  imports: Array<[string, string]>
}

/** Rows sorted by runtime share (with a profile) or coupling, and the static imports no profiled call crossed. */
export function dependencyHeatmap(input: HeatmapInput, runtime: PackageRuntime | null): { rows: HeatmapRow[]; untraversed: string[] } {
  const total = runtime?.total || Math.max(0, ...Object.values(runtime?.byPackage ?? {}))
  const dirOfPackage = new Map(input.packages.map((item) => [item.package, item.dir ?? '']))
  const rows = input.packages.map(({ dir, ...item }) => ({
    ...item,
    coupling: item.fanIn * item.fanOut,
    runtimeShare: runtime && total > 0 ? Math.min(1, (runtime.byPackage[dir ?? ''] ?? 0) / total) : null,
  }))
  rows.sort((left, right) => (right.runtimeShare ?? 0) - (left.runtimeShare ?? 0) || right.coupling - left.coupling || right.blastRadius - left.blastRadius || left.package.localeCompare(right.package))
  const traversed = new Set(runtime?.calls ?? [])
  const untraversed = runtime
    ? input.imports.filter(([from, to]) => !traversed.has(`${dirOfPackage.get(from)} → ${dirOfPackage.get(to)}`)).map(([from, to]) => `${from} → ${to}`).sort()
    : []
  return { rows, untraversed }
}

/** Why a module is here, by the numbers: its share of the profile and of the binary. */
export function moduleFootprint(module: string, runtime: PackageRuntime | null, binaryPackages: ReadonlyArray<{ name: string; size: number }> | null): { runtimeShare: number | null; binaryBytes: number | null } {
  const within = (path: string) => path === module || path.startsWith(`${module}/`)
  const runtimeValue = runtime ? Math.max(0, ...Object.entries(runtime.byImport ?? {}).filter(([path]) => within(path)).map(([, value]) => value)) : null
  return {
    runtimeShare: runtime && runtime.total > 0 && runtimeValue !== null ? runtimeValue / runtime.total : null,
    binaryBytes: binaryPackages ? binaryPackages.filter((item) => within(item.name)).reduce((sum, item) => sum + item.size, 0) : null,
  }
}
