import type { GoIDEProfileReport } from '@/lib/goide-api'

/** A point-in-time picture of a running service, saved in .adomnia/snapshots to compare later. */
export interface RuntimeSnapshot {
  version: 1
  label: string
  takenAt: string
  service: string
  goroutines: { total: number; byFunction: Array<{ name: string; count: number }> } | null
  heap: { inuseBytes: number; byFunction: Array<{ name: string; bytes: number }> } | null
  requests: Array<{ method: string; url: string; state: string; status?: number; durationMs?: number; error?: string }>
  messages: Array<{ broker: string; topic: string; partition: number; offset: number; at: string }>
  queries: Array<{ sql: string; durationMs?: number | null; error?: string }>
  logs: string[]
  traces: Array<{ traceId: string; root: string; durationMs: number; errors: number }>
  errors: string[]
}

const TOP = 25

function sampleIndex(report: GoIDEProfileReport, names: string[]): number {
  const index = report.sampleTypes.findIndex((type) => names.includes(type.name))
  return index >= 0 ? index : Math.max(0, report.sampleTypes.length - 1)
}

/** goroutine profile: how many goroutines stand in each function (inclusive, so their entry points show). */
export function goroutineSummary(report: GoIDEProfileReport): RuntimeSnapshot['goroutines'] {
  const index = sampleIndex(report, ['goroutine', 'count'])
  return {
    total: report.totals?.[index] ?? 0,
    byFunction: (report.topCum ?? []).filter((node) => !node.function.runtime).slice(0, TOP).map((node) => ({ name: node.function.name, count: node.cum[index] ?? 0 })),
  }
}

/** heap profile: bytes in use, by allocating function. */
export function heapSummary(report: GoIDEProfileReport): RuntimeSnapshot['heap'] {
  const index = sampleIndex(report, ['inuse_space'])
  return {
    inuseBytes: report.totals?.[index] ?? 0,
    byFunction: (report.topFlat ?? []).slice(0, TOP).map((node) => ({ name: node.function.name, bytes: node.flat[index] ?? 0 })),
  }
}

export interface SnapshotDelta { label: string; before: number; after: number }

export interface SnapshotComparison {
  summary: SnapshotDelta[]
  goroutines: SnapshotDelta[]
  heap: SnapshotDelta[]
  newErrors: string[]
}

function deltas(before: Array<{ name: string; value: number }>, after: Array<{ name: string; value: number }>): SnapshotDelta[] {
  const values = new Map<string, SnapshotDelta>()
  for (const item of before) values.set(item.name, { label: item.name, before: item.value, after: 0 })
  for (const item of after) values.set(item.name, { label: item.name, before: values.get(item.name)?.before ?? 0, after: item.value })
  return [...values.values()].filter((item) => item.before !== item.after).sort((left, right) => Math.abs(right.after - right.before) - Math.abs(left.after - left.before)).slice(0, TOP)
}

/** Before/after: totals that moved, goroutines and heap by function, error lines that are new. */
export function compareSnapshots(before: RuntimeSnapshot, after: RuntimeSnapshot): SnapshotComparison {
  const count = (snapshot: RuntimeSnapshot) => ({
    goroutines: snapshot.goroutines?.total ?? 0,
    heap: snapshot.heap?.inuseBytes ?? 0,
    requests: snapshot.requests.length,
    failedRequests: snapshot.requests.filter((request) => request.error || (request.status ?? 0) >= 500).length,
    messages: snapshot.messages.length,
    queries: snapshot.queries.length,
    slowQueries: snapshot.queries.filter((query) => (query.durationMs ?? 0) >= 100).length,
    traceErrors: snapshot.traces.reduce((sum, trace) => sum + trace.errors, 0),
    errorLogs: snapshot.errors.length,
  })
  const a = count(before)
  const b = count(after)
  const labels: Record<keyof typeof a, string> = {
    goroutines: 'Goroutines', heap: 'Heap in use (bytes)', requests: 'Requests', failedRequests: 'Failed requests', messages: 'Messages',
    queries: 'Queries', slowQueries: 'Queries ≥ 100 ms', traceErrors: 'Errors in traces', errorLogs: 'Error log lines',
  }
  const seen = new Set(before.errors)
  return {
    summary: (Object.keys(a) as Array<keyof typeof a>).map((key) => ({ label: labels[key], before: a[key], after: b[key] })),
    goroutines: deltas((before.goroutines?.byFunction ?? []).map((item) => ({ name: item.name, value: item.count })), (after.goroutines?.byFunction ?? []).map((item) => ({ name: item.name, value: item.count }))),
    heap: deltas((before.heap?.byFunction ?? []).map((item) => ({ name: item.name, value: item.bytes })), (after.heap?.byFunction ?? []).map((item) => ({ name: item.name, value: item.bytes }))),
    newErrors: after.errors.filter((line) => !seen.has(line)).slice(0, 30),
  }
}

export const ERROR_LINE = /\b(error|panic|fatal|fail(ed|ure)?|timeout|refused)\b/i
