import { StorageGet, StoragePut } from '@/wailsjs/go/main/App'
import { uid, type RequestItem, type ResponseData } from '@/lib/types'

const REST_METHODS = new Set(['GET', 'QUERY', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])

export interface StoredMockResponse {
  id: string
  name: string
  status: number
  headers: Record<string, string>
  body: string
  delayMs: number
  isActive: boolean
}

export interface StoredMockEndpoint {
  id: string
  path: string
  method: string
  description: string
  /** Source context lets the Mock Control Room focus an endpoint launched from a request tab. */
  sourceCollectionId?: string
  sourceRequestId?: string
  responses: StoredMockResponse[]
  mode: string
  enabled: boolean
}

export interface GeneratedMockEndpoint {
  path: string
  method: string
  statusCode: number
  headers?: Record<string, string>
  body?: string
  delayMs?: number
}

/** Convert provider output into the same reviewed, persisted shape used by the Mock UI. */
export function generatedMockEndpointsToStored(value: unknown): StoredMockEndpoint[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const candidate = item as Partial<GeneratedMockEndpoint>
    const method = typeof candidate.method === 'string' ? candidate.method.trim().toUpperCase() : ''
    const rawPath = typeof candidate.path === 'string' ? candidate.path.trim() : ''
    if (!REST_METHODS.has(method) || !rawPath) return []
    const path = rawPath.startsWith('/') ? rawPath.slice(0, 2_048) : `/${rawPath.slice(0, 2_047)}`
    const status = Number.isInteger(candidate.statusCode) && Number(candidate.statusCode) >= 100 && Number(candidate.statusCode) <= 599
      ? Number(candidate.statusCode)
      : method === 'POST' ? 201 : 200
    const headers = candidate.headers && typeof candidate.headers === 'object'
      ? Object.fromEntries(Object.entries(candidate.headers).filter(([key, headerValue]) => key && typeof headerValue === 'string').slice(0, 64))
      : { 'Content-Type': 'application/json' }
    const body = typeof candidate.body === 'string' ? candidate.body.slice(0, 1_000_000) : '{}'
    const delayMs = Number.isFinite(candidate.delayMs) ? Math.max(0, Math.min(60_000, Number(candidate.delayMs))) : 0
    return [{
      id: uid(),
      path,
      method,
      description: `Generated: ${method} ${path}`,
      responses: [{
        id: uid(),
        name: 'AI Response',
        status,
        headers,
        body,
        delayMs,
        isActive: true,
      }],
      mode: 'first_active',
      enabled: true,
    }]
  }).slice(0, 50)
}

function normalizeMockPath(rawUrl: string): string {
  const withoutVars = rawUrl
    .replace(/\{\{\s*base_url\s*\}\}/gi, '')
    .replace(/\{\{\s*mockApiBase\s*\}\}/gi, '')
    .replace(/\{\{[^}]+\}\}/g, ':param')
  try {
    const parsed = new URL(withoutVars.startsWith('http') ? withoutVars : `http://local${withoutVars.startsWith('/') ? '' : '/'}${withoutVars}`)
    return parsed.pathname || '/'
  } catch {
    const trimmed = withoutVars.split('?')[0].trim()
    return trimmed.startsWith('/') ? trimmed : `/${trimmed || 'api/example'}`
  }
}

function responseBodyFor(method: string, path: string): string {
  const payload =
    method === 'DELETE' ? { deleted: true, path }
    : method === 'QUERY' ? { ok: true, path, query: 'processed', results: [] }
    : method === 'POST' ? { id: 'mock_1001', created: true, path }
    : method === 'PUT' || method === 'PATCH' ? { updated: true, path }
    : { ok: true, path, items: [{ id: 'demo_1', name: 'Demo item' }] }
  return JSON.stringify(payload, null, 2)
}

function responseStatusFor(method: string, response?: ResponseData | null): number {
  if (response?.status) return response.status
  if (method === 'POST') return 201
  if (method === 'DELETE') return 204
  return 200
}

export function createMockEndpointFromRequest(
  request: RequestItem,
  response?: ResponseData | null,
): StoredMockEndpoint | null {
  if (!REST_METHODS.has(request.method)) return null
  const path = normalizeMockPath(request._openapiPath || request.url || `/${request.name.toLowerCase().replace(/\s+/g, '-')}`)
  const status = responseStatusFor(request.method, response)
  const headers = response?.headers && Object.keys(response.headers).length > 0
    ? response.headers
    : { 'Content-Type': 'application/json' }
  return {
    id: uid(),
    path,
    method: request.method,
    description: request.name || `${request.method} ${path}`,
    responses: [{
      id: uid(),
      name: response ? `Captured ${status}` : `${request.method} ${path} JSON`,
      status,
      headers,
      body: response?.body || responseBodyFor(request.method, path),
      delayMs: 0,
      isActive: true,
    }],
    mode: 'first_active',
    enabled: true,
  }
}

export async function appendMockEndpoints(endpoints: unknown[]): Promise<void> {
  const raw = await StorageGet('mock', 'endpoints').catch(() => '')
  let existing: unknown[] = []
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) existing = parsed
    } catch {
      existing = []
    }
  }
  await StoragePut('mock', 'endpoints', JSON.stringify([...existing, ...endpoints]))
  document.dispatchEvent(new CustomEvent('adomnia:mock-endpoints-updated'))
}
