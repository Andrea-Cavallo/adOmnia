import type { DevEntity, DevSnapshot } from '@/lib/devcontext-api'

export interface RouteMatch {
  goSessionId: string
  route: DevEntity
  /** Handler declaration (func UpdateUser), falling back to the registration line. */
  file: string
  line: number
  name: string
}

/** `/users/{id}` matches `/users/123`; `{rest...}` matches the remaining segments. */
export function routeMatches(pattern: string, pathname: string): boolean {
  const want = pattern.split('/').filter(Boolean)
  const got = pathname.split('/').filter(Boolean)
  for (let i = 0; i < want.length; i++) {
    const segment = want[i]
    if (/^\{[^}]*\.\.\.\}$/.test(segment) || segment === '*') return true
    if (i >= got.length) return false
    if (/^\{[^}]+\}$/.test(segment)) continue
    if (segment !== decodeURIComponent(got[i])) return false
  }
  return want.length === got.length
}

const literalSegments = (pattern: string) => pattern.split('/').filter((s) => s && !s.startsWith('{')).length

/** Path of a resolved request URL, or null when it cannot be parsed. */
export function requestPath(resolvedUrl: string): string | null {
  try {
    return new URL(resolvedUrl).pathname
  } catch {
    const match = /^(?:[a-z]+:\/\/[^/]+)?(\/[^?#]*)/i.exec(resolvedUrl)
    return match ? match[1] : null
  }
}

/** A matched route plus what is needed to choose between projects. */
export interface RouteCandidate extends RouteMatch {
  score: number
  projectName: string
  projectRoot: string
}

export interface RouteQuery {
  /** Hard scope: only this Code Studio session is searched (never links across projects). */
  sessionId?: string
  /** Soft preference: ties and near-ties resolve to this session first. */
  preferGoSessionId?: string
}

function asCandidate(goSessionId: string, snapshot: DevSnapshot, route: DevEntity, score: number): RouteCandidate {
  const declared = !!route.attrs.declFile
  return {
    score,
    goSessionId,
    route,
    projectName: snapshot.root.split(/[\\/]/).filter(Boolean).pop() ?? goSessionId,
    projectRoot: snapshot.root,
    file: declared ? route.attrs.declFile : route.attrs.handlerFile ?? route.sources[0]?.file ?? '',
    line: Number(declared ? route.attrs.declLine : route.attrs.handlerLine) || route.sources[0]?.line || 1,
    name: route.attrs.declName || route.attrs.handler || route.label,
  }
}

/**
 * Every route of the known projects that serves a request, best first: exact
 * method before ANY, then the most literal pattern, then the preferred project.
 * Callers get the whole list so several projects can never be linked silently.
 */
export function findRouteCandidates(snapshots: Record<string, DevSnapshot>, method: string, resolvedUrl: string, query: RouteQuery = {}): RouteCandidate[] {
  const pathname = requestPath(resolvedUrl)
  if (!pathname) return []
  const wantMethod = method.toUpperCase()
  const candidates: RouteCandidate[] = []
  for (const [goSessionId, snapshot] of Object.entries(snapshots)) {
    if (query.sessionId && goSessionId !== query.sessionId) continue
    for (const route of snapshot.entities ?? []) {
      if (route.kind !== 'route') continue
      const routeMethod = (route.attrs.method ?? 'ANY').toUpperCase()
      if (routeMethod !== 'ANY' && routeMethod !== wantMethod) continue
      if (!routeMatches(route.attrs.path ?? '', pathname)) continue
      const score = (routeMethod === 'ANY' ? 0 : 1000) + literalSegments(route.attrs.path ?? '') * 10 + (goSessionId === query.preferGoSessionId ? 5 : 0)
      candidates.push(asCandidate(goSessionId, snapshot, route, score))
    }
  }
  return candidates.sort((a, b) => b.score - a.score || a.projectName.localeCompare(b.projectName) || a.route.id.localeCompare(b.route.id))
}

/** Best route of the known projects for a request: exact method first, then the most literal pattern. */
export function findRoute(snapshots: Record<string, DevSnapshot>, method: string, resolvedUrl: string, preferGoSessionId?: string): RouteMatch | null {
  return findRouteCandidates(snapshots, method, resolvedUrl, { preferGoSessionId })[0] ?? null
}

/** Routes whose handler is declared at a file line: the Code → API direction. */
export function routesForHandler(snapshot: DevSnapshot | undefined, file: string, line: number): DevEntity[] {
  return (snapshot?.entities ?? []).filter((e) => e.kind === 'route' && e.attrs.declFile === file && Number(e.attrs.declLine) === line)
}

/**
 * Routes that belong to a source location, trying the handler declaration first
 * and then the registration line: Go entities expose `handlerFile`/`handlerLine`
 * for frameworks whose call shape is known but whose declaration is elsewhere.
 */
export function routesAtLocation(snapshot: DevSnapshot | undefined, file: string, line: number): DevEntity[] {
  const declared = routesForHandler(snapshot, file, line)
  if (declared.length > 0) return declared
  return (snapshot?.entities ?? []).filter((e) => e.kind === 'route'
    && ((e.attrs.handlerFile === file && Number(e.attrs.handlerLine) === line)
      || (e.sources ?? []).some((s) => s.file === file && s.line === line)))
}

/** `{id}` of `/users/{id}` → `123` of `/users/123`. */
export function pathParams(pattern: string, pathname: string): Record<string, string> {
  const want = pattern.split('/').filter(Boolean)
  const got = pathname.split('/').filter(Boolean)
  const params: Record<string, string> = {}
  want.forEach((segment, index) => {
    const name = /^\{([^}.]+)(\.\.\.)?\}$/.exec(segment)
    if (!name) return
    params[name[1]] = name[2] ? got.slice(index).map(decodeURIComponent).join('/') : decodeURIComponent(got[index] ?? '')
  })
  return params
}
