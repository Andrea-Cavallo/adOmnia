import type { DevEntity, DevSnapshot } from '@/lib/devcontext-api'
import type { RequestItem } from '@/lib/types'
import { substVars } from '@/lib/substVars'
import { requestPath, routeMatches, findRouteCandidates, routesAtLocation, type RouteCandidate } from '@/lib/devsession/routeMatch'
import type { ApiCodeLink, EndpointCandidate } from './types'

/** `/users/{{id}}` → `/users/1` when the URL is still a template. */
function withoutLeadingVariables(url: string): string {
  return url.replace(/^\{\{[^}]*\}\}/, '')
}

/** Path of a request URL, with `{{baseUrl}}`/`{{service:name}}` prefixes removed. */
export function requestPathname(url: string, vars: Record<string, string> = {}): string | null {
  const resolved = substVars(url, vars).trim()
  if (!resolved) return null
  return requestPath(resolved) ?? requestPath(withoutLeadingVariables(resolved))
}

/** Whether an API request already exercises a discovered route. */
export function requestMatchesRoute(request: Pick<RequestItem, 'method' | 'url'>, route: DevEntity, vars: Record<string, string> = {}): boolean {
  const method = (route.attrs.method ?? 'ANY').toUpperCase()
  if (method !== 'ANY' && request.method !== method) return false
  const path = requestPathname(request.url, vars)
  return !!path && routeMatches(route.attrs.path ?? '', path)
}

function candidateOf(snapshot: DevSnapshot, route: DevEntity, base: Omit<RouteCandidate, 'projectName' | 'projectRoot' | 'route' | 'goSessionId'> & { goSessionId: string }): EndpointCandidate {
  return {
    sessionId: base.goSessionId,
    projectName: snapshot.root.split(/[\\/]/).filter(Boolean).pop() ?? base.goSessionId,
    projectRoot: snapshot.root,
    route,
    method: (route.attrs.method ?? 'ANY').toUpperCase(),
    path: route.attrs.path ?? '/',
    file: base.file,
    line: base.line,
    handler: base.name,
    score: base.score,
  }
}

/** Routes serving a request, best first, across the open projects (or just one). */
export function endpointCandidatesForRequest(
  snapshots: Record<string, DevSnapshot>,
  method: string,
  url: string,
  vars: Record<string, string> = {},
  options: { sessionId?: string; preferSessionId?: string } = {},
): EndpointCandidate[] {
  const path = requestPathname(url, vars)
  if (!path) return []
  return findRouteCandidates(snapshots, method, `http://link.local${path}`, { sessionId: options.sessionId, preferGoSessionId: options.preferSessionId })
    .map((candidate) => candidateOf(snapshots[candidate.goSessionId], candidate.route, candidate))
}

/** Endpoints implemented by a handler or route registration at a source location. */
export function endpointCandidatesForHandler(
  snapshots: Record<string, DevSnapshot>,
  sessionId: string,
  file: string,
  line: number,
): EndpointCandidate[] {
  const snapshot = snapshots[sessionId]
  if (!snapshot) return []
  return routesAtLocation(snapshot, file, line).map((route) => {
    const declared = !!route.attrs.declFile
    return candidateOf(snapshot, route, {
      goSessionId: sessionId,
      score: 0,
      file: declared ? route.attrs.declFile : route.attrs.handlerFile ?? file,
      line: Number(declared ? route.attrs.declLine : route.attrs.handlerLine) || line,
      name: route.attrs.declName || route.attrs.handler || route.label,
    })
  })
}

/** Link for a route entity, using its declaration (or registration) as the code side. */
export function linkFromRoute(sessionId: string, route: DevEntity, requestTabId?: string): ApiCodeLink {
  const declared = !!route.attrs.declFile
  return {
    sessionId,
    routeId: route.id,
    method: (route.attrs.method ?? 'ANY').toUpperCase(),
    path: route.attrs.path ?? '/',
    file: declared ? route.attrs.declFile : route.attrs.handlerFile ?? route.sources[0]?.file ?? '',
    line: Number(declared ? route.attrs.declLine : route.attrs.handlerLine) || route.sources[0]?.line || 1,
    handler: route.attrs.declName || route.attrs.handler || route.label,
    requestTabId,
    origin: 'code',
    createdAt: Date.now(),
  }
}

export function linkFromCandidate(candidate: EndpointCandidate, origin: ApiCodeLink['origin'], requestTabId?: string): ApiCodeLink {
  return {
    sessionId: candidate.sessionId,
    routeId: candidate.route.id,
    method: candidate.method,
    path: candidate.path,
    file: candidate.file,
    line: candidate.line,
    handler: candidate.handler,
    requestTabId,
    origin,
    createdAt: Date.now(),
  }
}

/** The project label shown when two projects expose the same endpoint. */
export function candidateLabel(candidate: EndpointCandidate): string {
  return `${candidate.method} ${candidate.path} · ${candidate.projectName}`
}

export function findRouteInSnapshot(snapshot: DevSnapshot | undefined, routeId: string): DevEntity | null {
  return (snapshot?.entities ?? []).find((entity) => entity.kind === 'route' && entity.id === routeId) ?? null
}
