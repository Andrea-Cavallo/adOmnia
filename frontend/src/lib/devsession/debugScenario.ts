// One-Click Debug Scenario: a Debug Request saved with everything needed to replay it
// (environment, test data, breakpoints, assertions, check queries) and the evidence of its
// last runs, so a replay tells what changed since the previous one.
import type { AssertionResult, KVRow, RequestItem, ResponseData } from '@/lib/types'
import type { LiveHit, LiveLogEntry, LiveMessage, LiveQuery } from '@/lib/devsession-api'

export interface ScenarioBreakpoint {
  relativePath: string
  line: number
  condition?: string
  hitCondition?: string
  logMessage?: string
}

/** A read-only statement run on a Database Studio connection after the call, to capture the data it left. */
export interface ScenarioQuery {
  connectionId: string
  connectionName: string
  sql: string
}

export interface QueryEvidence {
  sql: string
  rows: number
  /** Stable text of the rows, so a changed value shows as a difference. */
  digest: string
  error?: string
}

export interface ScenarioEvidence {
  at: string
  service: string
  status: number
  durationMs: number
  error?: string
  /** Key paths and types of a JSON body (values left out: ids and timestamps change on every run). */
  bodyShape: string[]
  assertions: Array<Pick<AssertionResult, 'label' | 'passed' | 'actual'>>
  /** Breakpoint locations the request stopped at, as `function file:line`. */
  hits: string[]
  /** Statements the service ran, with literals replaced by `?`. */
  sql: string[]
  logErrors: number
  logs: number
  topics: string[]
  queries: QueryEvidence[]
}

export interface DebugScenario {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  /** Snapshot of the request: the scenario replays what was saved, not what the tab holds today. */
  request: RequestItem
  collectionId?: string
  environmentId: string | null
  /** Variables set over the environment for this scenario only. */
  testData: KVRow[]
  breakpoints: ScenarioBreakpoint[]
  queries: ScenarioQuery[]
  lastRun?: ScenarioEvidence
  previousRun?: ScenarioEvidence
}

/** `{ "a": [{ "b": 1 }] }` → `["a:array", "a[].b:number"]`, sorted. */
export function jsonShape(body: string): string[] {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return []
  }
  const paths = new Set<string>()
  const walk = (node: unknown, path: string) => {
    if (Array.isArray(node)) {
      if (path) paths.add(`${path}:array`)
      for (const item of node.slice(0, 20)) walk(item, `${path}[]`)
      return
    }
    if (node && typeof node === 'object') {
      if (path) paths.add(`${path}:object`)
      for (const [key, item] of Object.entries(node)) walk(item, path ? `${path}.${key}` : key)
      return
    }
    paths.add(`${path || '$'}:${node === null ? 'null' : typeof node}`)
  }
  walk(value, '')
  return [...paths].sort((a, b) => a.localeCompare(b))
}

/** Literals out, whitespace collapsed: the same statement with other values compares equal. */
export function normalizeSql(sql: string): string {
  return sql
    .replace(/'(?:[^']|'')*'/g, '?')
    .replace(/\$\d+/g, '?')
    .replace(/\b\d+(\.\d+)?\b/g, '?')
    .replace(/\s+/g, ' ')
    .trim()
}

function hitLabel(hit: LiveHit): string {
  return `${hit.function} ${hit.relativePath ?? hit.file ?? ''}:${hit.line}`
}

const unique = (items: string[]) => [...new Set(items)]

export interface EvidenceInput {
  service: string
  response: ResponseData
  assertions: AssertionResult[]
  hits: LiveHit[]
  logs: LiveLogEntry[]
  sqlStatements: LiveQuery[]
  messages: LiveMessage[]
  queries: QueryEvidence[]
  at: string
}

export function buildEvidence(input: EvidenceInput): ScenarioEvidence {
  const { response } = input
  return {
    at: input.at,
    service: input.service,
    status: response.status,
    durationMs: Math.round(response.ms ?? 0),
    ...(response.error ? { error: `${response.error.code}: ${response.error.message}` } : {}),
    bodyShape: jsonShape(response.body),
    assertions: input.assertions.map(({ label, passed, actual }) => ({ label, passed, actual })),
    hits: unique(input.hits.map((hit) => hitLabel(hit))),
    sql: unique(input.sqlStatements.map((query) => normalizeSql(query.sql))),
    logErrors: input.logs.filter((entry) => /^(error|fatal|panic)$/i.test(entry.level ?? '') || entry.stream === 'stderr').length,
    logs: input.logs.length,
    topics: unique(input.messages.map((message) => message.topic)),
    queries: input.queries,
  }
}

function setDiff(label: string, before: string[], after: string[]): string[] {
  const old = new Set(before)
  const now = new Set(after)
  return [
    ...after.filter((item) => !old.has(item)).map((item) => `${label} added: ${item}`),
    ...before.filter((item) => !now.has(item)).map((item) => `${label} gone: ${item}`),
  ]
}

/** Slower by more than half and by at least 200 ms: a real change, not noise. */
function slower(before: number, after: number): boolean {
  return after - before >= 200 && after > before * 1.5
}

/** What changed between two runs of the same scenario, as short sentences; empty when nothing did. */
export function diffEvidence(before: ScenarioEvidence, after: ScenarioEvidence): string[] {
  const changes: string[] = []
  if (before.status !== after.status) changes.push(`Status ${before.status || 'none'} → ${after.status || 'none'}`)
  if ((before.error ?? '') !== (after.error ?? '')) changes.push(after.error ? `Error: ${after.error}` : 'The error is gone')
  if (slower(before.durationMs, after.durationMs)) changes.push(`Slower: ${before.durationMs} ms → ${after.durationMs} ms`)
  changes.push(...setDiff('Body field', before.bodyShape, after.bodyShape))
  const passedBefore = new Map(before.assertions.map((item) => [item.label, item.passed]))
  for (const item of after.assertions) {
    const was = passedBefore.get(item.label)
    if (was !== undefined && was !== item.passed) changes.push(`Assertion ${item.passed ? 'now passes' : 'now fails'}: ${item.label}${item.passed ? '' : ` (got ${item.actual})`}`)
  }
  changes.push(...setDiff('Code path', before.hits, after.hits))
  changes.push(...setDiff('SQL', before.sql, after.sql))
  changes.push(...setDiff('Topic', before.topics, after.topics))
  if (after.logErrors > before.logErrors) changes.push(`Error log lines: ${before.logErrors} → ${after.logErrors}`)
  const queryBefore = new Map(before.queries.map((query) => [query.sql, query]))
  for (const query of after.queries) {
    const was = queryBefore.get(query.sql)
    if (!was) continue
    if ((was.error ?? '') !== (query.error ?? '')) changes.push(`Check query ${query.error ? 'fails' : 'works again'}: ${query.sql}`)
    else if (was.digest !== query.digest) changes.push(`Data changed (${was.rows} → ${query.rows} rows): ${query.sql}`)
  }
  return changes
}

/** Breakpoints of a Code Studio project as scenario entries (Code Studio keeps them per file). */
export function scenarioBreakpoints(byFile: Record<string, Array<{ line: number; condition?: string; hitCondition?: string; logMessage?: string; disabled?: boolean }>> | undefined): ScenarioBreakpoint[] {
  return Object.entries(byFile ?? {}).flatMap(([relativePath, items]) => items
    .filter((item) => !item.disabled)
    .map((item) => ({
      relativePath,
      line: item.line,
      ...(item.condition ? { condition: item.condition } : {}),
      ...(item.hitCondition ? { hitCondition: item.hitCondition } : {}),
      ...(item.logMessage ? { logMessage: item.logMessage } : {}),
    })))
}

/** Environment variables with the scenario's test data on top. */
export function scenarioVars(envVars: Record<string, string>, testData: KVRow[]): Record<string, string> {
  const vars = { ...envVars }
  for (const row of testData) if (row.enabled && row.key) vars[row.key] = row.value
  return vars
}

/** Rows as stable text: keys sorted, so the same data always gives the same digest. */
export function rowsDigest(rows: Array<Record<string, unknown>>): string {
  return JSON.stringify(rows.map((row) => Object.keys(row).sort((a, b) => a.localeCompare(b)).map((key) => [key, row[key]])))
}
