import type { LiveLogEntry, LiveSession } from '@/lib/devsession-api'
import type { BackendDevLogEntry } from '@/stores/devLogs'

export function structuredLiveTraceEntries(logs: Record<string, LiveLogEntry[]>, sessions: Record<string, LiveSession>): BackendDevLogEntry[] {
  const result: BackendDevLogEntry[] = []
  for (const [sessionId, lines] of Object.entries(logs)) {
    const service = sessions[sessionId]?.service ?? sessionId
    for (const line of lines) {
      if (!line.text.startsWith('{') || line.text.length > 64 * 1024) continue
      try {
        const value: unknown = JSON.parse(line.text)
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue
        const data = value as Record<string, unknown>
        const otel = data.otel && typeof data.otel === 'object' && !Array.isArray(data.otel) ? data.otel as Record<string, unknown> : null
        if (!('trace_id' in data || 'traceId' in data || 'trace.id' in data || 'otel.trace_id' in data || otel?.trace_id)) continue
        result.push({
          i: line.seq,
          ts: line.at,
          source: service,
          level: typeof data.level === 'string' ? data.level : line.level ?? 'INFO',
          msg: typeof data.msg === 'string' ? data.msg : typeof data.message === 'string' ? data.message : '',
          data: { ...data, service: typeof data.service === 'string' ? data.service : service },
        })
      } catch { /* plain text or incomplete JSON */ }
    }
  }
  return result
}
