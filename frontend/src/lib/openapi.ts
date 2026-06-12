import type { Collection, TreeNode, RequestItem, KVRow, RequestBody, RequestAuth } from '@/lib/types'
import { uid, blankBody, blankAuth } from '@/lib/types'
import { parse as parseYaml } from 'yaml'

function tryParseYaml(text: string): unknown {
  const t = text.trim()
  if (t.startsWith('{') || t.startsWith('[')) {
    try { return JSON.parse(t) } catch { throw new Error('Invalid JSON') }
  }
  try { return parseYaml(t) } catch { throw new Error('Invalid OpenAPI spec format (must be JSON or YAML)') }
}

interface OpenAPIOperation {
  operationId?: string
  summary?: string
  description?: string
  tags?: string[]
  security?: Array<Record<string, string[]>>
  parameters?: Array<{
    name: string
    in: 'query' | 'header' | 'path' | 'cookie'
    required?: boolean
    schema?: { type?: string; default?: unknown }
    description?: string
    example?: unknown
  }>
  requestBody?: {
    content?: Record<string, { schema?: unknown; example?: unknown }>
  }
  responses?: Record<string, unknown>
}

interface SecurityScheme {
  type: string
  scheme?: string
  bearerFormat?: string
  name?: string
  in?: string
  flows?: Record<string, {
    authorizationUrl?: string
    tokenUrl?: string
    scopes?: Record<string, string>
  }>
}

interface OpenAPISpec {
  openapi: string
  info: { title: string; version?: string; description?: string }
  servers?: Array<{
    url: string
    description?: string
    variables?: Record<string, { default: string; enum?: string[]; description?: string }>
  }>
  security?: Array<Record<string, string[]>>
  paths?: Record<string, Record<string, OpenAPIOperation>>
  components?: {
    securitySchemes?: Record<string, SecurityScheme>
  }
  tags?: Array<{ name: string; description?: string }>
}

function getExample(body: OpenAPIOperation['requestBody']): string | undefined {
  if (!body?.content) return undefined
  for (const ct of Object.keys(body.content)) {
    const c = body.content[ct]
    if (c?.example) return typeof c.example === 'string' ? c.example : JSON.stringify(c.example, null, 2)
  }
  return undefined
}

function schemeToAuth(scheme: SecurityScheme): RequestAuth {
  switch (scheme.type) {
    case 'http':
      if (scheme.scheme === 'bearer') return { ...blankAuth(), type: 'bearer' }
      if (scheme.scheme === 'basic') return { ...blankAuth(), type: 'basic' }
      break
    case 'apiKey':
      return { ...blankAuth(), type: 'apikey', username: scheme.name || 'X-API-Key' }
    case 'oauth2': {
      const flows = scheme.flows ?? {}
      const flow = flows.authorizationCode ?? flows.clientCredentials ?? flows.implicit ?? flows.password ?? {}
      return {
        ...blankAuth(),
        type: 'oauth2',
        oauth2AuthUrl: flow.authorizationUrl ?? '',
        oauth2TokenUrl: flow.tokenUrl ?? '',
        oauth2Scope: Object.keys(flow.scopes ?? {}).join(' '),
      }
    }
    case 'openIdConnect':
      return { ...blankAuth(), type: 'oauth2' }
  }
  return blankAuth()
}

function inferAuth(
  security: Array<Record<string, string[]>> | undefined,
  schemes: Record<string, SecurityScheme> | undefined,
): RequestAuth {
  if (!security || !security.length || !schemes) return blankAuth()
  // Use first non-empty security requirement
  for (const req of security) {
    const schemeName = Object.keys(req)[0]
    if (schemeName && schemes[schemeName]) return schemeToAuth(schemes[schemeName])
  }
  // Fallback: first scheme in components
  const first = Object.values(schemes)[0]
  return first ? schemeToAuth(first) : blankAuth()
}

/** Expand server URL variables to their defaults. */
function resolveServerUrl(server: NonNullable<OpenAPISpec['servers']>[number]): string {
  let url = server.url
  if (server.variables) {
    for (const [varName, varDef] of Object.entries(server.variables)) {
      url = url.split(`{${varName}}`).join(varDef.default)
    }
  }
  return url.replace(/\/$/, '')
}

function ctFromSchema(body: OpenAPIOperation['requestBody']): 'json' | 'xml' | 'text' {
  if (!body?.content) return 'json'
  const cts = Object.keys(body.content)
  if (cts.some((ct) => ct.includes('xml'))) return 'xml'
  if (cts.some((ct) => ct.includes('text'))) return 'text'
  return 'json'
}

export function parseOpenAPI(raw: string): Collection[] {
  const spec = tryParseYaml(raw) as OpenAPISpec

  if (!spec.openapi) throw new Error('Not a valid OpenAPI spec: missing "openapi" field')
  if (!spec.paths) throw new Error('No paths found in OpenAPI spec')

  const schemes = spec.components?.securitySchemes
  const globalSecurity = spec.security
  const server = spec.servers?.[0]
  const baseUrl = server ? resolveServerUrl(server) : ''
  // Global auth used as fallback when an operation has no security override
  const globalAuth = inferAuth(globalSecurity ?? (schemes ? [Object.fromEntries(Object.keys(schemes).map(k => [k, []]))] : undefined), schemes)

  const untaggedCol: Collection = {
    id: uid(),
    name: spec.info?.title || 'Imported API',
    color: '#3b82f6',
    children: [],
  }

  const tagCols = new Map<string, Collection>()
  if (spec.tags) {
    for (const tag of spec.tags) {
      tagCols.set(tag.name, { id: uid(), name: tag.name, children: [] })
    }
  }

  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods as Record<string, OpenAPIOperation>)) {
      if (!['get','post','put','patch','delete','head','options'].includes(method)) continue

      const name = op.summary || op.operationId || `${method.toUpperCase()} ${path}`
      const fullUrl = baseUrl ? `${baseUrl}${path}` : path

      // Per-operation security overrides the global auth
      // An empty security array [] means "no auth" for that operation
      const auth = op.security !== undefined
        ? (op.security.length === 0 ? blankAuth() : inferAuth(op.security, schemes))
        : globalAuth

      const headers: KVRow[] = []
      const params: KVRow[] = []

      if (op.parameters) {
        for (const p of op.parameters) {
          const row: KVRow = {
            id: uid(),
            key: p.name,
            value: p.example != null ? String(p.example) : (p.schema?.default != null ? String(p.schema.default) : ''),
            enabled: p.required ?? false,
          }
          if (p.in === 'query') params.push(row)
          else if (p.in === 'header') headers.push(row)
        }
      }

      let bodies: RequestBody[] = [blankBody()]
      let activeBodyIdx = 0

      if (op.requestBody) {
        const ct = ctFromSchema(op.requestBody)
        const ex = getExample(op.requestBody)
        bodies = [{
          id: uid(),
          name: 'Body 1',
          type: ex ? 'raw' : 'none',
          raw: ex ?? '',
          lang: ct,
          form: [],
        }]
      }

      // Collect any x- vendor extension fields so they survive a round-trip export
      const xExtensions: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(op as Record<string, unknown>)) {
        if (k.startsWith('x-')) xExtensions[k] = v
      }

      const request: RequestItem = {
        id: uid(),
        name,
        description: op.description ?? '',
        type: 'request',
        method: method.toUpperCase() as RequestItem['method'],
        url: fullUrl,
        _openapiPath: path,
        params,
        headers,
        bodies,
        activeBodyIdx,
        auth,
        ...(Object.keys(xExtensions).length > 0 ? { _xExtensions: xExtensions } : {}),
      }

      const tag = op.tags?.[0]
      if (tag && tagCols.has(tag)) {
        tagCols.get(tag)!.children.push(request)
      } else {
        untaggedCol.children.push(request)
      }
    }
  }

  const result: Collection[] = []
  if (untaggedCol.children.length > 0) {
    untaggedCol._openapiSpec = raw
    result.push(untaggedCol)
  }
  for (const col of tagCols.values()) {
    if (col.children.length > 0) {
      col._openapiSpec = raw
      result.push(col)
    }
  }

  return result
}

// ─── OpenAPI round-trip export ─────────────────────────────────────────────

/** Derive a security scheme name + populate the secSchemes map. Returns null when auth is 'none'. */
function deriveScheme(auth: RequestAuth, secSchemes: Record<string, unknown>): string | null {
  switch (auth.type) {
    case 'bearer':
      if (!secSchemes['BearerAuth']) secSchemes['BearerAuth'] = { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
      return 'BearerAuth'
    case 'basic':
      if (!secSchemes['BasicAuth']) secSchemes['BasicAuth'] = { type: 'http', scheme: 'basic' }
      return 'BasicAuth'
    case 'apikey': {
      const headerName = auth.username || 'X-API-Key'
      if (!secSchemes['ApiKeyAuth']) secSchemes['ApiKeyAuth'] = { type: 'apiKey', in: 'header', name: headerName }
      return 'ApiKeyAuth'
    }
    case 'oauth2':
      if (!secSchemes['OAuth2']) {
        const scopes = auth.oauth2Scope
          ? Object.fromEntries(auth.oauth2Scope.split(' ').filter(Boolean).map((s) => [s, s]))
          : {}
        secSchemes['OAuth2'] = {
          type: 'oauth2',
          flows: {
            authorizationCode: {
              authorizationUrl: auth.oauth2AuthUrl || '',
              tokenUrl: auth.oauth2TokenUrl || '',
              scopes,
            },
          },
        }
      }
      return 'OAuth2'
  }
  return null
}

/** Try to resolve the server base URL from the first request that has a full http(s) URL. */
function inferBaseUrl(nodes: TreeNode[]): string {
  for (const n of nodes) {
    if (n.type === 'folder') {
      const b = inferBaseUrl(n.children)
      if (b) return b
    } else {
      const url = (n as RequestItem).url
      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        try {
          const u = new URL(url)
          return u.origin
        } catch { /* skip */ }
      }
    }
  }
  return ''
}

/** Strip the base URL prefix and any query string from a full URL to get the path segment. */
function derivePath(req: RequestItem, baseUrl: string): string {
  // Prefer the stored _openapiPath when available (no information loss)
  if (req._openapiPath) return req._openapiPath

  let path = req.url || '/'
  if (baseUrl && path.startsWith(baseUrl)) path = path.slice(baseUrl.length) || '/'
  else if (path.startsWith('http://') || path.startsWith('https://')) {
    try { path = new URL(path).pathname } catch { /* keep raw */ }
  }
  // Strip inline query string (params are encoded in `parameters`)
  const q = path.indexOf('?')
  if (q >= 0) path = path.slice(0, q)
  if (!path.startsWith('/')) path = `/${path}`
  return path
}

/**
 * Export one or more adOmnia Collections to an OpenAPI 3.0.3 JSON spec string.
 *
 * Round-trip fidelity:
 *  - Request name  → operation.summary
 *  - Description   → operation.description
 *  - Query params  → operation.parameters (in: query)
 *  - Headers       → operation.parameters (in: header)
 *  - Raw/form body → operation.requestBody
 *  - Auth          → components.securitySchemes + operation.security
 *  - x- extensions → merged directly onto the operation object
 *  - Folder names  → operation.tags[]
 */
export function exportToOpenApi(collections: Collection[]): string {
  const allNodes = collections.flatMap((c) => c.children)
  const baseUrl = inferBaseUrl(allNodes)

  const secSchemes: Record<string, unknown> = {}
  const paths: Record<string, Record<string, unknown>> = {}

  function buildOperation(req: RequestItem, tag: string | undefined): Record<string, unknown> {
    const op: Record<string, unknown> = {}
    if (req.name) op.summary = req.name
    if (req.description) op.description = req.description
    if (tag) op.tags = [tag]

    // Query parameters + explicit headers
    const parameters: unknown[] = []
    for (const p of req.params) {
      if (!p.key) continue
      const param: Record<string, unknown> = { name: p.key, in: 'query', required: p.enabled, schema: { type: 'string' } }
      if (p.value) param.example = p.value
      parameters.push(param)
    }
    for (const h of req.headers) {
      if (!h.key) continue
      parameters.push({ name: h.key, in: 'header', required: false, schema: { type: 'string' }, ...(h.value ? { example: h.value } : {}) })
    }
    if (parameters.length) op.parameters = parameters

    // Request body — skip for methods that typically have no body
    const method = req.method.toLowerCase()
    if (!['get', 'head', 'delete', 'options'].includes(method)) {
      const body = req.bodies[req.activeBodyIdx]
      if (body && body.type !== 'none') {
        if (body.type === 'raw') {
          const ct = body.lang === 'xml' ? 'application/xml' : body.lang === 'text' ? 'text/plain' : 'application/json'
          let exampleValue: unknown = body.raw
          if (body.lang === 'json' && body.raw) {
            try { exampleValue = JSON.parse(body.raw) } catch { /* keep string */ }
          }
          op.requestBody = { required: true, content: { [ct]: body.raw ? { example: exampleValue } : {} } }
        } else if (body.type === 'urlencoded' || body.type === 'formdata') {
          const ct = body.type === 'urlencoded' ? 'application/x-www-form-urlencoded' : 'multipart/form-data'
          const props: Record<string, unknown> = {}
          for (const f of body.form.filter((f) => f.key)) {
            props[f.key] = { type: 'string', ...(f.value ? { example: f.value } : {}) }
          }
          op.requestBody = { required: true, content: { [ct]: { schema: { type: 'object', properties: props } } } }
        }
      }
    }

    // Auth → securitySchemes + operation security
    if (req.auth && req.auth.type !== 'none') {
      const schemeName = deriveScheme(req.auth, secSchemes)
      if (schemeName) op.security = [{ [schemeName]: [] }]
    }

    // x-vendor extension round-trip
    if (req._xExtensions) Object.assign(op, req._xExtensions)

    op.responses = { '200': { description: 'OK' } }
    return op
  }

  function walk(nodes: TreeNode[], tag?: string) {
    for (const n of nodes) {
      if (n.type === 'folder') {
        walk(n.children, n.name)
      } else {
        const req = n as RequestItem
        const method = req.method.toLowerCase()
        if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method)) continue

        const path = derivePath(req, baseUrl)
        if (!paths[path]) paths[path] = {}
        paths[path][method] = buildOperation(req, tag)
      }
    }
  }

  for (const col of collections) {
    walk(col.children, collections.length > 1 ? col.name : undefined)
  }

  const spec: Record<string, unknown> = {
    openapi: '3.0.3',
    info: {
      title: collections.length === 1 ? collections[0].name : 'Exported API',
      version: '1.0.0',
    },
    ...(baseUrl ? { servers: [{ url: baseUrl }] } : {}),
    paths,
    ...(Object.keys(secSchemes).length > 0 ? { components: { securitySchemes: secSchemes } } : {}),
  }

  return JSON.stringify(spec, null, 2)
}
