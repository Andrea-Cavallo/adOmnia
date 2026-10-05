import type { LiveSession, RequestRun } from '@/lib/devsession-api'

export interface CorrelatedSpan {
  correlationId: string
  service?: string
}

export function debugRunForTrace(
  spans: CorrelatedSpan[],
  runs: Record<string, RequestRun>,
  runOrder: string[],
  sessions: Record<string, LiveSession>,
): { run: RequestRun; session: LiveSession } | null {
  const ids = new Set(spans.map((span) => span.correlationId).filter(Boolean))
  if (ids.size === 0) return null
  for (let index = runOrder.length - 1; index >= 0; index--) {
    const run = runs[runOrder[index]]
    if (!run?.tabId || !ids.has(run.correlationId)) continue
    const session = sessions[run.sessionId]
    if (session?.kind === 'debug' && session.state !== 'stopped' && session.state !== 'error'
      && spans.some((span) => span.correlationId === run.correlationId && (!span.service || span.service === session.service))) return { run, session }
  }
  return null
}
