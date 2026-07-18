import type { Collection, Environment, HttpMethod, RequestItem, TreeNode } from '@/lib/types'
import { blankRequest, uid } from '@/lib/types'
import { applyParsedCurl, parseCurl } from '@/lib/parseCurl'
import { importCollectionsFromText } from '@/lib/collectionTransfer'
import { openApiToCollection } from '@/lib/openapiImport'

export type InteropFormat =
  | 'adomnia'
  | 'postman'
  | 'insomnia'
  | 'bruno'
  | 'hoppscotch'
  | 'openapi'
  | 'swagger'
  | 'swagger2'
  | 'wsdl'
  | 'graphql'
  | 'grpc'
  | 'har'
  | 'curl'
  | 'http'
  | 'env'
  | 'wiremock'
  | 'mockoon'
  | 'unknown'

export interface InteropBundle {
  format: InteropFormat
  label: string
  collections: Collection[]
  environments: Environment[]
  artifacts: Array<{ type: 'mock' | 'proxy' | 'test-scenario' | 'raw'; name: string; data: unknown }>
  warnings: string[]
  secretsDetected: string[]
  sourceName?: string
}

const SECRET_KEY = /(authorization|token|secret|password|passwd|apikey|api_key|client_secret|cookie|set-cookie|private[_-]?key)/i

function kv(key = '', value = '') {
  return { id: uid(), key, value, enabled: true }
}

function method(value: unknown): HttpMethod {
  const upper = String(value || 'GET').toUpperCase()
  return ['GET', 'QUERY', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE', 'WS', 'SOAP'].includes(upper) ? upper as HttpMethod : 'GET'
}

function request(name: string, reqMethod: HttpMethod, url: string): RequestItem {
  return { ...blankRequest(reqMethod, name || `${reqMethod} ${url || 'Request'}`), url }
}

function collection(name: string, children: TreeNode[]): Collection {
  return { id: uid(), name, children }
}

function tryJson(text: string): unknown | null {
  try { return JSON.parse(text) } catch { return null }
}

function detectInteropFormat(filename: string, text: string): InteropFormat {
  const lower = filename.toLowerCase()
  const trimmed = text.trim()
  const json = tryJson(trimmed) as Record<string, unknown> | null
  if (trimmed.startsWith('curl ')) return 'curl'
  if (lower.endsWith('.env')) return 'env'
  if (lower.endsWith('.http') || lower.endsWith('.rest')) return 'http'
  if (lower.endsWith('.graphql') || lower.endsWith('.gql')) return 'graphql'
  if (lower.endsWith('.proto')) return 'grpc'
  if (trimmed.includes('<definitions') || trimmed.includes('<wsdl:definitions')) return 'wsdl'
  if (json) {
    if ((json as any).log?.entries) return 'har'
    if ((json as any).info?.schema?.includes?.('postman')) return 'postman'
    if ((json as any)._type === 'export' || Array.isArray((json as any).resources)) return 'insomnia'
    if ((json as any).openapi) return 'openapi'
    if ((json as any).swagger) return 'swagger'
    if ((json as any).format?.startsWith?.('adomnia') || Array.isArray((json as any).collections)) return 'adomnia'
    if (Array.isArray((json as any).mappings) || (json as any).request && (json as any).response) return 'wiremock'
    if ((json as any).routes && Array.isArray((json as any).routes)) return 'mockoon'
    if ((json as any).v && ((json as any).collections || (json as any).requests)) return 'hoppscotch'
    if ((json as any).collection?.name || Array.isArray((json as any).items)) return 'bruno'
  }
  if (/^query\s|^mutation\s|^subscription\s|fragment\s/m.test(trimmed)) return 'graphql'
  if (/^(GET|QUERY|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\S+/m.test(trimmed)) return 'http'
  return 'unknown'
}

export function parseInteropFile(filename: string, text: string): InteropBundle {
  const format = detectInteropFormat(filename, text)
  const base: InteropBundle = { format, label: filename, collections: [], environments: [], artifacts: [], warnings: [], secretsDetected: findSecrets(text), sourceName: filename }

  if (format === 'postman' || format === 'insomnia' || format === 'bruno' || format === 'adomnia' || format === 'openapi' || format === 'swagger') {
    const imported = format === 'swagger'
      ? { collections: [openApiToCollection(text)], format: 'openapi' as const, warnings: ['Swagger/OpenAPI 2.0 import is normalized to adOmnia HTTP requests.'] }
      : importCollectionsFromText(text, format as any)
    return { ...base, format: format === 'swagger' ? 'swagger' : imported.format, collections: imported.collections, warnings: imported.warnings }
  }
  if (format === 'curl') return { ...base, collections: [parseCurlCollection(text)] }
  if (format === 'http') return { ...base, collections: [parseHttpCollection(filename, text)] }
  if (format === 'env') return { ...base, environments: [parseEnv(filename, text)] }
  if (format === 'har') return { ...base, collections: [parseHarCollection(filename, text)], artifacts: [{ type: 'raw', name: filename, data: tryJson(text) ?? text }] }
  if (format === 'graphql') return { ...base, collections: [parseGraphqlCollection(filename, text)] }
  if (format === 'grpc') return { ...base, collections: [parseGrpcCollection(filename, text)], artifacts: [{ type: 'raw', name: filename, data: text }] }
  if (format === 'wsdl') return { ...base, collections: [parseWsdlCollection(filename, text)], artifacts: [{ type: 'raw', name: filename, data: text }] }
  if (format === 'wiremock') return parseWireMock(filename, text, base)
  if (format === 'mockoon') return parseMockoon(filename, text, base)
  if (format === 'hoppscotch') return parseHoppscotch(filename, text, base)
  throw new Error('Unsupported or unrecognized import format. Select a supported file or paste a known developer artifact.')
}

function parseCurlCollection(text: string): Collection {
  const parsed = parseCurl(text)
  if (!parsed) throw new Error('Invalid cURL command.')
  return collection('Imported cURL', [applyParsedCurl(parsed, blankRequest(parsed.method, 'cURL Request'))])
}

function parseHttpCollection(filename: string, text: string): Collection {
  const requests = text.split(/\n\s*###.*\n/g).map((block, index) => {
    const lines = block.trim().split(/\r?\n/)
    const first = lines.findIndex((line) => /^(GET|QUERY|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\S+/i.test(line.trim()))
    if (first < 0) return null
    const [m, ...urlParts] = lines[first].trim().split(/\s+/)
    const req = request(`HTTP ${index + 1}`, method(m), urlParts.join(' '))
    const blank = lines.findIndex((line, i) => i > first && line.trim() === '')
    const headerEnd = blank > first ? blank : lines.length
    req.headers = lines.slice(first + 1, headerEnd).map((line) => {
      const colon = line.indexOf(':')
      return colon > 0 ? kv(line.slice(0, colon).trim(), line.slice(colon + 1).trim()) : null
    }).filter(Boolean) as ReturnType<typeof kv>[]
    if (!req.headers.length) req.headers = [kv()]
    const body = blank > first ? lines.slice(blank + 1).join('\n').trim() : ''
    if (body) req.bodies = [{ ...req.bodies[0], type: 'raw', raw: body, lang: body.trim().startsWith('<') ? 'xml' : 'json' }]
    return req
  }).filter(Boolean) as RequestItem[]
  if (!requests.length) throw new Error('No HTTP requests found in .http file.')
  return collection(filename.replace(/\.(http|rest)$/i, ''), requests)
}

function parseEnv(filename: string, text: string): Environment {
  const variables = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#')).map((line) => {
    const idx = line.indexOf('=')
    const key = idx >= 0 ? line.slice(0, idx).trim() : line
    const value = idx >= 0 ? line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '') : ''
    return { id: uid(), key, value, enabled: true, type: SECRET_KEY.test(key) ? 'secret' as const : 'text' as const }
  })
  return { id: uid(), name: filename.replace(/\.env$/i, '') || 'Imported env', variables }
}

function parseHarCollection(filename: string, text: string): Collection {
  const har = JSON.parse(text)
  const entries = har.log?.entries ?? []
  const requests = entries.map((entry: any, index: number) => {
    const req = request(entry.request?.url ? `${entry.request.method || 'GET'} ${new URL(entry.request.url).pathname || '/'}` : `HAR Request ${index + 1}`, method(entry.request?.method), entry.request?.url || '')
    req.headers = Array.isArray(entry.request?.headers) && entry.request.headers.length ? entry.request.headers.map((h: any) => kv(h.name, h.value)) : [kv()]
    if (entry.request?.postData?.text) req.bodies = [{ ...req.bodies[0], type: 'raw', raw: entry.request.postData.text, lang: entry.request.postData.mimeType?.includes('xml') ? 'xml' : 'json' }]
    return req
  })
  return collection(filename.replace(/\.har$/i, ''), requests)
}

function parseGraphqlCollection(filename: string, text: string): Collection {
  const req = request(filename.replace(/\.(graphql|gql)$/i, '') || 'GraphQL Operation', 'POST', '')
  req.bodies = [{ ...req.bodies[0], type: 'graphql', raw: text, graphqlVariables: '{}' }]
  req.headers = [kv('Content-Type', 'application/json')]
  return collection('GraphQL Import', [req])
}

function parseGrpcCollection(filename: string, text: string): Collection {
  const services = Array.from(text.matchAll(/service\s+(\w+)/g)).map((match) => match[1])
  const children = (services.length ? services : [filename.replace(/\.proto$/i, '')]).map((name) => request(`gRPC ${name}`, 'POST', `grpc://localhost:50051/${name}`))
  return collection('gRPC Import', children)
}

function parseWsdlCollection(filename: string, text: string): Collection {
  const ops = Array.from(text.matchAll(/(?:wsdl:)?operation\s+name=["']([^"']+)["']/g)).map((match) => match[1])
  const children = (ops.length ? ops : ['SOAP Operation']).map((name) => {
    const req = request(name, 'SOAP', '')
    req.headers = [kv('Content-Type', 'text/xml; charset=utf-8'), kv('SOAPAction', name)]
    req.bodies = [{ ...req.bodies[0], type: 'raw', lang: 'xml', raw: '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">\n  <soap:Body />\n</soap:Envelope>' }]
    return req
  })
  return collection(filename.replace(/\.wsdl$/i, '') || 'WSDL Import', children)
}

function parseWireMock(filename: string, text: string, base: InteropBundle): InteropBundle {
  const json = JSON.parse(text)
  const mappings = Array.isArray(json.mappings) ? json.mappings : [json]
  const requests = mappings.map((mapping: any) => request(mapping.name || `${mapping.request?.method || 'GET'} ${mapping.request?.url || mapping.request?.urlPath || '/'}`, method(mapping.request?.method), mapping.request?.url || mapping.request?.urlPath || ''))
  return { ...base, collections: [collection(filename.replace(/\.json$/i, ''), requests)], artifacts: [{ type: 'mock', name: filename, data: json }] }
}

function parseMockoon(filename: string, text: string, base: InteropBundle): InteropBundle {
  const json = JSON.parse(text)
  const routes = Array.isArray(json.routes) ? json.routes : []
  const requests = routes.map((route: any) => request(route.label || `${route.method || 'GET'} ${route.endpoint || '/'}`, method(route.method), route.endpoint || ''))
  return { ...base, collections: [collection(json.name || filename.replace(/\.json$/i, ''), requests)], artifacts: [{ type: 'mock', name: json.name || filename, data: json }] }
}

function parseHoppscotch(filename: string, text: string, base: InteropBundle): InteropBundle {
  const json = JSON.parse(text)
  const walk = (items: any[]): TreeNode[] => items.map((item) => {
    if (Array.isArray(item.folders) || Array.isArray(item.requests)) {
      return { id: uid(), name: item.name || 'Folder', type: 'folder' as const, children: [...walk(item.folders || []), ...walk(item.requests || [])] }
    }
    const req = request(item.name || item.label || 'Hoppscotch Request', method(item.method), item.endpoint || item.url || '')
    req.headers = Array.isArray(item.headers) && item.headers.length ? item.headers.map((h: any) => kv(h.key || h.name, h.value)) : [kv()]
    if (item.body?.body) req.bodies = [{ ...req.bodies[0], type: 'raw', raw: item.body.body, lang: 'json' }]
    return req
  })
  const roots = Array.isArray(json.collections) ? json.collections : []
  return { ...base, collections: [collection(filename.replace(/\.json$/i, '') || 'Hoppscotch Import', walk(roots.length ? roots : json.requests || []))] }
}

export function redactSecrets<T>(value: T): T {
  const walk = (input: unknown, key = ''): unknown => {
    if (input == null) return input
    if (typeof input === 'string') return SECRET_KEY.test(key) ? '***REDACTED***' : input
    if (Array.isArray(input)) return input.map((item) => walk(item, key))
    if (typeof input === 'object') {
      return Object.fromEntries(Object.entries(input as Record<string, unknown>).map(([k, v]) => [k, walk(v, k)]))
    }
    return input
  }
  return walk(value) as T
}

export function summarizeBundle(bundle: InteropBundle) {
  const requests = bundle.collections.reduce((sum, col) => sum + countRequests(col.children), 0)
  return {
    format: bundle.format,
    collections: bundle.collections.length,
    requests,
    environments: bundle.environments.length,
    artifacts: bundle.artifacts.length,
    secretsDetected: bundle.secretsDetected.length,
    warnings: bundle.warnings,
  }
}

function countRequests(nodes: TreeNode[]): number {
  return nodes.reduce((sum, node) => sum + (node.type === 'request' ? 1 : countRequests(node.children)), 0)
}

function findSecrets(text: string): string[] {
  const found = new Set<string>()
  text.split(/\r?\n/).forEach((line) => {
    const key = line.split(/[:=]/)[0]?.trim()
    if (key && SECRET_KEY.test(key)) found.add(key)
  })
  return [...found]
}
