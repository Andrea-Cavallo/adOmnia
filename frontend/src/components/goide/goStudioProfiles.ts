import type { GoIDEProfileFile, GoIDEProfileReport } from '@/lib/goide-api'

export type ProfileReport = GoIDEProfileReport
export type ProfileReportFile = GoIDEProfileFile
export type ProfileFunction = ProfileReport['topFlat'][number]['function']
export type ProfileNode = ProfileReport['topFlat'][number]
export type ProfileFlame = NonNullable<ProfileReport['flame']>
export type ProfileEdge = ProfileReport['edges'][number]
export type ProfileLine = ProfileReport['lines'][number]
export type ProfileSampleType = ProfileReport['sampleTypes'][number]

/** Il sample type predefinito è l'ultimo, come in `go tool pprof` (cpu, inuse_space…). */
export function defaultSampleIndex(report: ProfileReport): number {
  return Math.max(0, report.sampleTypes.length - 1)
}

export function sampleValue(values: number[] | undefined, index: number): number {
  if (!values || values.length === 0) return 0
  const safe = index >= 0 && index < values.length ? index : values.length - 1
  return values[safe] ?? 0
}

export function profileTotal(report: ProfileReport, index: number): number {
  return sampleValue(report.totals, index)
}

export function percentOf(value: number, total: number): number {
  return total > 0 ? (value / total) * 100 : 0
}

/** Format leggibile di un valore pprof in base all'unità del sample type. */
export function formatProfileValue(value: number, unit: string): string {
  const absolute = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (unit.includes('nanoseconds')) {
    if (absolute < 1_000) return `${sign}${value.toFixed(0)} ns`
    if (absolute < 1_000_000) return `${sign}${(value / 1_000).toFixed(1)} µs`
    if (absolute < 1_000_000_000) return `${sign}${(value / 1_000_000).toFixed(2)} ms`
    return `${sign}${(value / 1_000_000_000).toFixed(2)} s`
  }
  if (unit.includes('bytes')) {
    if (absolute < 1024) return `${sign}${value.toFixed(0)} B`
    if (absolute < 1024 * 1024) return `${sign}${(value / 1024).toFixed(1)} KiB`
    if (absolute < 1024 * 1024 * 1024) return `${sign}${(value / (1024 * 1024)).toFixed(1)} MiB`
    return `${sign}${(value / (1024 * 1024 * 1024)).toFixed(2)} GiB`
  }
  if (unit.includes('milliseconds')) return `${sign}${value.toFixed(1)} ms`
  return `${sign}${value.toLocaleString('en-US')}`
}

export function formatProfilePercent(value: number, total: number): string {
  return `${percentOf(value, total).toFixed(1)}%`
}

/** Ordina i nodi Top per flat o cum sul sample type scelto; il runtime è già marcato da Go. */
export function sortTop(nodes: ProfileNode[], index: number, mode: 'flat' | 'cum'): ProfileNode[] {
  return [...nodes].sort((a, b) => sampleValue(mode === 'flat' ? b.flat : b.cum, index) - sampleValue(mode === 'flat' ? a.flat : a.cum, index))
}

export interface PackageGroup {
  package: string
  value: number
  nodes: ProfileNode[]
}

/** Raggruppa i nodi Top per package, mantenendo l'ordine di valore decrescente. */
export function groupByPackage(nodes: ProfileNode[], index: number, mode: 'flat' | 'cum'): PackageGroup[] {
  const groups = new Map<string, PackageGroup>()
  for (const node of nodes) {
    const value = sampleValue(mode === 'flat' ? node.flat : node.cum, index)
    const key = node.function.package || '(unknown)'
    const group = groups.get(key) ?? { package: key, value: 0, nodes: [] }
    group.value += value
    group.nodes.push(node)
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => b.value - a.value)
}

export function matchesNode(node: ProfileNode, query: string): boolean {
  if (!query) return true
  const needle = query.toLowerCase()
  return node.function.name.toLowerCase().includes(needle) || node.function.package.toLowerCase().includes(needle)
}

export function filterNodes(nodes: ProfileNode[], options: { query?: string; hideRuntime?: boolean; index?: number }): ProfileNode[] {
  const query = options.query ?? ''
  return nodes.filter((node) => (!options.hideRuntime || !node.function.runtime) && matchesNode(node, query))
}

export interface ProfileDelta {
  function: ProfileFunction
  base: number
  target: number
  delta: number
  ratio: number
}

/**
 * Confronta due profili per sample type: delta assoluto e variazione percentuale.
 * Le funzioni presenti in un solo profilo valgono quanto il profilo che le contiene.
 */
/** Indice nel profilo target dello stesso sample type (per nome) scelto nel base; -1 se non c'è. */
export function matchingSampleIndex(base: ProfileReport, target: ProfileReport, index: number): number {
  const name = base.sampleTypes[index]?.name
  return name ? target.sampleTypes.findIndex((type) => type.name === name) : -1
}

export function diffProfiles(base: ProfileReport, target: ProfileReport, index: number, mode: 'flat' | 'cum' = 'cum'): ProfileDelta[] {
  // Si confrontano solo grandezze uguali: cpu con cpu, inuse_space con inuse_space.
  const targetIndex = matchingSampleIndex(base, target, index)
  if (targetIndex < 0) return []
  const baseValues = new Map<string, { fn: ProfileFunction; value: number }>()
  for (const node of base[mode === 'flat' ? 'topFlat' : 'topCum']) {
    baseValues.set(node.function.name, { fn: node.function, value: sampleValue(mode === 'flat' ? node.flat : node.cum, index) })
  }
  const targetValues = new Map<string, { fn: ProfileFunction; value: number }>()
  for (const node of target[mode === 'flat' ? 'topFlat' : 'topCum']) {
    targetValues.set(node.function.name, { fn: node.function, value: sampleValue(mode === 'flat' ? node.flat : node.cum, targetIndex) })
  }
  const names = new Set([...baseValues.keys(), ...targetValues.keys()])
  const deltas: ProfileDelta[] = []
  for (const name of names) {
    const baseEntry = baseValues.get(name)
    const targetEntry = targetValues.get(name)
    const before = baseEntry?.value ?? 0
    const after = targetEntry?.value ?? 0
    const delta = after - before
    deltas.push({
      function: targetEntry?.fn ?? baseEntry!.fn,
      base: before,
      target: after,
      delta,
      ratio: before === 0 ? (after === 0 ? 0 : 1) : delta / before,
    })
  }
  return deltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
}

/** Le funzioni runtime sono contrassegnate dal backend; questa è la verifica usata dai test. */
export function isRuntimeFunction(fn: ProfileFunction): boolean {
  return fn.runtime === true || fn.name.startsWith('runtime.')
}

/** Nome breve della funzione per le etichette del flame graph. */
export function shortFunctionName(fn: ProfileFunction): string {
  return fn.short || fn.name
}
