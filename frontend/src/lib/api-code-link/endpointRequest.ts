import type { DevEntity } from '@/lib/devcontext-api'
import { httpMethodForRoute, requestUrlForRoute } from '@/lib/entities/routeRequest'
import { blankBody, blankKVRow, blankRequest, uid, type KVRow, type RequestBody, type RequestItem } from '@/lib/types'

export interface EndpointParam {
  name: string
  in: 'path' | 'query' | 'header' | 'cookie' | 'form'
  type?: string
  required?: boolean
  default?: string
}

export interface EndpointRequestShape {
  params: EndpointParam[]
  body?: string
  contentType?: string
}

function stringArray(value: unknown): EndpointParam[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name : ''
    const where = record.in
    if (!name || (where !== 'path' && where !== 'query' && where !== 'header' && where !== 'cookie' && where !== 'form')) return []
    return [{
      name,
      in: where,
      type: typeof record.type === 'string' ? record.type : undefined,
      required: record.required === true,
      default: typeof record.default === 'string' ? record.default : undefined,
    }]
  })
}

/** Request shape discovered from the handler (language adapters write these attrs). */
export function endpointRequestShape(route: Pick<DevEntity, 'attrs'>): EndpointRequestShape {
  const attrs = route.attrs ?? {}
  let params: EndpointParam[] = []
  if (attrs.requestParams) {
    try {
      params = stringArray(JSON.parse(attrs.requestParams))
    } catch {
      params = []
    }
  }
  return { params, body: attrs.requestBody || undefined, contentType: attrs.requestContentType || undefined }
}

const PATH_PARAM = /\{([A-Za-z_]\w*)(?:\.\.\.)?\}/g

/** Path parameters of a route pattern, when the handler does not declare them. */
export function pathParamsFromPattern(path: string): EndpointParam[] {
  return [...path.matchAll(PATH_PARAM)].map((match) => ({ name: match[1], in: 'path' as const, type: 'string', required: true }))
}

function row(key: string, value = ''): KVRow {
  return { ...blankKVRow(), id: uid(), key, value }
}

function requestBodyFor(shape: EndpointRequestShape): RequestBody | null {
  if (!shape.body) return null
  const contentType = (shape.contentType ?? '').toLowerCase()
  const lang = contentType.includes('xml') ? 'xml' : contentType.includes('html') ? 'html' : contentType.includes('json') || shape.body.trim().startsWith('{') || shape.body.trim().startsWith('[') ? 'json' : 'text'
  return { ...blankBody('Body 1'), type: 'raw', lang, raw: shape.body }
}

/**
 * Builds the API request for a discovered endpoint: path and query values,
 * headers and body come from the handler signature/annotations. Unsaved
 * collections and live runs then behave exactly like a hand-written request.
 */
export function requestForEndpoint(route: Pick<DevEntity, 'attrs' | 'label'>, source = 'Code Studio'): RequestItem {
  const method = httpMethodForRoute(route.attrs.method === 'ANY' ? 'GET' : route.attrs.method ?? 'GET')
  const path = route.attrs.path ?? '/'
  const shape = endpointRequestShape(route)
  const declaredPaths = shape.params.filter((param) => param.in === 'path')
  const pathParams = (declaredPaths.length > 0 ? declaredPaths : pathParamsFromPattern(path))
    .map((param) => row(param.name, param.default ?? ''))
  const query = shape.params.filter((param) => param.in === 'query').map((param) => row(param.name, param.default ?? ''))
  const headers = shape.params.filter((param) => param.in === 'header').map((param) => row(param.name, param.default ?? ''))
  const contentType = shape.body && shape.contentType ? [row('Content-Type', shape.contentType)] : []
  const cookies = shape.params.filter((param) => param.in === 'cookie').map((param) => row(param.name, param.default ?? ''))
  const form = shape.params.filter((param) => param.in === 'form').map((param) => row(param.name, param.default ?? ''))
  const declaredBody = requestBodyFor(shape)
  const body = declaredBody ?? (form.length > 0 ? { ...blankBody('Body 1'), type: 'urlencoded' as const, form: [...form, blankKVRow()] } : null)
  const base = blankRequest(method, route.attrs.declName || route.label)
  return {
    ...base,
    description: `${route.attrs.declName || route.label} · ${source}`,
    url: requestUrlForRoute(path),
    params: query.length > 0 ? [...query, blankKVRow()] : base.params,
    pathParams: pathParams.length > 0 ? pathParams : undefined,
    headers: headers.length > 0 || contentType.length > 0 ? [...contentType, ...headers, blankKVRow()] : base.headers,
    cookies: cookies.length > 0 ? [...cookies, blankKVRow()] : base.cookies,
    bodies: body ? [body] : base.bodies,
    activeBodyIdx: 0,
  }
}
