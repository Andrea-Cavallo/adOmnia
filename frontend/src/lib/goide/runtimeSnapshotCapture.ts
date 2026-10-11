import { captureGoIDELiveProfile, loadGoIDEProfile } from '@/lib/goide-api'
import type { LiveSession } from '@/lib/devsession-api'
import { listOtlpTraces } from '@/lib/otlp-api'
import { getServerPort } from '@/lib/useServerPort'
import { useDevSessionStore } from '@/stores/devSession'
import { ERROR_LINE, goroutineSummary, heapSummary, type RuntimeSnapshot } from './runtimeSnapshot'

const RECENT = 100

/**
 * Takes a snapshot of a live service: goroutines and heap from its /debug/pprof (when it exposes
 * it), and what adOmnia observed — in-flight and recent requests, broker messages, SQL, logs, traces.
 */
export async function takeRuntimeSnapshot(sessionId: string, live: LiveSession, label: string): Promise<{ snapshot: RuntimeSnapshot; warnings: string[] }> {
  const warnings: string[] = []
  const url = live.port ? `http://127.0.0.1:${live.port}` : ''
  const profile = async (kind: 'goroutine' | 'heap') => {
    if (!url) {
      warnings.push(`${kind}: the service port is not known yet`)
      return null
    }
    try {
      const file = await captureGoIDELiveProfile({ sessionId, url, kind })
      return await loadGoIDEProfile(sessionId, file.relative)
    } catch (problem) {
      warnings.push(`${kind}: ${problem instanceof Error ? problem.message : String(problem)} (import _ "net/http/pprof" to enable it)`)
      return null
    }
  }
  const [goroutines, heap] = [await profile('goroutine'), await profile('heap')]
  const state = useDevSessionStore.getState()
  const runs = state.runOrder.map((id) => state.runs[id]).filter((run) => run?.sessionId === live.id).slice(-RECENT)
  const logs = (state.logs[live.id] ?? []).slice(-RECENT).map((entry) => entry.text)
  const port = await getServerPort()
  const traces = port ? await listOtlpTraces(port, 200).catch(() => []) : []
  const snapshot: RuntimeSnapshot = {
    version: 1,
    label,
    takenAt: new Date().toISOString(),
    service: live.service,
    goroutines: goroutines ? goroutineSummary(goroutines) : null,
    heap: heap ? heapSummary(heap) : null,
    requests: runs.map((run) => ({ method: run.method, url: run.url, state: run.state, status: run.status, durationMs: run.durationMs, error: run.error })),
    messages: state.messages.filter((message) => message.sessionId === live.id).slice(-RECENT).map((message) => ({ broker: message.broker, topic: message.topic, partition: message.partition, offset: message.offset, at: message.at })),
    queries: state.queries.filter((query) => query.sessionId === live.id).slice(-RECENT).map((query) => ({ sql: query.sql.slice(0, 500), durationMs: query.durationMs, error: query.error })),
    logs,
    traces: (traces ?? []).filter((trace) => trace.services.includes(live.service) || traces.length < 50).slice(0, 50).map((trace) => ({ traceId: trace.traceId, root: trace.root, durationMs: trace.durationMs, errors: trace.errors })),
    errors: logs.filter((line) => ERROR_LINE.test(line)),
  }
  return { snapshot, warnings }
}
