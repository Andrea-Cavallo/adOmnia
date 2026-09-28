import type { GoIDETestResult, GoIDETestRun, GoIDETestRunRequest } from '@/lib/goide-tests-api'

export interface GoStudioTestNode {
  result: GoIDETestResult
  /** Nome mostrato: il package intero o l'ultimo segmento del test. */
  label: string
  children: GoStudioTestNode[]
}

const FAILED = new Set(['fail', 'timeout'])

export function isFailed(result: GoIDETestResult): boolean {
  return FAILED.has(result.status)
}

/** Ricostruisce l'albero package → test → sottotest dai nodi piatti dello snapshot. */
export function buildTestTree(results: GoIDETestResult[]): GoStudioTestNode[] {
  const byId = new Map<string, GoStudioTestNode>()
  for (const result of results) {
    const label = result.name ? result.name.slice(result.name.lastIndexOf('/') + 1) : result.package
    byId.set(result.id, { result, label, children: [] })
  }
  const roots: GoStudioTestNode[] = []
  for (const node of byId.values()) {
    const parent = node.result.parentId ? byId.get(node.result.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

/** Solo i rami che contengono un fallimento: la vista "solo falliti" non perde il contesto del package. */
export function onlyFailed(nodes: GoStudioTestNode[]): GoStudioTestNode[] {
  return nodes
    .map((node) => ({ ...node, children: onlyFailed(node.children) }))
    .filter((node) => isFailed(node.result) || node.children.length > 0)
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Espressione -run che seleziona esattamente un test o sottotest (ogni livello ancorato). */
export function runPatternFor(name: string): string {
  return name.split('/').map((segment) => `^${escapeRegex(segment)}$`).join('/')
}

/** Pattern del package relativo al modulo dell'esecuzione, es. "./internal/api". */
export function packagePattern(directory: string | undefined, moduleDirectory: string): string {
  const dir = directory ?? moduleDirectory
  if (dir === moduleDirectory) return '.'
  const prefix = moduleDirectory ? `${moduleDirectory}/` : ''
  return `./${dir.startsWith(prefix) ? dir.slice(prefix.length) : dir}`
}

function packageDirectories(run: GoIDETestRun): Map<string, string | undefined> {
  return new Map(run.results.filter((result) => !result.name).map((result) => [result.package, result.directory]))
}

/** Riesegue un singolo test o sottotest dello stesso run, nel suo package. */
export function requestForNode(run: GoIDETestRun, result: GoIDETestResult): GoIDETestRunRequest {
  const moduleDirectory = run.request.workingDirectory
  const pattern = packagePattern(packageDirectories(run).get(result.package), moduleDirectory)
  const name = result.name ?? ''
  const benchmark = name.startsWith('Benchmark')
  return { ...run.request, packages: [pattern], run: name && !benchmark ? runPatternFor(name) : '', bench: benchmark ? runPatternFor(name) : '', coverage: false }
}

/**
 * Rerun failed: solo i package con fallimenti e solo i test di primo livello falliti.
 * Un package che non compila si riesegue per intero; null se non c'è nulla da rieseguire.
 */
export function rerunFailedRequest(run: GoIDETestRun): GoIDETestRunRequest | null {
  const directories = packageDirectories(run)
  const packages = new Set<string>()
  const tests = new Set<string>()
  let wholePackage = false
  for (const result of run.results) {
    if (!isFailed(result)) continue
    if (!result.name) {
      if (result.buildFailed || !run.results.some((other) => other.package === result.package && other.name && isFailed(other))) wholePackage = true
      if (result.buildFailed || wholePackage) packages.add(packagePattern(directories.get(result.package), run.request.workingDirectory))
      continue
    }
    packages.add(packagePattern(directories.get(result.package), run.request.workingDirectory))
    tests.add(result.name.split('/')[0])
  }
  if (packages.size === 0) return null
  const run_ = wholePackage || tests.size === 0 ? '' : `^(${[...tests].map(escapeRegex).join('|')})$`
  return { ...run.request, packages: [...packages].sort(), run: run_, bench: '', coverage: false }
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${milliseconds} ms`
  return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 2 : 1)} s`
}
