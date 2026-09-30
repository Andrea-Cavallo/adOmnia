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

/** Best route of the known Go projects for a request: exact method first, then the most literal pattern. */
export function findRoute(snapshots: Record<string, DevSnapshot>, method: string, resolvedUrl: string, preferGoSessionId?: string): RouteMatch | null {
  const pathname = requestPath(resolvedUrl)
  if (!pathname) return null
  let best: { match: RouteMatch; score: number } | null = null
  for (const [goSessionId, snapshot] of Object.entries(snapshots)) {
    for (const route of snapshot.entities ?? []) {
      if (route.kind !== 'route') continue
      const routeMethod = (route.attrs.method ?? 'ANY').toUpperCase()
      if (routeMethod !== 'ANY' && routeMethod !== method.toUpperCase()) continue
      if (!routeMatches(route.attrs.path ?? '', pathname)) continue
      const score = (routeMethod === 'ANY' ? 0 : 1000) + literalSegments(route.attrs.path ?? '') * 10 + (goSessionId === preferGoSessionId ? 5 : 0)
      if (best && best.score >= score) continue
      const declared = !!route.attrs.declFile
      best = {
        score,
        match: {
          goSessionId, route,
          file: declared ? route.attrs.declFile : route.attrs.handlerFile ?? route.sources[0]?.file ?? '',
          line: Number(declared ? route.attrs.declLine : route.attrs.handlerLine) || route.sources[0]?.line || 1,
          name: route.attrs.declName || route.attrs.handler || route.label,
        },
      }
    }
  }
  return best?.match ?? null
}

/** Routes whose handler is declared at a file line: the Code → API direction. */
export function routesForHandler(snapshot: DevSnapshot | undefined, file: string, line: number): DevEntity[] {
  return (snapshot?.entities ?? []).filter((e) => e.kind === 'route' && e.attrs.declFile === file && Number(e.attrs.declLine) === line)
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
