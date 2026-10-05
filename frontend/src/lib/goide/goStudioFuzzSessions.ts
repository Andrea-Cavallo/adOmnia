import { safeSetItem } from '@/lib/safeLocalStorage'

/** Una sessione `go test -fuzz` terminata, ricavata dal suo output: nessun dato inventato. */
export interface GoStudioFuzzSession {
  id: string
  target: string
  command: string
  startedAt: string
  durationMillis: number
  status: string
  workers: number | null
  execs: number | null
  execsPerSecond: number | null
  newInteresting: number | null
  corpusTotal: number | null
  /** Percorso relativo al package, es. testdata/fuzz/FuzzX/<hash>. */
  crashFile: string | null
  failure: string | null
  /** Messaggio normalizzato (senza numeri e valori tra virgolette) per raggruppare crash uguali. */
  signature: string | null
  minimized: boolean
}

export interface GoStudioFuzzRunInfo {
  id: string
  command: string
  status: string
  startedAt: string
  durationMillis: number
}

const STORAGE_PREFIX = 'adomnia.goide.fuzz-sessions.v1.'
const MAX_SESSIONS = 60
const FUZZ_FLAG = /(?:^|\s)-(?:test\.)?fuzz(?:=|\s+)\^?(Fuzz\w*)\$?(?=\s|$)/
const PROGRESS = /fuzz: elapsed: [^,]+, execs: (\d+) \((\d+)\/sec\), new interesting: (\d+) \(total: (\d+)\)/g
const WORKERS = /now fuzzing with (\d+) workers/
const FAILING_INPUT = /Failing input written to (\S+)/

/** Nome del target se il comando è una sessione di fuzzing (non un replay -run). */
export function fuzzTargetOfCommand(command: string): string | null {
  return FUZZ_FLAG.exec(command)?.[1] ?? null
}

/** Normalizza un messaggio di errore: stessi crash con valori diversi danno la stessa firma. */
export function fuzzFailureSignature(message: string): string {
  return message
    .replace(/^\s*[\w.-]+\.go:\d+:\s*/, '')
    .replace(/"(?:[^"\\]|\\.)*"|`[^`]*`|'(?:[^'\\]|\\.)*'/g, '…')
    .replace(/0x[0-9a-f]+/gi, 'N')
    .replace(/\d+/g, 'N')
    .replace(/\s+/g, ' ')
    .trim()
}

function failureMessage(lines: readonly string[]): string | null {
  const firstFail = lines.findIndex((line) => /^\s*--- FAIL: Fuzz/.test(line))
  if (firstFail < 0) return null
  for (let index = firstFail + 1; index < lines.length; index++) {
    const line = lines[index].trim()
    if (!line || line.startsWith('--- FAIL')) continue
    if (line.startsWith('Failing input written') || line === 'FAIL') break
    const panic = /panic: (.+)$/.exec(line)
    return panic ? `panic: ${panic[1]}` : line
  }
  return null
}

/** Interpreta l'output di una run fuzz terminata; null se non era una sessione di fuzzing. */
export function parseFuzzSession(run: GoStudioFuzzRunInfo, output: string): GoStudioFuzzSession | null {
  const target = fuzzTargetOfCommand(run.command)
  if (!target) return null
  const lines = output.split(/\r?\n/)
  let last: RegExpExecArray | null = null
  for (const match of output.matchAll(PROGRESS)) last = match as RegExpExecArray
  const failure = failureMessage(lines)
  const workers = WORKERS.exec(output)
  const crashFile = FAILING_INPUT.exec(output)?.[1]?.replace(/\\/g, '/') ?? null
  return {
    id: run.id,
    target,
    command: run.command,
    startedAt: run.startedAt,
    durationMillis: run.durationMillis,
    status: crashFile || failure ? 'crashed' : run.status,
    workers: workers ? Number(workers[1]) : null,
    execs: last ? Number(last[1]) : null,
    execsPerSecond: last ? Number(last[2]) : null,
    newInteresting: last ? Number(last[3]) : null,
    corpusTotal: last ? Number(last[4]) : null,
    crashFile,
    failure,
    signature: failure ? fuzzFailureSignature(failure) : null,
    minimized: /fuzz: elapsed: [^,]+, minimizing/.test(output),
  }
}

function storageKey(projectRoot: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(projectRoot.trim())}`
}

export function loadFuzzSessions(projectRoot: string): GoStudioFuzzSession[] {
  if (!projectRoot.trim()) return []
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(projectRoot)) || '[]')
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.id === 'string' && typeof item.target === 'string').slice(0, MAX_SESSIONS) : []
  } catch {
    return []
  }
}

export function recordFuzzSession(projectRoot: string, session: GoStudioFuzzSession): GoStudioFuzzSession[] {
  if (!projectRoot.trim()) return []
  const next = [session, ...loadFuzzSessions(projectRoot).filter((item) => item.id !== session.id)].slice(0, MAX_SESSIONS)
  safeSetItem(storageKey(projectRoot), JSON.stringify(next))
  return next
}

export function clearFuzzSessions(projectRoot: string): void {
  try { localStorage.removeItem(storageKey(projectRoot)) } catch { /* storage disabilitato: nulla da cancellare */ }
}

export interface GoStudioFuzzCrashGroup {
  signature: string
  target: string
  count: number
  latest: GoStudioFuzzSession
}

/** Deduplica i crash: uno per firma e target, con il numero di occorrenze e l'ultimo input. */
export function groupFuzzCrashes(sessions: readonly GoStudioFuzzSession[]): GoStudioFuzzCrashGroup[] {
  const groups = new Map<string, GoStudioFuzzCrashGroup>()
  for (const session of sessions) {
    if (session.status !== 'crashed') continue
    const signature = session.signature ?? session.crashFile ?? session.id
    const key = `${session.target}\u0000${signature}`
    const existing = groups.get(key)
    if (!existing) groups.set(key, { signature, target: session.target, count: 1, latest: session })
    else {
      existing.count++
      if (session.startedAt > existing.latest.startedAt) existing.latest = session
    }
  }
  return [...groups.values()].sort((left, right) => right.latest.startedAt.localeCompare(left.latest.startedAt))
}
