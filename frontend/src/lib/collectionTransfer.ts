import type { Collection, HttpMethod, KVRow, RequestAuth, RequestItem, TreeNode } from '@/lib/types'
import { blankAuth, blankBody, uid } from '@/lib/types'
import { openApiToCollection } from '@/lib/openapiImport'
import { exportToOpenApi } from '@/lib/openapi'

export type CollectionFormat = 'auto' | 'adomnia' | 'postman' | 'insomnia' | 'bruno' | 'openapi'
export type ExportFormat = Exclude<CollectionFormat, 'auto'>

export interface ImportResult {
  collections: Collection[]
  format: Exclude<CollectionFormat, 'auto'>
  warnings: string[]
}

function row(key = '', value = '', enabled = true): KVRow {
  return { id: uid(), key, value, enabled }
}

function request(name: string, method: HttpMethod, url: string): RequestItem {
  return {
    id: uid(),
    name: name || `${method} ${url || 'Request'}`,
    type: 'request',
    method,
    url,
    params: [row()],
    headers: [row()],
    bodies: [blankBody()],
    activeBodyIdx: 0,
    auth: blankAuth(),
    timeout: 0,
    followRedirects: true,
  }
}

function cloneNode(node: TreeNode): TreeNode {
  if (node.type === 'folder') {
    return { ...node, id: uid(), children: node.children.map(cloneNode) }
  }
  return { ...node, id: uid(), headers: node.headers.map((h) => ({ ...h, id: uid() })), params: node.params.map((p) => ({ ...p, id: uid() })), bodies: node.bodies.map((b) => ({ ...b, id: uid(), form: b.form.map((f) => ({ ...f, id: uid() })) })) }
}

export function cloneCollection(collection: Collection, name = `${collection.name} Copy`): Collection {
  return { ...collection, id: uid(), name, children: collection.children.map(cloneNode) }
}

function normalizeMethod(value: unknown): HttpMethod {
  const method = String(value || 'GET').toUpperCase()
  const allowed = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE', 'WS', 'SOAP']
  return (allowed.includes(method) ? method : 'GET') as HttpMethod
}

function rawUrl(input: any): string {
  if (!input) return ''
  if (typeof input === 'string') return input
  if (input.raw) return String(input.raw)
  if (Array.isArray(input.host)) {
    const protocol = input.protocol ? `${input.protocol}://` : ''
    const host = input.host.join('.')
    const path = Array.isArray(input.path) ? `/${input.path.join('/')}` : ''
    return `${protocol}${host}${path}`
  }
  return ''
}

function importPostmanItem(item: any): TreeNode | null {
  if (Array.isArray(item.item)) {
    return {
      id: uid(),
      name: String(item.name || 'Folder'),
      type: 'folder',
      children: item.item.map(importPostmanItem).filter(Boolean) as TreeNode[],
    }
  }
  if (!item.request) return null
  const req = request(String(item.name || 'Request'), normalizeMethod(item.request.method), rawUrl(item.request.url))
  req.description = typeof item.request.description === 'string'
    ? item.request.description
    : String(item.request.description?.content || '')
  req.headers = Array.isArray(item.request.header) && item.request.header.length
    ? item.request.header.map((h: any) => row(String(h.key || ''), String(h.value || ''), !h.disabled))
    : [row()]
  if (Array.isArray(item.request.url?.query) && item.request.url.query.length) {
    req.params = item.request.url.query.map((p: any) => row(String(p.key || ''), String(p.value || ''), !p.disabled))
  }
  const body = item.request.body
  if (body?.raw != null) {
    req.bodies = [{ ...blankBody(), type: 'raw', raw: String(body.raw), lang: body.options?.raw?.language === 'xml' ? 'xml' : 'json' }]
  }
  if (item.request.auth) req.auth = importPostmanAuth(item.request.auth)
  if (Array.isArray(item.event)) {
    req.scripts = {
      pre: eventScript(item.event, 'prerequest'),
      tests: eventScript(item.event, 'test'),
    }
  }
  return req
}

function eventScript(events: any[], listen: string): string {
  const event = events.find((e) => e.listen === listen)
  const exec = event?.script?.exec
  return Array.isArray(exec) ? exec.join('\n') : ''
}

function importPostmanAuth(auth: any): RequestAuth {
  const next = blankAuth()
  if (auth.type === 'bearer') {
    next.type = 'bearer'
    next.token = String(auth.bearer?.find?.((x: any) => x.key === 'token')?.value || '')
  }
  if (auth.type === 'basic') {
    next.type = 'basic'
    next.username = String(auth.basic?.find?.((x: any) => x.key === 'username')?.value || '')
    next.password = String(auth.basic?.find?.((x: any) => x.key === 'password')?.value || '')
  }
  if (auth.type === 'apikey') next.type = 'apikey'
  return next
}

function importPostman(json: any): Collection {
  return {
    id: uid(),
    name: String(json.info?.name || json.name || 'Postman Collection'),
    children: Array.isArray(json.item) ? json.item.map(importPostmanItem).filter(Boolean) as TreeNode[] : [],
  }
}

function importInsomniaAuth(auth: any): RequestAuth {
  const next = blankAuth()
  if (!auth || !auth.type || auth.disabled) return next
  switch (String(auth.type)) {
    case 'bearer':
      next.type = 'bearer'
      next.token = String(auth.token || auth.prefix ? `${auth.prefix || 'Bearer'} ${auth.token || ''}`.trim() : '')
      break
    case 'basic':
      next.type = 'basic'
      next.username = String(auth.username || '')
      next.password = String(auth.password || '')
      break
    case 'apikey':
      next.type = 'apikey'
      next.username = String(auth.key || 'X-API-Key')
      next.token = String(auth.value || '')
      break
    case 'oauth2':
      next.type = 'oauth2'
      next.oauth2TokenUrl = String(auth.accessTokenUrl || '')
      next.oauth2AuthUrl = String(auth.authorizationUrl || '')
      next.oauth2ClientId = String(auth.clientId || '')
      next.oauth2ClientSecret = String(auth.clientSecret || '')
      next.oauth2Scope = String(auth.scope || '')
      break
  }
  return next
}

function importInsomnia(json: any): Collection[] {
  const resources: any[] = Array.isArray(json.resources) ? json.resources : []
  const workspaces = resources.filter((r) => r._type === 'workspace')
  const requests = resources.filter((r) => r._type === 'request')
  const groups = resources.filter((r) => r._type === 'request_group')
  const buildChildren = (parentId: string | null): TreeNode[] => [
    ...groups.filter((g) => (g.parentId ?? null) === parentId).map((g) => ({ id: uid(), name: String(g.name || 'Folder'), type: 'folder' as const, children: buildChildren(g._id) })),
    ...requests.filter((r) => (r.parentId ?? null) === parentId).map((r) => {
      const req = request(String(r.name || 'Request'), normalizeMethod(r.method), String(r.url || ''))
      req.headers = Array.isArray(r.headers) && r.headers.length ? r.headers.map((h: any) => row(String(h.name || h.key || ''), String(h.value || ''), !h.disabled)) : [row()]
      if (Array.isArray(r.parameters) && r.parameters.length) {
        req.params = r.parameters.map((p: any) => row(String(p.name || ''), String(p.value || ''), !p.disabled))
      }
      const mime: string = r.body?.mimeType || ''
      if (r.body?.text) {
        req.bodies = [{ ...blankBody(), type: 'raw', raw: String(r.body.text), lang: mime.includes('xml') ? 'xml' : mime.includes('text') ? 'text' : 'json' }]
      } else if (r.body?.params && mime.includes('urlencoded')) {
        req.bodies = [{ ...blankBody(), type: 'urlencoded', form: r.body.params.map((p: any) => row(String(p.name || ''), String(p.value || ''), !p.disabled)) }]
      } else if (r.body?.params && mime.includes('multipart')) {
        req.bodies = [{ ...blankBody(), type: 'formdata', form: r.body.params.map((p: any) => row(String(p.name || ''), String(p.value || ''), !p.disabled)) }]
      }
      if (r.authentication) req.auth = importInsomniaAuth(r.authentication)
      const pre = String(r.preRequestScript || '')
      const post = String(r.afterResponseScript || '')
      if (pre || post) req.scripts = { pre, tests: post }
      return req
    }),
  ]
  if (!workspaces.length) return [{ id: uid(), name: String(json.name || 'Insomnia Collection'), children: buildChildren(null) }]
  return workspaces.map((w) => ({ id: uid(), name: String(w.name || 'Insomnia Workspace'), children: buildChildren(w._id) }))
}

function importBruno(json: any): Collection {
  const walk = (items: any[]): TreeNode[] => items.map((item) => {
    if (item.type === 'folder' || Array.isArray(item.items)) {
      return { id: uid(), name: String(item.name || 'Folder'), type: 'folder' as const, children: walk(item.items || item.children || []) }
    }
    const req = request(String(item.name || item.meta?.name || 'Request'), normalizeMethod(item.request?.method || item.method), String(item.request?.url || item.url || ''))
    const headers = item.request?.headers || item.headers
    if (Array.isArray(headers) && headers.length) req.headers = headers.map((h: any) => row(String(h.name || h.key || ''), String(h.value || ''), h.enabled !== false))
    const body = item.request?.body || item.body
    if (typeof body === 'string') req.bodies = [{ ...blankBody(), type: 'raw', raw: body, lang: 'json' }]
    else if (body?.raw) req.bodies = [{ ...blankBody(), type: 'raw', raw: String(body.raw), lang: body.mode === 'xml' ? 'xml' : 'json' }]
    // Auth from JSON Bruno export
    const auth = item.request?.auth
    if (auth) {
      if (auth.bearer && auth.bearer.token) req.auth = { ...blankAuth(), type: 'bearer', token: String(auth.bearer.token) }
      else if (auth.basic) req.auth = { ...blankAuth(), type: 'basic', username: String(auth.basic.username || ''), password: String(auth.basic.password || '') }
      else if (auth.apikey) req.auth = { ...blankAuth(), type: 'apikey', username: String(auth.apikey.key || 'X-API-Key'), token: String(auth.apikey.value || '') }
    }
    return req
  })
  return { id: uid(), name: String(json.name || json.collection?.name || 'Bruno Collection'), children: walk(json.items || json.children || json.requests || []) }
}

/** Parse a single Bruno native .bru text file into a one-request Collection. */
function parseBruFile(text: string): Collection {
  // Split text into sections: "sectionName {" ... "}"
  const sections = new Map<string, string[]>()
  const lines = text.split('\n')
  let currentSection: string | null = null
  const buf: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (currentSection === null) {
      const m = trimmed.match(/^([a-zA-Z][a-zA-Z0-9:_-]*)\s*\{$/)
      if (m) { currentSection = m[1]; buf.length = 0 }
    } else {
      if (trimmed === '}') { sections.set(currentSection, [...buf]); currentSection = null; buf.length = 0 }
      else buf.push(line)
    }
  }

  const parseKV = (name: string): Record<string, string> => {
    const result: Record<string, string> = {}
    for (const ln of sections.get(name) ?? []) {
      const idx = ln.indexOf(':')
      if (idx < 1) continue
      const k = ln.slice(0, idx).trim()
      const v = ln.slice(idx + 1).trim()
      if (k) result[k] = v
    }
    return result
  }

  const getRaw = (name: string): string => (sections.get(name) ?? []).join('\n').trim()

  const meta = parseKV('meta')
  const reqName = meta.name || 'Bruno Request'

  let method: HttpMethod = 'GET'
  let methodKV: Record<string, string> = {}
  for (const m of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']) {
    if (sections.has(m)) { method = m.toUpperCase() as HttpMethod; methodKV = parseKV(m); break }
  }

  const req = request(reqName, method, methodKV.url || '')

  const hdrs = parseKV('headers')
  if (Object.keys(hdrs).length) req.headers = Object.entries(hdrs).map(([k, v]) => row(k, v))

  const qp = parseKV('params:query')
  if (Object.keys(qp).length) req.params = Object.entries(qp).map(([k, v]) => row(k, v))

  const authType = methodKV.auth || 'none'
  if (authType === 'bearer') {
    const kv = parseKV('auth:bearer')
    req.auth = { ...blankAuth(), type: 'bearer', token: kv.token || '' }
  } else if (authType === 'basic') {
    const kv = parseKV('auth:basic')
    req.auth = { ...blankAuth(), type: 'basic', username: kv.username || '', password: kv.password || '' }
  } else if (authType === 'apikey') {
    const kv = parseKV('auth:apikey')
    req.auth = { ...blankAuth(), type: 'apikey', username: kv.key || 'X-API-Key', token: kv.value || '' }
  }

  const bodyType = methodKV.body || 'none'
  if (bodyType === 'json') {
    req.bodies = [{ ...blankBody(), type: 'raw', raw: getRaw('body:json'), lang: 'json' }]
  } else if (bodyType === 'xml') {
    req.bodies = [{ ...blankBody(), type: 'raw', raw: getRaw('body:xml'), lang: 'xml' }]
  } else if (bodyType === 'text') {
    req.bodies = [{ ...blankBody(), type: 'raw', raw: getRaw('body:text'), lang: 'text' }]
  } else if (bodyType === 'form-urlencoded') {
    req.bodies = [{ ...blankBody(), type: 'urlencoded', form: Object.entries(parseKV('body:form-urlencoded')).map(([k, v]) => row(k, v)) }]
  } else if (bodyType === 'multipart-form') {
    req.bodies = [{ ...blankBody(), type: 'formdata', form: Object.entries(parseKV('body:multipart-form')).map(([k, v]) => row(k, v)) }]
  }

  const pre = getRaw('script:pre-request')
  const post = getRaw('script:post-response')
  if (pre || post) req.scripts = { pre, tests: post }

  return { id: uid(), name: reqName, children: [req] }
}

function importAdomnia(json: any): Collection[] {
  if (Array.isArray(json)) return json as Collection[]
  if (json.format === 'adomnia-workspace' && Array.isArray(json.collections)) return json.collections as Collection[]
  if (json.format === 'adomnia-collection' && json.collection) return [json.collection as Collection]
  if (json.type === 'collection' && Array.isArray(json.children)) return [json as Collection]
  if (json.type === 'folder' || json.type === 'request') return [{ id: uid(), name: json.name || 'Imported Selection', children: [json as TreeNode] }]
  throw new Error('Not an adOmnia collection or workspace.')
}

export function importCollectionsFromText(text: string, forced: CollectionFormat = 'auto'): ImportResult {
  const warnings: string[] = []

  // Detect Bruno .bru native text format before JSON parsing
  const trimmed = text.trimStart()
  const isBruText = !trimmed.startsWith('{') && !trimmed.startsWith('[') &&
    /^(meta|get|post|put|patch|delete|head|options)\s*\{/m.test(trimmed)
  if (isBruText || forced === 'bruno') {
    try {
      const col = parseBruFile(text)
      return { collections: [col], format: 'bruno', warnings }
    } catch (e) {
      if (forced === 'bruno') throw e
      // Fall through to JSON/YAML parsing
    }
  }

  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    if (forced === 'auto' || forced === 'openapi') return { collections: [openApiToCollection(text)], format: 'openapi', warnings }
    throw new Error('The selected file is not valid JSON.')
  }
  const detect = forced === 'auto'
    ? json.info?.schema?.includes('postman') ? 'postman'
      : json._type === 'export' || Array.isArray(json.resources) ? 'insomnia'
      : json.openapi || json.swagger ? 'openapi'
      : json.format?.startsWith?.('adomnia') || json.type === 'collection' || Array.isArray(json.collections) ? 'adomnia'
      : json.collection?.name || Array.isArray(json.items) ? 'bruno'
      : 'adomnia'
    : forced
  const collections =
    detect === 'postman' ? [importPostman(json)]
      : detect === 'insomnia' ? importInsomnia(json)
      : detect === 'bruno' ? [importBruno(json)]
      : detect === 'openapi' ? [openApiToCollection(JSON.stringify(json))]
      : importAdomnia(json)
  if (!collections.length) throw new Error('No collections found in the selected file.')
  return { collections, format: detect, warnings }
}

export function exportCollectionPayload(collection: Collection, format: ExportFormat): string {
  if (format === 'adomnia') return JSON.stringify({ format: 'adomnia-collection', version: '1.0', collection }, null, 2)
  if (format === 'postman') return JSON.stringify(toPostmanCollection(collection), null, 2)
  if (format === 'insomnia') return JSON.stringify(toInsomniaExport(collection), null, 2)
  if (format === 'openapi') return exportToOpenApi([collection])
  return JSON.stringify(toBrunoCollection(collection), null, 2)
}

export function exportNodePayload(_collection: Collection, node: TreeNode, format: ExportFormat): string {
  return exportCollectionPayload({ id: uid(), name: node.name, children: [node] }, format)
}

export function exportAllCollectionsPayload(collections: Collection[], format: ExportFormat): string {
  if (format === 'adomnia') return JSON.stringify({ format: 'adomnia-workspace', version: '1.0', collections }, null, 2)
  if (format === 'openapi') return exportToOpenApi(collections)
  return JSON.stringify(collections.map((collection) => JSON.parse(exportCollectionPayload(collection, format))), null, 2)
}

function toPostmanCollection(collection: Collection) {
  const toItem = (node: TreeNode): any => node.type === 'folder'
    ? { name: node.name, item: node.children.map(toItem) }
    : {
        name: node.name,
        request: {
          description: node.description || undefined,
          method: node.method,
          header: node.headers.filter((h) => h.key).map((h) => ({ key: h.key, value: h.value, disabled: !h.enabled })),
          url: { raw: node.url },
          body: node.bodies[node.activeBodyIdx]?.raw ? { mode: 'raw', raw: node.bodies[node.activeBodyIdx].raw } : undefined,
        },
      }
  return { info: { name: collection.name, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: collection.children.map(toItem) }
}

function toInsomniaExport(collection: Collection) {
  const resources: any[] = [{ _id: `wrk_${collection.id}`, _type: 'workspace', name: collection.name }]
  const walk = (nodes: TreeNode[], parentId: string) => {
    for (const node of nodes) {
      if (node.type === 'folder') {
        const id = `fld_${node.id}`
        resources.push({ _id: id, _type: 'request_group', parentId, name: node.name })
        walk(node.children, id)
      } else {
        resources.push({ _id: `req_${node.id}`, _type: 'request', parentId, name: node.name, method: node.method, url: node.url, headers: node.headers.map((h) => ({ name: h.key, value: h.value, disabled: !h.enabled })), body: { text: node.bodies[node.activeBodyIdx]?.raw || '' } })
      }
    }
  }
  walk(collection.children, `wrk_${collection.id}`)
  return { _type: 'export', __export_format: 4, resources }
}

function toBrunoCollection(collection: Collection) {
  const walk = (nodes: TreeNode[]): any[] => nodes.map((node) => node.type === 'folder'
    ? { type: 'folder', name: node.name, items: walk(node.children) }
    : { type: 'request', name: node.name, request: { method: node.method, url: node.url, headers: node.headers.filter((h) => h.key), body: { raw: node.bodies[node.activeBodyIdx]?.raw || '' } } })
  return { version: '1', name: collection.name, items: walk(collection.children) }
}
