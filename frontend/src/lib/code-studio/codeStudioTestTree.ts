import type { GoIDEDebugRequest, GoIDEJavaDebugRequest, GoIDEPythonDebugRequest, GoIDERustDebugRequest } from '@/lib/code-studio-debug-api'
import type { GoIDETestResult, GoIDETestRun, GoIDETestRunRequest } from '@/lib/code-studio-tests-api'

export interface CodeStudioTestNode {
  result: GoIDETestResult
  /** Nome mostrato: il package intero o l'ultimo segmento del test. */
  label: string
  children: CodeStudioTestNode[]
}

const FAILED = new Set(['fail', 'timeout'])

export function isFailed(result: GoIDETestResult): boolean {
  return FAILED.has(result.status)
}

/** Ricostruisce l'albero package → test → sottotest dai nodi piatti dello snapshot. */
export function buildTestTree(results: GoIDETestResult[]): CodeStudioTestNode[] {
  const byId = new Map<string, CodeStudioTestNode>()
  for (const result of results) {
    const label = result.name ? result.name.slice(result.name.lastIndexOf('/') + 1) : result.package
    byId.set(result.id, { result, label, children: [] })
  }
  const roots: CodeStudioTestNode[] = []
  for (const node of byId.values()) {
    const parent = node.result.parentId ? byId.get(node.result.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

export interface CodeStudioTestRollup {
  passed: number
  failed: number
  skipped: number
}

/** Contatori di una classe/package: contano le foglie (i test), non i nodi intermedi, in ogni stato. */
export function rollupOf(node: CodeStudioTestNode): CodeStudioTestRollup {
  if (node.children.length === 0) {
    return node.result.name
      ? { passed: node.result.status === 'pass' ? 1 : 0, failed: isFailed(node.result) ? 1 : 0, skipped: node.result.status === 'skip' ? 1 : 0 }
      : { passed: 0, failed: 0, skipped: 0 }
  }
  return node.children.reduce((total, child) => {
    const part = rollupOf(child)
    return { passed: total.passed + part.passed, failed: total.failed + part.failed, skipped: total.skipped + part.skipped }
  }, { passed: 0, failed: 0, skipped: 0 })
}

/** Solo i rami che contengono un fallimento: la vista "solo falliti" non perde il contesto del package. */
export function onlyFailed(nodes: CodeStudioTestNode[]): CodeStudioTestNode[] {
  return nodes
    .map((node) => ({ ...node, children: onlyFailed(node.children) }))
    .filter((node) => isFailed(node.result) || node.children.length > 0)
}

/** Mantiene gli antenati del risultato: cercare un sottotest non fa perdere il package che lo contiene. */
export function filterTestTree(nodes: CodeStudioTestNode[], matches: (result: GoIDETestResult) => boolean): CodeStudioTestNode[] {
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

/** Il run è del runner Go (anche i run salvati prima dei linguaggi, senza `language`). */
export function isGoTestRun(run: GoIDETestRun): boolean {
  return !run.request.language || run.request.language === 'go'
}

/** Il run è dell'adapter Java (Maven/Gradle): filtri e comandi hanno la forma di Surefire e Gradle. */
export function isJavaTestRun(run: GoIDETestRun): boolean {
  return run.request.language === 'java'
}

/** Il run è dell'adapter Python (pytest): i nodi del report sono node ID pytest. */
export function isPythonTestRun(run: GoIDETestRun): boolean {
  return run.request.language === 'python'
}

/** Il run è dell'adapter Rust (cargo test): i nodi sono percorsi libtest con `/` al posto di `::`. */
export function isRustTestRun(run: GoIDETestRun): boolean {
  return run.request.language === 'rust'
}

/**
 * Filtro libtest di un nodo: il nome dell'albero (`tests/it_works`) torna `tests::it_works`, i test
 * di integrazione perdono il prefisso del file e i doctest restano com'erano. Un nodo con figli è un
 * modulo e finisce con `::` (esecuzione per prefisso); un package si riesegue per intero.
 */
export function rustTestFilter(run: GoIDETestRun, result: GoIDETestResult): string {
  const name = result.name ?? ''
  if (!name) return ''
  if (name.includes(' (line ')) return name
  const path = name.replace(/^tests\/[^/]+\.rs\//, '').split('/').join('::')
  return run.results.some((other) => other.parentId === result.id) ? `${path}::` : path
}

/**
 * Node ID pytest di un risultato: `file::classe::test`, con i segmenti del nome uniti da `::` e
 * `∕` (U+2215) che torna `/` dentro un segmento. Per un nodo package (name vuoto) il solo file.
 */
export function pythonNodeId(result: GoIDETestResult): string {
  if (!result.name) return result.package
  return `${result.package}::${result.name.split('/').map((segment) => segment.replace(/\u2215/g, '/')).join('::')}`
}

/** File di test Java relativo all'unità: il "package" del report è il sorgente relativo al progetto. */
function javaTestFile(run: GoIDETestRun, result: GoIDETestResult): string {
  const prefix = run.request.workingDirectory ? `${run.request.workingDirectory}/` : ''
  return result.package.startsWith(prefix) ? result.package.slice(prefix.length) : result.package
}

/**
 * Filtro metodo per Surefire e Gradle: un identificatore, mai una regex. Il nome display di JUnit
 * (`test[0]`, `a > b`) non è un metodo: senza filtro si riesegue la classe.
 */
export function javaMethodFilter(name: string): string {
  const method = name.split('[')[0]
  return /^[A-Za-z0-9_$]+$/.test(method) ? method : ''
}

const JAVA_TEST_ROOTS = ['/src/test/java/', '/src/test/kotlin/', '/src/test/groovy/', '/src/test/scala/']

/** Classe dal sorgente di test, come il backend: `src/test/java/it/x/FooTest.java` → `it.x.FooTest`. */
export function javaClassName(file: string): string {
  const stem = `/${file.replace(/\\/g, '/')}`.replace(/\.[^./]+$/, '')
  for (const root of JAVA_TEST_ROOTS) {
    const index = stem.indexOf(root)
    if (index >= 0) return stem.slice(index + root.length).replace(/\//g, '.')
  }
  return `*.${stem.slice(stem.lastIndexOf('/') + 1)}`
}

/** Un carattere come regex letterale usando solo [A-Za-z0-9\]: niente spazi né simboli che `cmd.exe` interpreta (`&`, `|`, `^`, `%`). */
function safeRegexChar(char: string): string {
  if (/[A-Za-z0-9_]/.test(char)) return char
  const code = char.charCodeAt(0)
  return code < 256 ? `\\x${code.toString(16).padStart(2, '0')}` : `\\u${code.toString(16).padStart(4, '0')}`
}

/** Vitest 5 unisce i livelli con " > ", Jest e le versioni precedenti con uno spazio: la classe accetta entrambi. */
const LEVEL_SEPARATOR = String.raw`[\x20\x3e]+`

/** Filtro per nome dei runner JS/TS (`-t`): i livelli describe/test uniti da spazio, l'ultimo ancorato; U+2215 torna "/". */
export function namePatternFor(name: string): string {
  const level = (segment: string) => Array.from(segment.replace(/∕/g, '/')).map(safeRegexChar).join('')
  return `${name.split('/').map(level).join(LEVEL_SEPARATOR)}$`
}

/** Riesegue un singolo test o sottotest dello stesso run, nel suo package (per JS/TS: il file di test). */
export function requestForNode(run: GoIDETestRun, result: GoIDETestResult): GoIDETestRunRequest {
  const moduleDirectory = run.request.workingDirectory
  if (isJavaTestRun(run)) {
    const file = javaTestFile(run, result)
    // Un nodo che non è un sorgente di test (il build fallito) si riesegue per intero.
    return { ...run.request, packages: file.endsWith('.java') ? [file] : [], run: result.name ? javaMethodFilter(result.name) : '', coverage: false }
  }
  if (isPythonTestRun(run)) {
    // Ogni nodo è un node ID pytest (o il file di test per un package): senza filtro `run`.
    return { ...run.request, packages: [pythonNodeId(result)], run: '', coverage: false }
  }
  if (isRustTestRun(run)) {
    return { ...run.request, packages: [], run: rustTestFilter(run, result), coverage: false }
  }
  if (!isGoTestRun(run)) {
    const prefix = moduleDirectory ? `${moduleDirectory}/` : ''
    const file = result.package.startsWith(prefix) ? result.package.slice(prefix.length) : result.package
    return { ...run.request, packages: [file], run: result.name ? namePatternFor(result.name) : '', coverage: false }
  }
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
  // Solo Go: il debug dei test passa da Delve. Il Java Debug Server debugga le classi con `main`.
  if (!isGoTestRun(run) || !result.name) return null
  const request = requestForNode(run, result)
  const base = { sessionId: request.sessionId, mode: 'test', workingDirectory: request.workingDirectory, target: request.packages[0], buildTags: request.buildTags, environment: request.environment }
  return request.bench ? { ...base, testName: '^$', programArguments: benchmarkDebugArguments(request.bench) } : { ...base, testName: request.run }
}

/** Debug di un test JUnit (o della sua classe se il nome non è un metodo): stessa richiesta del ▶ nel gutter. */
export function javaDebugRequestForNode(run: GoIDETestRun, result: GoIDETestResult): GoIDEJavaDebugRequest | null {
  if (!isJavaTestRun(run) || !result.name || !result.package.endsWith('.java')) return null
  return { sessionId: run.request.sessionId, testFile: result.package, testMethod: javaMethodFilter(result.name), workingDirectory: '' }
}

/** Debug pytest di un test (o dell'intero file di test) con debugpy: null per i run non Python. */
export function pythonDebugRequestForNode(run: GoIDETestRun, result: GoIDETestResult): GoIDEPythonDebugRequest | null {
  if (!isPythonTestRun(run)) return null
  return { sessionId: run.request.sessionId, kind: 'pytest', targets: [pythonNodeId(result)], workingDirectory: run.request.workingDirectory }
}

/**
 * Debug CodeLLDB di un singolo test Rust (RS-5.5): il nome dell'albero arriva al backend così com'è
 * (`tests/foo.rs/it_works` dice anche quale target di test compilare con `cargo test --no-run`).
 * I doctest non hanno binario compilato: restano null (limite dichiarato).
 */
export function rustDebugRequestForNode(run: GoIDETestRun, result: GoIDETestResult): GoIDERustDebugRequest | null {
  if (!isRustTestRun(run) || !result.name) return null
  if (result.name.includes(' (line ')) return null
  return { sessionId: run.request.sessionId, test: result.name, workingDirectory: run.request.workingDirectory }
}

/**
 * Rerun failed: solo i package con fallimenti e solo i test di primo livello falliti.
 * Un package che non compila si riesegue per intero; null se non c'è nulla da rieseguire.
 */
export function rerunFailedRequest(run: GoIDETestRun): GoIDETestRunRequest | null {
  if (isPythonTestRun(run)) return pythonRerunFailedRequest(run)
  if (isJavaTestRun(run)) return javaRerunFailedRequest(run)
  if (isRustTestRun(run)) return rustRerunFailedRequest(run)
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
  return { ...run.request, packages: [...packages].sort((a, b) => a.localeCompare(b)), run: run_, bench: '', coverage: false }
}

/**
 * Rerun failed Rust: i nomi esatti dei test foglia falliti, uno per riga (il backend li passa tutti a
 * libtest dopo `--`). Con un build fallito, o senza foglie, si riesegue l'intera suite.
 */
function rustRerunFailedRequest(run: GoIDETestRun): GoIDETestRunRequest | null {
  const failed = run.results.filter(isFailed)
  if (failed.length === 0) return null
  const leaves = failed.filter((result) => result.name && !run.results.some((other) => other.parentId === result.id)).map((result) => rustTestFilter(run, result))
  const filter = failed.some((result) => result.buildFailed) ? '' : [...new Set(leaves)].join('\n')
  return { ...run.request, packages: [], run: filter, coverage: false }
}

/**
 * Rerun failed Java: solo i file di test con fallimenti. Il filtro metodo non è una regex e ammette
 * più metodi (separati da virgola) solo in una classe: con più classi o con nomi display si rieseguono le classi per intero.
 */
function javaRerunFailedRequest(run: GoIDETestRun): GoIDETestRunRequest | null {
  const files = new Set<string>()
  const methods = new Set<string>()
  let wholeUnit = false
  let anonymous = false
  for (const result of run.results) {
    if (!isFailed(result)) continue
    const file = javaTestFile(run, result)
    if (!file.endsWith('.java')) {
      // Un nodo che non è un sorgente di test è il build fallito: l'unità si riesegue per intero.
      wholeUnit = true
      continue
    }
    files.add(file)
    const method = result.name ? javaMethodFilter(result.name) : ''
    if (method) methods.add(method)
    else if (result.name) anonymous = true // nome display (`test[0]`): non è un metodo, serve la classe intera
  }
  if (wholeUnit) return { ...run.request, packages: [], run: '', coverage: false }
  if (files.size === 0) return null
  return { ...run.request, packages: [...files].sort((a, b) => a.localeCompare(b)), run: files.size === 1 && methods.size > 0 && !anonymous ? [...methods].sort((a, b) => a.localeCompare(b)).join(',') : '', coverage: false }
}

/**
 * Rerun failed Python: solo i node ID dei test falliti. Un file di test che fallisce senza test
 * falliti (errore di raccolta) si riesegue per intero; null se non c'è nulla da rieseguire.
 */
export function pythonRerunFailedRequest(run: GoIDETestRun): GoIDETestRunRequest | null {
  const nodes = new Set<string>()
  for (const result of run.results) {
    if (!isFailed(result)) continue
    if (result.name) nodes.add(pythonNodeId(result))
    else if (!run.results.some((other) => other.package === result.package && other.name && isFailed(other))) nodes.add(result.package)
  }
  if (nodes.size === 0) return null
  return { ...run.request, packages: [...nodes].sort((a, b) => a.localeCompare(b)), run: '', coverage: false }
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
export function onlyFlaky(nodes: CodeStudioTestNode[]): CodeStudioTestNode[] {
  return filterTestTree(nodes, isFlaky)
}

export interface CodeStudioRepetitionStats {
  runs: number
  failures: number
  failureRate: number
  minMillis: number
  avgMillis: number
  maxMillis: number
}

/** Statistiche delle ripetizioni; null se il test è girato una volta sola. */
export function repetitionStats(result: GoIDETestResult): CodeStudioRepetitionStats | null {
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
  return /^[\w./=-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`
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

export interface CodeStudioCPUFailureRate {
  cpu: number
  runs: number
  failures: number
}

/** Tasso di fallimento per valore di -cpu: testing esegue tutte le ripetizioni di un valore prima del successivo. */
export function failureRateByCPU(run: GoIDETestRun, result: GoIDETestResult): CodeStudioCPUFailureRate[] {
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
export function cpuCorrelationVerdict(rates: CodeStudioCPUFailureRate[]): string | null {
  if (rates.length < 2) return null
  const rate = (item: CodeStudioCPUFailureRate) => item.failures / item.runs
  const first = rate(rates[0])
  const last = rate(rates[rates.length - 1])
  if (rates.every((item) => item.failures === 0)) return 'No failures at any GOMAXPROCS in this run.'
  if (first === 0 && last > 0) return `Fails only with parallelism (GOMAXPROCS ≥ ${rates.find((item) => item.failures > 0)?.cpu}): likely a concurrency bug.`
  if (last > first) return 'Fails more often with more parallelism: concurrency is a likely factor.'
  if (last < first) return 'Fails more often with less parallelism: suspect timing assumptions rather than races.'
  return 'Failure rate does not change with GOMAXPROCS: concurrency is unlikely to be the cause.'
}
