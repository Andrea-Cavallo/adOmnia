import type { GoIDETestRun } from '../code-studio-tests-api'
import type { TestTarget } from './testTargets'

/** Stato di una suite: l'esito dell'ultima esecuzione del suo target, `queued` se Run All non è ancora arrivato a lei, `notrun` se non è mai partita. */
export type SuiteStatus = 'passed' | 'failed' | 'running' | 'queued' | 'stopped' | 'notrun'
export type SuiteFilter = 'all' | SuiteStatus

/** Una riga della dashboard Tests: un'unità di build testabile (modulo Go, package.json, pom.xml…) con la sua ultima run. */
export interface TestSuite {
  key: string
  name: string
  /** Cartella dell'unità relativa al progetto, `./billing`; `./` per la radice. */
  path: string
  language: string
  languageLabel: string
  target: TestTarget
  run: GoIDETestRun | null
  status: SuiteStatus
  passed: number
  failed: number
  skipped: number
  running: number
  total: number
  durationMs: number
  /** ISO dell'ultima esecuzione (fine, o inizio se ancora in corso); null se mai eseguita. */
  lastRunAt: string | null
}

export interface SuiteStats {
  total: number
  passed: number
  failed: number
  running: number
  queued: number
  /** Mai eseguite, o fermate prima di finire. */
  notRun: number
  /** Percentuali sul totale delle suite, intere: servono alle schede statistiche. */
  passedPercent: number
  failedPercent: number
  runningPercent: number
  queuedPercent: number
  lastRunDurationMs: number
  lastRunAt: string | null
}

const LANGUAGE_LABELS: Readonly<Record<string, string>> = { go: 'Go', typescript: 'JS/TS', javascript: 'JS/TS', java: 'Java' }

export function languageLabel(language: string): string {
  return LANGUAGE_LABELS[language] ?? (language ? language[0].toUpperCase() + language.slice(1) : 'Go')
}

function sameTarget(run: GoIDETestRun, target: TestTarget): boolean {
  return (run.request.language || 'go') === target.language && (run.request.workingDirectory ?? '') === target.workingDirectory
}

function statusOf(run: GoIDETestRun | null): SuiteStatus {
  if (!run) return 'notrun'
  if (run.status === 'running') return 'running'
  // Un build che non compila non produce risultati ma è comunque un fallimento.
  if (run.summary.failed > 0 || run.diagnostics || (run.exitCode != null && run.exitCode !== 0 && run.status !== 'stopped')) return 'failed'
  if (run.status === 'stopped') return 'stopped'
  return 'passed'
}

function durationOf(run: GoIDETestRun | null, now: number): number {
  if (!run) return 0
  const start = Date.parse(run.startedAt)
  const end = run.finishedAt ? Date.parse(run.finishedAt) : now
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0
}

function nameOf(target: TestTarget): string {
  return target.label.split(' · ')[0]
}

/** Una suite per target testabile, con la run più recente dello stesso target (le run arrivano ordinate dalla più recente). */
export function buildSuites(targets: readonly TestTarget[], runs: readonly GoIDETestRun[], now = Date.now(), queued: ReadonlySet<string> = new Set()): TestSuite[] {
  return targets.map((target) => {
    const run = runs.find((candidate) => sameTarget(candidate, target)) ?? null
    const summary = run?.summary
    const passed = summary?.passed ?? 0
    const failed = summary?.failed ?? 0
    const skipped = summary?.skipped ?? 0
    const running = summary?.running ?? 0
    return {
      key: target.key,
      name: nameOf(target),
      path: target.workingDirectory ? `./${target.workingDirectory}` : './',
      language: target.language,
      languageLabel: languageLabel(target.language),
      target,
      run,
      status: queued.has(target.key) && run?.status !== 'running' ? 'queued' : statusOf(run),
      passed, failed, skipped, running,
      total: passed + failed + skipped + running,
      durationMs: durationOf(run, now),
      lastRunAt: run ? run.finishedAt ?? run.startedAt : null,
    }
  })
}

const percent = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part / whole) * 100))

export function suiteStats(suites: readonly TestSuite[]): SuiteStats {
  const count = (status: SuiteStatus) => suites.filter((suite) => suite.status === status).length
  const total = suites.length
  const passed = count('passed')
  const failed = count('failed')
  const running = count('running')
  const queued = count('queued')
  const notRun = count('notrun') + count('stopped')
  const last = suites
    .filter((suite) => suite.run && suite.status !== 'running' && suite.status !== 'queued')
    .sort((left, right) => (right.lastRunAt ?? '').localeCompare(left.lastRunAt ?? ''))[0]
  return {
    total, passed, failed, running, queued, notRun,
    passedPercent: percent(passed, total), failedPercent: percent(failed, total), runningPercent: percent(running, total), queuedPercent: percent(queued, total),
    lastRunDurationMs: last?.durationMs ?? 0,
    lastRunAt: last?.lastRunAt ?? null,
  }
}

export function filterSuites(suites: readonly TestSuite[], filter: SuiteFilter, query: string): TestSuite[] {
  const needle = query.trim().toLocaleLowerCase()
  return suites.filter((suite) => {
    if (filter !== 'all' && !(filter === 'notrun' ? suite.status === 'notrun' || suite.status === 'stopped' : suite.status === filter)) return false
    return !needle || `${suite.name} ${suite.path} ${suite.languageLabel}`.toLocaleLowerCase().includes(needle)
  })
}

/** "now", "42s ago", "3m ago", "2h ago", "5d ago"; vuoto se la data manca o non è valida. */
export function relativeTime(iso: string | null, now = Date.now()): string {
  if (!iso) return ''
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return ''
  const seconds = Math.max(0, Math.round((now - time) / 1000))
  if (seconds < 10) return 'now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
