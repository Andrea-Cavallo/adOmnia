import { requestLogInspectorQuery } from '@/lib/loginspector/handoff'
import { showModule } from '@/lib/moduleRouting'

/** Opens the Log Inspector on the log lines that carry this trace id (traceId / trace_id fields). */
export function openTraceLogs(traceId: string): void {
  requestLogInspectorQuery(`traceId:${traceId}`)
  showModule('loginspector')
}
