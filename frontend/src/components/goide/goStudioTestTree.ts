import type { GoIDEDebugRequest } from '@/lib/goide-debug-api'
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

/** Mantiene gli antenati del risultato: cercare un sottotest non fa perdere il package che lo contiene. */
export function filterTestTree(nodes: GoStudioTestNode[], matches: (result: GoIDETestResult) => boolean): GoStudioTestNode[] {
  return nodes
    .map((node) => ({ ...node, children: filterTestTree(node.children, matches) }))
    .filter((node) => matches(node.result) || node.children.length > 0)
}

/** Un secondo è una soglia iniziale leggibile; non è una diagnosi di flakiness. */
export function isSlow(result: GoIDETestResult, thresholdMillis = 1000): boolean {
  return result.elapsedMillis >= thresholdMillis
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

/** Argomenti per fare debug di un benchmark: nessun test, una sola iterazione del benchmark. */
export function benchmarkDebugArguments(pattern: string): string[] {
  return ['-test.bench', pattern, '-test.benchtime', '1x']
}

/** Debug di un singolo test (o benchmark) del run, con gli stessi tag e variabili; null per i package. */
export function debugRequestForNode(run: GoIDETestRun, result: GoIDETestResult): GoIDEDebugRequest | null {
  if (!result.name) return null
  const request = requestForNode(run, result)
  const base = { sessionId: request.sessionId, mode: 'test', workingDirectory: request.workingDirectory, target: request.packages[0], buildTags: request.buildTags, environment: request.environment }
  return request.bench ? { ...base, testName: '^$', programArguments: benchmarkDebugArguments(request.bench) } : { ...base, testName: request.run }
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

/** Flaky: con -count=N ha sia passato sia fallito. Un test sempre rosso è rotto, non flaky. */
export function isFlaky(result: GoIDETestResult): boolean {
  const runs = result.runs ?? 0
  const failures = result.failures ?? 0
  return runs > 1 && failures > 0 && failures < runs
}

/** Solo i rami con un test flaky, mantenendo il package. */
export function onlyFlaky(nodes: GoStudioTestNode[]): GoStudioTestNode[] {
  return filterTestTree(nodes, isFlaky)
}

export interface GoStudioRepetitionStats {
  runs: number
  failures: number
  failureRate: number
  minMillis: number
  avgMillis: number
  maxMillis: number
}

/** Statistiche delle ripetizioni; null se il test è girato una volta sola. */
export function repetitionStats(result: GoIDETestResult): GoStudioRepetitionStats | null {
  const runs = result.runs ?? 0
  if (runs < 2) return null
  const failures = result.failures ?? 0
  return { runs, failures, failureRate: failures / runs, minMillis: result.minMillis ?? 0, avgMillis: Math.round((result.totalMillis ?? 0) / runs), maxMillis: result.maxMillis ?? 0 }
}

/** Riesegue il nodo N volte in ordine casuale: rivela flakiness e dipendenze dall'ordine. */
export function repeatRequestForNode(run: GoIDETestRun, result: GoIDETestResult, repeat: number): GoIDETestRunRequest {
  return { ...requestForNode(run, result), repeat, shuffle: 'on' }
}

/** Riproduce l'ordine esatto di una run con -shuffle usando il seed stampato dal package. */
export function reproduceRequest(run: GoIDETestRun, packageResult: GoIDETestResult): GoIDETestRunRequest | null {
  if (!packageResult.shuffleSeed) return null
  return { ...requestForNode(run, packageResult), repeat: run.request.repeat, shuffle: packageResult.shuffleSeed }
}

const FLAKY_CAUSES: { pattern: RegExp; cause: string }[] = [
  { pattern: /WARNING: DATA RACE|race detected during execution/, cause: 'Data race: goroutines touch shared memory without synchronisation.' },
  { pattern: /all goroutines are asleep - deadlock|fatal error: deadlock/, cause: 'Deadlock: goroutines wait on each other in some interleavings.' },
  { pattern: /context deadline exceeded|i\/o timeout|timed out|test timed out after/i, cause: 'Timing: the test depends on deadlines, sleeps or slow I/O.' },
  { pattern: /address already in use|bind: /, cause: 'Port conflict: a fixed port is reused across runs or parallel tests.' },
  { pattern: /connection refused|no such host|dial tcp|connection reset/i, cause: 'External dependency: a network service is not always reachable.' },
  { pattern: /panic: send on closed channel|close of closed channel/, cause: 'Channel lifecycle: a channel is closed while still in use.' },
  { pattern: /concurrent map (?:read and map write|writes|iteration and map write)/, cause: 'Concurrent map access without a lock.' },
]

/**
 * Cause probabili di un test flaky lette dall'output di tutte le ripetizioni: sono indizi, non diagnosi.
 * Con -shuffle attivo e nessun indizio, la prima ipotesi è la dipendenza dall'ordine dei test.
 */
export function flakyCauses(output: string, shuffled: boolean): string[] {
  const causes = FLAKY_CAUSES.filter(({ pattern }) => pattern.test(output)).map(({ cause }) => cause)
  if (causes.length === 0 && shuffled) causes.push('Order dependency: shared state between tests; replay the package with the same -shuffle seed.')
  return causes
}

/** Riesegue il test N volte con il race detector: conferma o esclude la causa concorrente. */
export function raceRepeatRequestForNode(run: GoIDETestRun, result: GoIDETestResult, repeat: number): GoIDETestRunRequest {
  return { ...repeatRequestForNode(run, result, repeat), race: true }
}

function shellQuote(value: string): string {
  return /^[\w./=-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\''`)}'`
}

/**
 * Comando da terminale che riproduce lo scenario di un test: stesso package, filtro, ripetizioni,
 * seed di -shuffle (se il package l'ha stampato), race detector e build tag.
 */
export function reproduceCommandFor(run: GoIDETestRun, result: GoIDETestResult): string {
  const request = requestForNode(run, result)
  const seed = run.results.find((item) => item.package === result.package && !item.name)?.shuffleSeed
  const args = ['go', 'test']
  if ((run.request.repeat ?? 0) > 1) args.push(`-count=${run.request.repeat}`)
  if (seed) args.push(`-shuffle=${seed}`)
  if (run.request.race) args.push('-race')
  if (run.request.cpu?.length) args.push(`-cpu=${run.request.cpu.join(',')}`)
  if (request.buildTags?.length) args.push('-tags', request.buildTags.join(','))
  if (request.run) args.push('-run', request.run)
  args.push(...request.packages)
  const command = args.map(shellQuote).join(' ')
  return request.workingDirectory ? `cd ${shellQuote(request.workingDirectory)} && ${command}` : command
}

export const CORRELATION_CPUS = [1, 2, 4, 8]

/** Ripete il test con GOMAXPROCS 1, 2, 4 e 8 (-cpu) per vedere se la flakiness cresce col parallelismo. */
export function cpuCorrelationRequestForNode(run: GoIDETestRun, result: GoIDETestResult, repeat: number): GoIDETestRunRequest {
  return { ...requestForNode(run, result), repeat, shuffle: 'on', cpu: CORRELATION_CPUS }
}

export interface GoStudioCPUFailureRate {
  cpu: number
  runs: number
  failures: number
}

/** Tasso di fallimento per valore di -cpu: testing esegue tutte le ripetizioni di un valore prima del successivo. */
export function failureRateByCPU(run: GoIDETestRun, result: GoIDETestResult): GoStudioCPUFailureRate[] {
  const cpus = run.request.cpu ?? []
  const outcomes = result.outcomes ?? ''
  const repeat = Math.max(1, run.request.repeat ?? 1)
  if (cpus.length < 2 || outcomes.length < cpus.length * repeat) return []
  return cpus.map((cpu, index) => {
    const slice = outcomes.slice(index * repeat, (index + 1) * repeat)
    return { cpu, runs: slice.length, failures: [...slice].filter((outcome) => outcome === 'F').length }
  })
}

/** Lettura del confronto: null se non c'è differenza utile tra il primo e l'ultimo valore. */
export function cpuCorrelationVerdict(rates: GoStudioCPUFailureRate[]): string | null {
  if (rates.length < 2) return null
  const rate = (item: GoStudioCPUFailureRate) => item.failures / item.runs
  const first = rate(rates[0])
  const last = rate(rates[rates.length - 1])
  if (rates.every((item) => item.failures === 0)) return 'No failures at any GOMAXPROCS in this run.'
  if (first === 0 && last > 0) return `Fails only with parallelism (GOMAXPROCS ≥ ${rates.find((item) => item.failures > 0)?.cpu}): likely a concurrency bug.`
  if (last > first) return 'Fails more often with more parallelism: concurrency is a likely factor.'
  if (last < first) return 'Fails more often with less parallelism: suspect timing assumptions rather than races.'
  return 'Failure rate does not change with GOMAXPROCS: concurrency is unlikely to be the cause.'
}
