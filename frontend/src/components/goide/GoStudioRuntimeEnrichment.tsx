import { goModules } from '@/lib/goide/goProject'
import { useEffect, useRef, useState } from 'react'
import { Activity, Loader2, RefreshCw, X } from 'lucide-react'
import { getRuntimeEnrichment, type RuntimeEnrichment } from '@/lib/devsession-api'
import type { GoIDESession } from '@/lib/goide-api'
import { useModalFocusTrap } from '@/lib/accessibility'

interface GoStudioRuntimeEnrichmentProps {
  open: boolean
  session: GoIDESession
  onClose: () => void
}

const KIND_LABEL: Record<string, string> = { route: 'route', file: 'file', datasource: 'datasource', topic: 'topic' }
const EDGE_LABEL: Record<string, string> = { hit: 'breakpoint hit', query: 'query', message: 'message' }

export function GoStudioRuntimeEnrichment({ open, session, onClose }: GoStudioRuntimeEnrichmentProps) {
  const [moduleDirectory, setModuleDirectory] = useState(goModules(session.project)[0]?.path ?? '')
  const [report, setReport] = useState<RuntimeEnrichment | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalFocusTrap(open, onClose, dialogRef)

  const load = async (directory = moduleDirectory) => {
    if (!directory) return
    setLoading(true)
    setError(null)
    try {
      setReport(await getRuntimeEnrichment(session.id, directory))
    } catch (reason) {
      setError(String(reason))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    const directory = goModules(session.project)[0]?.path ?? ''
    setModuleDirectory(directory)
    setReport(null)
    if (directory) void load(directory)
  }, [open, session.id])

  if (!open) return null

  const components = report?.components ?? []
  const routes = components.filter((component) => component.kind === 'route')
  const others = components.filter((component) => component.kind !== 'route')
  const edges = report?.edges ?? []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center ad-modal-backdrop" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Runtime enrichment" tabIndex={-1} className="flex max-h-[82vh] w-[720px] flex-col overflow-hidden rounded-xl border border-border-2 bg-surface-1 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-10 shrink-0 items-center border-b border-border-1 px-4">
          <h2 className="text-xs font-semibold text-text-1">Runtime enrichment</h2>
          <span className="ml-2 text-[9px] text-text-4">live session telemetry on the static graph</span>
          <button type="button" onClick={onClose} className="ml-auto grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3"><X size={12} /></button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col p-4">
          {error && <div role="alert" className="mb-3 rounded border border-danger/30 bg-danger/10 p-2 text-[10px] text-danger">{error}</div>}
          <div className="mb-3 flex items-end gap-2">
            <label className="min-w-0 flex-1 text-[10px] text-text-3">Module
              <select value={moduleDirectory} onChange={(event) => { setModuleDirectory(event.target.value); void load(event.target.value) }} className="mt-1 h-8 w-full rounded border border-border-1 bg-surface-0 px-2 font-mono text-[10px] text-text-1">{goModules(session.project).map((module) => <option key={module.path} value={module.path}>{module.modulePath || module.path}</option>)}</select>
            </label>
            <button type="button" disabled={loading} onClick={() => void load()} className="grid h-8 w-8 place-items-center rounded border border-border-1 text-text-3 hover:border-accent disabled:opacity-40">{loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}</button>
          </div>

          {!report && !loading && (
            <div className="rounded border border-border-1 bg-surface-0 p-4 text-[11px] leading-5 text-text-3">
              <Activity size={14} className="mb-2 text-text-4" />
              <p className="m-0">Run or debug the service from Go Studio, then send it requests. The runtime view shows which components actually ran, how often, how slow, with what errors, the dynamic edges (request → file / query / topic) and the dependencies that never appeared.</p>
            </div>
          )}

          {report && report.totalRequests === 0 && (
            <div className="rounded border border-border-1 bg-surface-0 p-4 text-[11px] text-text-3">No requests reached this project's live service yet. Start it (Run / Debug) and send a request.</div>
          )}

          {report && report.totalRequests > 0 && (
            <>
              <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 rounded border border-border-1 bg-surface-0 px-3 py-2 text-[9px] text-text-4">
                <span>service <strong className="text-text-2">{report.service}</strong></span>
                <span><strong className="text-text-2">{report.totalRequests}</strong> requests</span>
                <span><strong className={report.totalErrors > 0 ? 'text-danger' : 'text-text-2'}>{report.totalErrors}</strong> errors</span>
              </div>

              <div className="mb-3 flex gap-2 text-[9px] font-semibold uppercase tracking-wide text-text-4">
                <span>Routes · call frequency · latency · errors</span>
              </div>
              <div className="mb-3 max-h-40 shrink-0 overflow-auto rounded border border-border-1 bg-surface-0">
                {routes.map((route) => (
                  <div key={route.key} className="flex items-center gap-2 border-b border-border-1 px-3 py-1.5 last:border-b-0">
                    <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-text-2">{route.key}</span>
                    <span className="shrink-0 text-[9px] text-text-4">{route.calls} calls</span>
                    {route.avgMs != null && <span className="shrink-0 text-[9px] text-text-4">avg {route.avgMs}ms · max {route.maxMs}ms</span>}
                    {route.errors != null && route.errors > 0 && <span className="shrink-0 rounded bg-danger/10 px-1 text-[9px] font-semibold text-danger">{route.errors} errors</span>}
                  </div>
                ))}
              </div>

              <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-text-4">Components used · integrations</div>
              <div className="mb-3 max-h-28 shrink-0 overflow-auto rounded border border-border-1 bg-surface-0">
                {others.map((component) => (
                  <div key={`${component.kind}:${component.key}`} className="flex items-center gap-2 border-b border-border-1 px-3 py-1 last:border-b-0">
                    <span className="shrink-0 rounded bg-surface-2 px-1 text-[8px] text-text-4">{KIND_LABEL[component.kind] ?? component.kind}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-text-2">{component.key}</span>
                  </div>
                ))}
              </div>

              {edges.length > 0 && (
                <>
                  <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-text-4">Dynamic edges</div>
                  <div className="mb-3 max-h-28 shrink-0 overflow-auto rounded border border-border-1 bg-surface-0">
                    {edges.map((edge) => (
                      <div key={`${edge.from}\u0000${edge.to}\u0000${edge.kind}`} className="flex items-center gap-2 border-b border-border-1 px-3 py-1 last:border-b-0">
                        <span className="min-w-0 truncate font-mono text-[9px] text-text-3">{edge.from}</span>
                        <span className="shrink-0 text-[8px] text-text-4">—{EDGE_LABEL[edge.kind] ?? edge.kind}→</span>
                        <span className="min-w-0 flex-1 truncate font-mono text-[9px] text-text-2">{edge.to}</span>
                        <span className="shrink-0 text-[8px] text-text-4">×{edge.count}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {report.unusedModules.length > 0 && (
                <>
                  <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-text-4">Dependencies with no runtime evidence</div>
                  <div className="max-h-24 shrink-0 overflow-auto rounded border border-warning/25 bg-warning/5 px-3 py-2">
                    {report.unusedModules.map((module) => <div key={module} className="truncate py-0.5 font-mono text-[9px] text-text-2">{module}</div>)}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
