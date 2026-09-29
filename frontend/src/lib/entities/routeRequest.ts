import type { EnvVariable, HttpMethod } from '@/lib/types'

const ROUTE_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE', 'QUERY']

export function httpMethodForRoute(method: string): HttpMethod {
  const upper = method.toUpperCase() as HttpMethod
  return ROUTE_METHODS.includes(upper) ? upper : 'GET'
}

/** `/payments/{id}` → `{{baseUrl}}/payments/{{id}}` (Go `{path...}` wildcards too). */
export function requestUrlForRoute(path: string): string {
  return `{{baseUrl}}${path.replace(/\{([A-Za-z_]\w*)(?:\.\.\.)?\}/g, '{{$1}}')}`
}

/** Mock Server matches `:param` segments. */
export function mockPathForRoute(path: string): string {
  return path.replace(/\{([A-Za-z_]\w*)(?:\.\.\.)?\}/g, ':$1')
}

export function withBaseUrl(variables: EnvVariable[], url: string): EnvVariable[] {
  if (variables.some((v) => v.key === 'baseUrl')) {
    return variables.map((v) => (v.key === 'baseUrl' ? { ...v, value: url, enabled: true } : v))
  }
  return [...variables, { id: crypto.randomUUID(), key: 'baseUrl', value: url, enabled: true }]
}
