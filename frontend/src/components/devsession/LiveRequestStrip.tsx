import { useEffect, useState } from 'react'
import { Code2, FileWarning, Link2 } from 'lucide-react'
import { documented, projectContract } from '@/lib/devsession/contractDrift'
import { substVars } from '@/lib/substVars'
import type { RequestItem } from '@/lib/types'
import { liveVars } from '@/lib/devsession/liveRequest'
import { openLocationInGoStudio } from '@/lib/devsession/navigation'
import { useRouteForRequest } from '@/lib/devsession/useRouteForRequest'
import { useDevSessionStore } from '@/stores/devSession'
import { linkedService, liveSessions, sessionForRequest, type ServiceTarget } from '@/stores/devSessionModel'
import { basename, LiveDot, LinkedDot } from './liveUi'

/** Replaces the origin of a URL with `{{service:name}}`, keeping path and query. */
export function linkUrlToService(url: string, service: string): string {
  const path = url.replace(/^\s*(?:\{\{[^}]+\}\}|[a-z]+:\/\/[^/?#]+)/i, '')
  return `{{service:${service}}}${path.startsWith('/') || path === '' ? path : `/${path}`}`
}

/**
 * Under the URL bar: which service the request talks to (Local run, Docker,
 * DEV…) and which Go handler serves it. Hidden when neither is known.
 */
export function LiveRequestStrip({ tabId: _tabId, request, vars, onChange }: { tabId: string; request: RequestItem; vars: Record<string, string>; onChange: (request: RequestItem) => void }) {
  const state = useDevSessionStore()
  const allVars = liveVars(vars)
  const resolved = substVars(request.url, allVars)
  const service = linkedService(request.url)
  const session = sessionForRequest(state, request.url, resolved)
  // Only Go users pay for route matching: it loads the Developer Context lazily.
  const goAware = state.order.length > 0 || Object.keys(state.prefs.knownServices).length > 0
  const matchable = goAware && (/^[a-z]+:\/\//i.test(resolved) || resolved.startsWith('/'))
  const route = useRouteForRequest(request.method, matchable ? resolved : '', session?.goSessionId)
  useEffect(() => {
    const onGoToHandler = () => {
      if (route) void openLocationInGoStudio(route.goSessionId, { function: route.name, relativePath: route.file, line: route.line })
    }
    document.addEventListener('adomnia:go-to-handler', onGoToHandler)
    return () => document.removeEventListener('adomnia:go-to-handler', onGoToHandler)
  }, [route])
  const drift = useContractDrift(route)
  if (!service && !session && !route) return null
  const target: ServiceTarget = service ? state.prefs.targets[service] ?? { kind: 'local' } : { kind: 'local' }
  const localSession = service ? liveSessions(state).find((s) => s.service === service) : null

  return (
    <div className="flex h-7 shrink-0 items-center gap-3 border-b border-border-1 bg-surface-1/60 px-3 text-[11px] text-text-3">
      {service ? (
        <label className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-4">Target</span>
          {localSession && target.kind === 'local' ? <LiveDot session={localSession} /> : <LinkedDot />}
          <select aria-label="Request target" value={target.kind === 'local' ? 'local' : target.url ?? ''}
            onChange={(event) => state.setTarget(service, event.target.value === 'local' ? { kind: 'local' } : { ...(state.prefs.targets[service] ?? { kind: 'remote' }), url: event.target.value })}
            className="h-5 rounded border-0 bg-transparent pr-1 text-[11px] font-medium text-text-1 outline-none focus:ring-1 focus:ring-accent">
            <option value="local">Local run — {service}{localSession?.port ? ` :${localSession.port}` : ' (not running)'}</option>
            {target.kind !== 'local' && target.url && <option value={target.url}>{target.kind === 'docker' ? 'Docker' : 'Remote'} — {target.url}</option>}
          </select>
          <button type="button" onClick={() => localSession && document.dispatchEvent(new CustomEvent('adomnia:live-logs', { detail: { sessionId: localSession.id } }))}
            disabled={!localSession} className="text-text-4 hover:text-text-2 disabled:opacity-40" title="Service view: targets, SQL capture, Kafka watch">service…</button>
        </label>
      ) : session ? (
        <span className="flex items-center gap-1.5">
          <LiveDot session={session} />
          <span className="text-text-2">{session.service}</span>
          <span className="font-mono">:{session.port}</span>
          <button type="button" onClick={() => onChange({ ...request, url: linkUrlToService(request.url, session.service) })}
            title={`Use {{service:${session.service}}}: the request follows the service when its port changes`}
            className="flex items-center gap-1 rounded px-1 text-text-4 hover:bg-surface-3 hover:text-accent">
            <Link2 size={11} />Link to service
          </button>
        </span>
      ) : null}
      {route && (
        <span className="ml-auto flex min-w-0 items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-4">Handler</span>
          <span className="truncate font-mono text-text-2">{route.name}</span>
          <span className="shrink-0 font-mono text-text-4">{basename(route.file)}:{route.line}</span>
          <button type="button" onClick={() => void openLocationInGoStudio(route.goSessionId, { function: route.name, relativePath: route.file, line: route.line })}
            className="flex shrink-0 items-center gap-1 rounded border border-border-2 px-1.5 py-px text-text-2 hover:border-accent hover:text-accent">
            <Code2 size={11} />Open handler
          </button>
          {drift && (
            <span title={`${route.route.label} is served by the code but missing from ${drift}`} className="flex shrink-0 items-center gap-1 text-warning">
              <FileWarning size={11} />not in {basename(drift)}
            </span>
          )}
        </span>
      )}
    </div>
  )
}

/** Contract drift: the route runs in the code but the service's OpenAPI does not document it. */
function useContractDrift(route: ReturnType<typeof useRouteForRequest>): string | null {
  const [missingFrom, setMissingFrom] = useState<string | null>(null)
  useEffect(() => {
    setMissingFrom(null)
    if (!route) return
    let cancelled = false
    void import('@/stores/devcontext').then(async ({ useDevContextStore }) => {
      const snapshot = useDevContextStore.getState().snapshots[route.goSessionId]
      const contract = snapshot ? await projectContract(snapshot) : null
      if (cancelled || !contract || contract.operations.size === 0) return
      if (!documented(contract.operations, route.route.attrs.method ?? 'ANY', route.route.attrs.path ?? '')) setMissingFrom(contract.file)
    })
    return () => { cancelled = true }
  }, [route])
  return missingFrom
}
