import { AlertTriangle, CheckCircle2, Clock3, RotateCw, ShieldAlert, X, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AnalyzedRequest, LogAnalysis, RequestStatus } from '@/lib/loginspector'

interface AnalysisOverviewProps {
  analysis: LogAnalysis
  onFilterRequest: (request: AnalyzedRequest) => void
  onClose: () => void
}

const STATUS_LABEL: Record<RequestStatus, string> = {
  success: 'Success',
  'client-error': 'Client error',
  'server-error': 'Server error',
  timeout: 'Timeout',
  retry: 'Retry',
  unknown: 'Unknown',
}

function statusStyle(status: RequestStatus): string {
  if (status === 'success') return 'bg-success/12 text-success'
  if (status === 'timeout' || status === 'server-error') return 'bg-error/12 text-error'
  if (status === 'client-error' || status === 'retry') return 'bg-warning/12 text-warning'
  return 'bg-surface-2 text-text-3'
}

function StatusIcon({ status }: { status: RequestStatus }) {
  if (status === 'success') return <CheckCircle2 size={11} />
  if (status === 'timeout') return <Clock3 size={11} />
  if (status === 'retry') return <RotateCw size={11} />
  if (status === 'client-error') return <AlertTriangle size={11} />
  return status === 'server-error' ? <XCircle size={11} /> : null
}

function duration(value: number | null): string {
  if (value === null) return 'n/d'
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 1 : 2)}s`
  return `${Math.round(value)}ms`
}

export function AnalysisOverview({ analysis, onFilterRequest, onClose }: AnalysisOverviewProps) {
  const failures = analysis.requests.filter((request) => request.status === 'timeout' || request.status === 'server-error').length
  const warnings = analysis.requests.filter((request) => request.status === 'client-error' || request.status === 'retry').length

  return (
    <section className="flex max-h-[230px] shrink-0 flex-col overflow-hidden border-b border-border-1 bg-surface-1/70">
      <header className="flex shrink-0 items-center gap-2 border-b border-border-1 px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-2">Request analysis</span>
        <Metric label="requests" value={analysis.requests.length} />
        {failures > 0 && <Metric label="critical" value={failures} tone="error" />}
        {warnings > 0 && <Metric label="warnings" value={warnings} tone="warning" />}
        {analysis.sensitiveFields.length > 0 && (
          <span className="flex items-center gap-1 rounded bg-warning/10 px-1.5 py-0.5 text-[9px] text-warning" title="Potential clear-text sensitive fields">
            <ShieldAlert size={10} /> {analysis.sensitiveFields.length} sensitive fields
          </span>
        )}
        <span className="ml-auto truncate font-mono text-[9px] text-text-4">
          {analysis.environments.join(', ') || 'environment n/d'}
          {analysis.services.length ? ` · ${analysis.services.map((service) => `${service.name}${service.version ? ` v${service.version}` : ''}`).join(', ')}` : ''}
        </span>
        <button onClick={onClose} title="Close request analysis" className="grid h-6 w-6 shrink-0 place-items-center rounded text-text-4 hover:bg-surface-2 hover:text-text-1">
          <X size={12} />
        </button>
      </header>

      <div className="min-h-0 overflow-auto">
        {analysis.requests.length === 0 ? (
          <p className="px-3 py-4 text-[11px] text-text-4">No correlation_id or request_id found. Request grouping is unavailable.</p>
        ) : (
          <table className="w-full table-fixed border-collapse text-left text-[10px]">
            <thead className="sticky top-0 z-10 bg-surface-1 text-[9px] uppercase tracking-wider text-text-4">
              <tr>
                <th className="w-[104px] px-2 py-1 font-medium">Status</th>
                <th className="w-[128px] px-2 py-1 font-medium">Correlation</th>
                <th className="w-[170px] px-2 py-1 font-medium">Operation / route</th>
                <th className="w-[64px] px-2 py-1 font-medium">HTTP</th>
                <th className="w-[70px] px-2 py-1 font-medium">Duration</th>
                <th className="w-[150px] px-2 py-1 font-medium">Downstream</th>
                <th className="px-2 py-1 font-medium">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {analysis.requests.map((request) => (
                <tr
                  key={`${request.correlationId}-${request.requestId}`}
                  tabIndex={0}
                  role="button"
                  onClick={() => onFilterRequest(request)}
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onFilterRequest(request) } }}
                  title="Filter events for this request"
                  className="cursor-pointer border-t border-border-1 font-mono text-text-2 outline-none hover:bg-surface-2/70 focus-visible:bg-accent/10"
                >
                  <td className="px-2 py-1">
                    <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-sans text-[9px]', statusStyle(request.status))}>
                      <StatusIcon status={request.status} /> {STATUS_LABEL[request.status]}
                    </span>
                  </td>
                  <td className="truncate px-2 py-1" title={request.correlationId || request.requestId}>{request.correlationId || request.requestId}</td>
                  <td className="truncate px-2 py-1" title={request.endpoint || request.operation}>{request.operation || request.endpoint || 'n/d'}</td>
                  <td className="px-2 py-1">{request.method || ''} {request.httpStatus ?? 'n/d'}</td>
                  <td className="px-2 py-1">{duration(request.durationMs)}</td>
                  <td className="truncate px-2 py-1" title={request.downstreams.join(', ')}>{request.downstreams.join(', ') || 'n/d'}</td>
                  <td className={cn('truncate px-2 py-1', request.status === 'timeout' || request.status === 'server-error' ? 'text-error' : 'text-text-3')} title={request.error}>
                    {request.error || `${request.eventCount} events`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {analysis.anomalies.length > 0 && (
          <div className="border-t border-border-1 px-3 py-1.5">
            {analysis.anomalies.slice(0, 5).map((anomaly, index) => (
              <p key={`${anomaly.correlationId}-${anomaly.kind}-${index}`} className={cn('truncate py-0.5 text-[10px]', anomaly.severity === 'error' ? 'text-error' : 'text-warning')} title={`${anomaly.evidence} ${anomaly.action}`}>
                {anomaly.title}: <span className="text-text-3">{anomaly.evidence}. {anomaly.action}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function Metric({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'error' | 'warning' }) {
  return (
    <span className={cn(
      'rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[9px] text-text-3',
      tone === 'error' && 'bg-error/10 text-error',
      tone === 'warning' && 'bg-warning/10 text-warning',
    )}>
      {value} {label}
    </span>
  )
}
