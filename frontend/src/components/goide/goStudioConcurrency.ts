import type { GoIDEGoroutine } from '@/lib/goide-debug-api'

/** Stati prodotti da internal/goide/debug_goroutines.go. */
export type GoroutineState =
  | 'running' | 'chan receive' | 'chan send' | 'select' | 'mutex' | 'waitgroup' | 'cond'
  | 'sleep' | 'io wait' | 'syscall' | 'waiting'

/** Stati in cui la goroutine aspetta un'altra goroutine: contano per deadlock, contesa e leak. */
const BLOCKED_ON_PEERS = new Set<string>(['chan receive', 'chan send', 'select', 'mutex', 'waitgroup', 'cond'])
const CHANNEL_STATES = new Set<string>(['chan receive', 'chan send', 'select'])
/** Goroutine ferme nello stesso punto oltre questa soglia fanno pensare a un leak. */
export const LEAK_THRESHOLD = 10
const MAIN_GOROUTINE_ID = 1
const RUNTIME_GROUP = 'runtime'

export function isBlocked(state: string): boolean {
  return BLOCKED_ON_PEERS.has(state)
}

/** "main.(*Service).Start.func1" → { pkg: "main", name: "(*Service).Start.func1" }. */
export function splitFunctionName(full: string): { pkg: string; name: string } {
  const slash = full.lastIndexOf('/')
  const dot = full.indexOf('.', slash + 1)
  if (dot < 0) return { pkg: '', name: full }
  return { pkg: full.slice(0, dot), name: full.slice(dot + 1) }
}

export interface GoroutineGroup {
  /** Funzione avviata dall'istruzione go (frame di progetto più in basso). */
  key: string
  name: string
  relativePath?: string
  line?: number
  goroutines: GoIDEGoroutine[]
  blocked: number
}

export interface GoroutinePackage {
  pkg: string
  groups: GoroutineGroup[]
  total: number
}

/** Albero concurrency-first: package → funzione di avvio → goroutine, con la goroutine corrente in cima. */
export function groupGoroutines(goroutines: GoIDEGoroutine[]): GoroutinePackage[] {
  const groups = new Map<string, GoroutineGroup>()
  for (const goroutine of goroutines) {
    const key = goroutine.origin?.name ?? RUNTIME_GROUP
    const group = groups.get(key) ?? {
      key,
      name: goroutine.origin ? splitFunctionName(goroutine.origin.name).name : 'runtime and libraries',
      relativePath: goroutine.origin?.relativePath,
      line: goroutine.origin?.line,
      goroutines: [],
      blocked: 0,
    }
    group.goroutines.push(goroutine)
    if (isBlocked(goroutine.state)) group.blocked++
    groups.set(key, group)
  }
  const packages = new Map<string, GoroutinePackage>()
  for (const group of groups.values()) {
    group.goroutines.sort((left, right) => Number(right.current) - Number(left.current) || left.id - right.id)
    const pkg = group.key === RUNTIME_GROUP ? RUNTIME_GROUP : splitFunctionName(group.key).pkg
    const entry = packages.get(pkg) ?? { pkg, groups: [], total: 0 }
    entry.groups.push(group)
    entry.total += group.goroutines.length
    packages.set(pkg, entry)
  }
  const rank = (entry: GoroutinePackage) => (entry.pkg === RUNTIME_GROUP ? 1 : 0)
  return [...packages.values()]
    .map((entry) => ({ ...entry, groups: entry.groups.sort((left, right) => right.goroutines.length - left.goroutines.length) }))
    .sort((left, right) => rank(left) - rank(right) || left.pkg.localeCompare(right.pkg))
}

export type DiagnosticKind = 'deadlock' | 'channel' | 'mutex' | 'leak' | 'race' | 'waitgroup' | 'count' | 'pool'

/**
 * Origine dell'evidenza, come nella checklist 2027: STATIC dall'analisi del codice, OBSERVED da
 * un'istantanea del runtime in pausa, CONFIRMED quando il runtime stesso lo segnala (race detector).
 */
export type DiagnosticEvidence = 'static' | 'observed' | 'confirmed'

/** Oltre questa soglia il numero di goroutine è di per sé un segnale da guardare. */
export const EXCESSIVE_GOROUTINES = 1000

export type GoroutineRelation = 'channel' | 'mutex' | 'rwmutex' | 'waitgroup' | 'context' | 'network' | 'database' | 'timer'

const DATABASE_FRAME = /^(database\/sql|github\.com\/(jackc\/pgx|go-sql-driver|lib\/pq|mattn\/go-sqlite3)|gorm\.io|go\.mongodb\.org|github\.com\/redis)/
const NETWORK_FRAME = /^(net\/http|net\.|crypto\/tls|google\.golang\.org\/grpc|github\.com\/(segmentio\/kafka-go|IBM\/sarama|confluentinc))/

/** Con cosa sta interagendo la goroutine: canali, lock, context, rete, database, timer. */
export function goroutineRelations(goroutine: GoIDEGoroutine): GoroutineRelation[] {
  const relations = new Set<GoroutineRelation>()
  const frames = goroutine.frames ?? []
  if (CHANNEL_STATES.has(goroutine.state)) relations.add('channel')
  if (goroutine.state === 'mutex') relations.add(frames.some((frame) => frame.name.includes('RWMutex')) ? 'rwmutex' : 'mutex')
  if (goroutine.state === 'waitgroup') relations.add('waitgroup')
  if (goroutine.state === 'sleep' || frames.some((frame) => frame.name.startsWith('time.'))) relations.add('timer')
  if (/\.Done\(\)$/.test(goroutine.blockedOn ?? '') || /ctx|context/i.test(goroutine.blockedOn ?? '')) relations.add('context')
  if (goroutine.state === 'io wait' || frames.some((frame) => NETWORK_FRAME.test(frame.name))) relations.add('network')
  if (frames.some((frame) => DATABASE_FRAME.test(frame.name))) relations.add('database')
  return [...relations]
}

/** Firma dello stack: goroutine con la stessa firma stanno facendo esattamente la stessa cosa. */
export function stackSignature(goroutine: GoIDEGoroutine): string {
  return (goroutine.frames ?? []).map((frame) => `${frame.name}:${frame.line}`).join('|') || `#${goroutine.id}`
}

export interface StackGroup {
  key: string
  top: string
  location?: { relativePath?: string; line?: number }
  state: string
  goroutines: GoIDEGoroutine[]
}

/** Raggruppamento per stack identico, come "goroutine -s" di Delve: 200 worker uguali diventano una riga. */
export function groupByStack(goroutines: GoIDEGoroutine[]): StackGroup[] {
  const groups = new Map<string, StackGroup>()
  for (const goroutine of goroutines) {
    const key = stackSignature(goroutine)
    const group = groups.get(key) ?? {
      key,
      top: splitFunctionName(goroutine.location?.name ?? goroutine.frames?.[0]?.name ?? 'unknown').name,
      location: goroutine.location ? { relativePath: goroutine.location.relativePath, line: goroutine.location.line } : undefined,
      state: goroutine.state,
      goroutines: [],
    }
    group.goroutines.push(goroutine)
    groups.set(key, group)
  }
  return [...groups.values()].sort((left, right) => right.goroutines.length - left.goroutines.length)
}

export interface ConcurrencyDiagnostic {
  id: string
  kind: DiagnosticKind
  severity: 'error' | 'warning' | 'info'
  evidence: DiagnosticEvidence
  title: string
  detail: string
  goroutineIds: number[]
  relativePath?: string
  line?: number
}

export interface WaitResource {
  key: string
  state: string
  /** Espressione attesa, es. "s.orderChannel"; vuota se la riga non la rende evidente. */
  target: string
  relativePath?: string
  line?: number
  sourceLine?: string
  goroutines: GoIDEGoroutine[]
}

/** Raggruppa le goroutine bloccate sullo stesso oggetto nello stesso punto del codice. */
export function waitResources(goroutines: GoIDEGoroutine[]): WaitResource[] {
  const resources = new Map<string, WaitResource>()
  for (const goroutine of goroutines) {
    if (!isBlocked(goroutine.state)) continue
    const location = goroutine.location
    const key = `${goroutine.state}|${goroutine.blockedOn ?? ''}|${location?.relativePath ?? ''}:${location?.line ?? 0}`
    const resource = resources.get(key) ?? {
      key, state: goroutine.state, target: goroutine.blockedOn ?? '', relativePath: location?.relativePath, line: location?.line, sourceLine: goroutine.sourceLine, goroutines: [],
    }
    resource.goroutines.push(goroutine)
    resources.set(key, resource)
  }
  return [...resources.values()].sort((left, right) => right.goroutines.length - left.goroutines.length)
}

/**
 * Canale su cui qualcuno aspetta di inviare ma nessuno riceve (o viceversa) in questa istantanea.
 * Solo con un nome di canale leggibile: senza, due righe diverse potrebbero essere lo stesso canale.
 */
function channelPartner(resource: WaitResource, goroutines: GoIDEGoroutine[]): string | null {
  if (!resource.target || (resource.state !== 'chan send' && resource.state !== 'chan receive')) return null
  const wanted = resource.state === 'chan send' ? ['chan receive', 'select'] : ['chan send', 'select']
  const name = resource.target.split('.').pop()
  const partner = goroutines.some((goroutine) => wanted.includes(goroutine.state) && goroutine.blockedOn?.split('.').pop() === name)
  if (partner) return null
  return resource.state === 'chan send' ? 'Channel without consumer' : 'Channel without producer'
}

function describeTarget(resource: WaitResource): string {
  const where = resource.relativePath ? ` at ${resource.relativePath.split('/').pop()}:${resource.line}` : ''
  if (CHANNEL_STATES.has(resource.state)) return `${resource.state === 'chan send' ? 'send to' : 'receive from'} ${resource.target || 'a channel'}${where}`
  if (resource.state === 'mutex') return `${resource.target || 'a mutex'}${where}`
  return `${resource.target || resource.state}${where}`
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/** Un pool ha almeno tanti worker avviati dalla stessa funzione. */
export const POOL_MIN_WORKERS = 3
/** Stati di un worker in attesa di lavoro: libero, non saturo. */
const IDLE_WORKER_STATES = new Set<string>(['chan receive', 'select'])

/**
 * Worker pool saturo: tutti i worker avviati dalla stessa funzione sono occupati mentre altre
 * goroutine aspettano di inviare su un canale, cioè il lavoro si accoda a monte del pool.
 */
export function poolSaturation(goroutines: GoIDEGoroutine[]): ConcurrencyDiagnostic[] {
  const pools = new Map<string, GoIDEGoroutine[]>()
  for (const goroutine of goroutines) {
    const origin = goroutine.origin?.name
    if (!origin || goroutine.id === MAIN_GOROUTINE_ID || splitFunctionName(origin).pkg === RUNTIME_GROUP) continue
    pools.set(origin, [...(pools.get(origin) ?? []), goroutine])
  }
  const diagnostics: ConcurrencyDiagnostic[] = []
  for (const [origin, workers] of pools) {
    if (workers.length < POOL_MIN_WORKERS || workers.some((worker) => IDLE_WORKER_STATES.has(worker.state))) continue
    const waiting = goroutines.filter((goroutine) => goroutine.state === 'chan send' && goroutine.origin?.name !== origin)
    if (!waiting.length) continue
    const first = waiting[0]
    const target = first.blockedOn ? ` on ${first.blockedOn}` : ''
    diagnostics.push({
      id: `pool:${origin}`, kind: 'pool', severity: 'warning', evidence: 'observed',
      title: 'Worker pool saturated',
      detail: `All ${workers.length} workers started by ${splitFunctionName(origin).name} are busy and ${plural(waiting.length, 'goroutine')} wait to send${target}. Work is queuing upstream: add workers, buffer the channel or speed up the work.`,
      goroutineIds: [...workers, ...waiting].map((goroutine) => goroutine.id),
      relativePath: first.location?.relativePath, line: first.location?.line,
    })
  }
  return diagnostics
}

/** Problemi di concorrenza deducibili da un'istantanea in pausa, dal più grave. */
export function diagnoseConcurrency(goroutines: GoIDEGoroutine[]): ConcurrencyDiagnostic[] {
  const diagnostics: ConcurrencyDiagnostic[] = []
  const blocked = goroutines.filter((goroutine) => isBlocked(goroutine.state))
  if (goroutines.length > 0 && blocked.length === goroutines.length) {
    diagnostics.push({
      id: 'deadlock', kind: 'deadlock', severity: 'error', evidence: 'observed',
      title: 'Possible deadlock',
      detail: `All ${plural(goroutines.length, 'goroutine')} are waiting on channels, mutexes or WaitGroups: nothing can wake them up.`,
      goroutineIds: blocked.map((goroutine) => goroutine.id),
    })
  }
  for (const resource of waitResources(goroutines)) {
    const ids = resource.goroutines.map((goroutine) => goroutine.id)
    const base = { goroutineIds: ids, relativePath: resource.relativePath, line: resource.line, evidence: 'observed' as const }
    const sameOrigin = new Set(resource.goroutines.map((goroutine) => goroutine.origin?.name)).size === 1
    if (sameOrigin && ids.length >= LEAK_THRESHOLD) {
      diagnostics.push({ ...base, id: `leak:${resource.key}`, kind: 'leak', severity: 'warning', title: 'Possible goroutine leak', detail: `${plural(ids.length, 'goroutine')} started by the same function are all stuck on ${describeTarget(resource)}.` })
    } else if (resource.state === 'mutex' && ids.length >= 2) {
      const rw = resource.goroutines.some((goroutine) => goroutineRelations(goroutine).includes('rwmutex'))
      diagnostics.push({ ...base, id: `mutex:${resource.key}`, kind: 'mutex', severity: 'warning', title: rw ? 'RWMutex contention' : 'Mutex contention', detail: `${plural(ids.length, 'goroutine')} waiting to lock ${describeTarget(resource)}.` })
    } else if (CHANNEL_STATES.has(resource.state)) {
      const partner = channelPartner(resource, goroutines)
      diagnostics.push({ ...base, id: `channel:${resource.key}`, kind: 'channel', severity: ids.length >= 2 || partner ? 'warning' : 'info', title: partner ?? 'Channel blocked', detail: `${plural(ids.length, 'goroutine')} blocked to ${describeTarget(resource)}.${partner ? ` No goroutine is ${resource.state === 'chan send' ? 'receiving from' : 'sending to'} it right now.` : ''}` })
    } else if (resource.state === 'waitgroup' && !goroutines.some((goroutine) => !isBlocked(goroutine.state))) {
      diagnostics.push({ ...base, id: `waitgroup:${resource.key}`, kind: 'waitgroup', severity: 'warning', title: 'WaitGroup never reaches zero', detail: `${plural(ids.length, 'goroutine')} wait on ${describeTarget(resource)}, but no goroutine is running to call Done. Check Add/Done pairs.` })
    } else if (resource.state === 'mutex') {
      diagnostics.push({ ...base, id: `mutex:${resource.key}`, kind: 'mutex', severity: 'info', title: 'Waiting for a mutex', detail: `Goroutine #${ids[0]} waiting to lock ${describeTarget(resource)}.` })
    }
  }
  diagnostics.push(...poolSaturation(goroutines))
  if (goroutines.length >= EXCESSIVE_GOROUTINES) {
    diagnostics.push({ id: 'count', kind: 'count', severity: 'warning', evidence: 'observed', title: 'Excessive goroutine count', detail: `${goroutines.length} goroutines at this pause. Look for goroutines started per request or per message that never exit.`, goroutineIds: [] })
  }
  const order = { error: 0, warning: 1, info: 2 }
  return diagnostics.sort((left, right) => order[left.severity] - order[right.severity])
}

export interface RaceFrame {
  func: string
  path: string
  line: number
}

export interface RaceAccess {
  /** "Write", "Read", "Previous write", "Previous read". */
  kind: string
  address: string
  goroutine: number
  frames: RaceFrame[]
}

export interface RaceGoroutine {
  id: number
  state: string
  createdAt: RaceFrame[]
}

export interface RaceReport {
  id: string
  accesses: RaceAccess[]
  goroutines: RaceGoroutine[]
  raw: string
  /** Quante volte lo stesso race è stato stampato (anche in run diverse). */
  occurrences: number
  /** Fonti in cui compare (run, test o debug), dalla più recente. */
  sources: string[]
}

const RACE_START = 'WARNING: DATA RACE'
const RACE_END = '=================='
const ACCESS_LINE = /^(Write|Read|Previous write|Previous read) at (0x[0-9a-f]+) by (?:goroutine (\d+)|main goroutine):$/i
const CREATED_LINE = /^Goroutine (\d+) \(([^)]+)\) created at:$/
const FRAME_FILE_LINE = /^(.+\.(?:go|s)):(\d+)(?: \+0x[0-9a-f]+)?$/

function parseFrames(lines: string[], start: number): { frames: RaceFrame[]; next: number } {
  const frames: RaceFrame[] = []
  let index = start
  while (index + 1 < lines.length) {
    const func = lines[index].trim()
    const location = FRAME_FILE_LINE.exec(lines[index + 1].trim())
    if (!func || !location || ACCESS_LINE.test(func) || CREATED_LINE.test(func)) break
    frames.push({ func: func.replace(/\(\)$/, '').replace(/\(0x[^)]*\)$/, ''), path: location[1], line: Number(location[2]) })
    index += 2
  }
  return { frames, next: index }
}

/** Trasforma l'output del race detector (go run/test -race) in report navigabili. */
export function parseRaceReports(text: string): RaceReport[] {
  const reports: RaceReport[] = []
  let cursor = text.indexOf(RACE_START)
  while (cursor >= 0) {
    const end = text.indexOf(RACE_END, cursor + RACE_START.length)
    const raw = text.slice(cursor, end < 0 ? undefined : end + RACE_END.length)
    const lines = raw.split(/\r?\n/)
    const report: RaceReport = { id: '', accesses: [], goroutines: [], raw, occurrences: 1, sources: [] }
    for (let index = 1; index < lines.length; index++) {
      const line = lines[index].trim()
      const access = ACCESS_LINE.exec(line)
      if (access) {
        const parsed = parseFrames(lines, index + 1)
        report.accesses.push({ kind: access[1], address: access[2], goroutine: access[3] ? Number(access[3]) : MAIN_GOROUTINE_ID, frames: parsed.frames })
        index = parsed.next - 1
        continue
      }
      const created = CREATED_LINE.exec(line)
      if (created) {
        const parsed = parseFrames(lines, index + 1)
        report.goroutines.push({ id: Number(created[1]), state: created[2], createdAt: parsed.frames })
        index = parsed.next - 1
      }
    }
    const first = report.accesses[0]?.frames[0]
    report.id = `${first?.path ?? ''}:${first?.line ?? 0}|${report.accesses[1]?.frames[0]?.line ?? 0}|${report.accesses[0]?.address ?? reports.length}`
    const existing = reports.find((item) => item.id === report.id)
    if (existing) existing.occurrences++
    else if (report.accesses.length > 0) reports.push(report)
    if (end < 0) break
    cursor = text.indexOf(RACE_START, end)
  }
  return reports
}

export interface RaceSource {
  id: string
  label: string
  text: string
}

/**
 * Race di più run a confronto: ogni race ricorda in quali fonti compare, così si vede se è
 * nuovo nell'ultima run, ricorrente o già sparito. Le fonti vanno dalla più recente.
 */
export function mergeRaceSources(sources: RaceSource[]): RaceReport[] {
  const merged = new Map<string, RaceReport>()
  for (const source of sources) {
    for (const report of parseRaceReports(source.text)) {
      const current = merged.get(report.id)
      if (current) {
        current.occurrences += report.occurrences
        if (!current.sources.includes(source.label)) current.sources.push(source.label)
      } else {
        merged.set(report.id, { ...report, sources: [source.label] })
      }
    }
  }
  return [...merged.values()]
}

/** Un race è sempre un errore: una voce per report, sulla prima riga coinvolta. */
export function raceDiagnostics(reports: RaceReport[]): ConcurrencyDiagnostic[] {
  return reports.map((report) => {
    const [current, previous] = report.accesses
    const where = current?.frames[0]
    return {
      id: `race:${report.id}`, kind: 'race', severity: 'error', evidence: 'confirmed',
      title: 'Data race detected',
      detail: `${current?.kind ?? 'Access'} by goroutine ${current?.goroutine ?? '?'} in ${current?.frames[0]?.func ?? '?'} conflicts with ${previous ? `${previous.kind.toLowerCase()} by goroutine ${previous.goroutine} in ${previous.frames[0]?.func ?? '?'}` : 'another access'}.`,
      goroutineIds: report.accesses.map((access) => access.goroutine),
      line: where?.line,
    }
  })
}
