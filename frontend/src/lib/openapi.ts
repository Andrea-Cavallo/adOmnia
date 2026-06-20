import type { Collection, TreeNode, RequestItem, KVRow, RequestBody, RequestAuth } from '@/lib/types'
import { uid, blankBody, blankAuth } from '@/lib/types'
import { parseYamlLenient } from '@/lib/yamlParse'

function tryParseYaml(text: string): unknown {
  const t = text.trim()
  if (t.startsWith('{') || t.startsWith('[')) {
    try { return JSON.parse(t) } catch { throw new Error('Invalid JSON') }
  }
  try { return parseYamlLenient(t) } catch { throw new Error('Invalid OpenAPI spec format (must be JSON or YAML)') }
}

interface OpenAPIMediaType {
  schema?: unknown
  example?: unknown
  examples?: unknown
}

interface OpenAPIRequestBody {
  $ref?: string
  required?: boolean
  content?: Record<string, OpenAPIMediaType>
}

interface OpenAPIParameter {
  name: string
  in: 'query' | 'header' | 'path' | 'cookie' | 'body' | 'formData'
  required?: boolean
  schema?: OpenAPISchemaObject
  description?: string
  example?: unknown
  default?: unknown
  type?: string
  format?: string
  enum?: unknown[]
}

interface OpenAPIOperation {
  operationId?: string
  summary?: string
  description?: string
  tags?: string[]
  security?: Array<Record<string, string[]>>
  parameters?: OpenAPIParameter[]
  requestBody?: OpenAPIRequestBody
  consumes?: string[]
  responses?: Record<string, unknown>
}

type OpenAPIPathItem = Partial<Record<HttpMethodKey, OpenAPIOperation>> & {
  $ref?: string
  parameters?: OpenAPIParameter[]
  consumes?: string[]
}
type HttpMethodKey = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options'

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

interface OpenAPISchemaObject {
  type?: string
  format?: string
  properties?: Record<string, OpenAPISchemaObject>
  items?: OpenAPISchemaObject
  $ref?: string
  required?: string[]
  enum?: unknown[]
  example?: unknown
  default?: unknown
  nullable?: boolean
  allOf?: OpenAPISchemaObject[]
  anyOf?: OpenAPISchemaObject[]
  oneOf?: OpenAPISchemaObject[]
}

interface OpenAPISpec {
  openapi?: string
  swagger?: string
  info: { title: string; version?: string; description?: string }
  servers?: Array<{
    url: string
    description?: string
    variables?: Record<string, { default: string; enum?: string[]; description?: string }>
  }>
  security?: Array<Record<string, string[]>>
  paths?: Record<string, OpenAPIPathItem>
  host?: string
  basePath?: string
  schemes?: string[]
  consumes?: string[]
  components?: {
    securitySchemes?: Record<string, SecurityScheme>
    schemas?: Record<string, OpenAPISchemaObject>
    requestBodies?: Record<string, OpenAPIRequestBody>
  }
  definitions?: Record<string, OpenAPISchemaObject>
  tags?: Array<{ name: string; description?: string }>
}

interface SchemaRegistry {
  components?: Record<string, OpenAPISchemaObject>
  definitions?: Record<string, OpenAPISchemaObject>
}

function resolveSchemaRef(ref: string, registry: SchemaRegistry | undefined): OpenAPISchemaObject | undefined {
  if (ref.startsWith('#/components/schemas/')) {
    return registry?.components?.[ref.slice('#/components/schemas/'.length)]
  }
  if (ref.startsWith('#/definitions/')) {
    return registry?.definitions?.[ref.slice('#/definitions/'.length)]
  }
  return undefined
}

function resolveRequestBodyRef(ref: string, requestBodies: Record<string, OpenAPIRequestBody> | undefined): OpenAPIRequestBody | undefined {
  if (!ref.startsWith('#/components/requestBodies/') || !requestBodies) return undefined
  return requestBodies[ref.slice('#/components/requestBodies/'.length)]
}

function schemaToExample(schema: OpenAPISchemaObject | undefined, registry: SchemaRegistry | undefined, depth = 0): unknown {
  if (!schema || depth > 8) return undefined
  if (schema.$ref) {
    const resolved = resolveSchemaRef(schema.$ref, registry)
    return resolved ? schemaToExample(resolved, registry, depth + 1) : undefined
  }
  if (schema.example !== undefined) return schema.example
  if (schema.default !== undefined) return schema.default

  const merged = mergeCompositeSchema(schema, registry, depth)
  if (merged) return merged

  if (schema.properties && !schema.type) {
    const obj: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(schema.properties)) {
      const val = schemaToExample(v, registry, depth + 1)
      if (val !== undefined) obj[k] = val
    }
    return obj
  }

  switch (schema.type) {
    case 'object': {
      if (!schema.properties) return {}
      const obj: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(schema.properties)) {
        const val = schemaToExample(v, registry, depth + 1)
        if (val !== undefined) obj[k] = val
      }
      return obj
    }
    case 'array': {
      const item = schemaToExample(schema.items, registry, depth + 1)
      return item !== undefined ? [item] : []
    }
    case 'string':
      if (schema.enum?.length) return schema.enum[0]
      if (schema.format === 'date') return '20240101'
      if (schema.format === 'date-time') return '2024-01-01T00:00:00Z'
      if (schema.format === 'uri') return 'https://example.com'
      return ''
    case 'integer':
    case 'number':
      if (schema.enum?.length) return schema.enum[0]
      return 0
    case 'boolean':
      return false
    default:
      return undefined
  }
}

function mergeCompositeSchema(schema: OpenAPISchemaObject, registry: SchemaRegistry | undefined, depth: number): unknown {
  const composite = schema.allOf ?? schema.anyOf ?? schema.oneOf
  if (!composite?.length) return undefined
  const merged: Record<string, unknown> = {}
  for (const sub of composite) {
    const val = schemaToExample(sub, registry, depth + 1)
    if (val && typeof val === 'object' && !Array.isArray(val)) Object.assign(merged, val)
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}

function exampleFromExamples(examples: unknown): unknown {
  if (!examples || typeof examples !== 'object' || Array.isArray(examples)) return undefined
  const first = Object.values(examples as Record<string, unknown>)[0]
  if (first && typeof first === 'object' && !Array.isArray(first) && 'value' in first) {
    return (first as { value?: unknown }).value
  }
  return first
}

function stringifyBodyExample(value: unknown, lang: RequestBody['lang']): string {
  if (typeof value === 'string') return value
  if (lang === 'json') return JSON.stringify(value, null, 2)
  return String(value ?? '')
}

function mediaTypePriority(contentType: string): number {
  const ct = contentType.toLowerCase()
  if (ct.includes('json')) return 0
  if (ct.includes('x-www-form-urlencoded')) return 1
  if (ct.includes('multipart/form-data')) return 2
  if (ct.includes('xml')) return 3
  if (ct.includes('text')) return 4
  return 5
}

function pickContentEntry(content: Record<string, OpenAPIMediaType>): [string, OpenAPIMediaType] | undefined {
  return Object.entries(content).sort(([a], [b]) => mediaTypePriority(a) - mediaTypePriority(b))[0]
}

function langFromContentType(contentType: string): RequestBody['lang'] {
  const ct = contentType.toLowerCase()
  if (ct.includes('xml')) return 'xml'
  if (ct.includes('html')) return 'html'
  if (ct.includes('javascript')) return 'javascript'
  if (ct.includes('text')) return 'text'
  return 'json'
}

function valueFromSchemaOrParam(schema: OpenAPISchemaObject | undefined, param: OpenAPIParameter | undefined, registry: SchemaRegistry): string {
  const value = param?.example
    ?? param?.default
    ?? schema?.example
    ?? schema?.default
    ?? (schema?.enum?.length ? schema.enum[0] : undefined)
    ?? (param?.enum?.length ? param.enum[0] : undefined)
    ?? schemaToExample(schema, registry)
  return value === undefined ? '' : String(value)
}

function formRowsFromSchema(schema: OpenAPISchemaObject | undefined, registry: SchemaRegistry): KVRow[] {
  const resolved = schema?.$ref ? resolveSchemaRef(schema.$ref, registry) ?? schema : schema
  const props = resolved?.properties ?? {}
  return Object.entries(props).map(([key, prop]) => ({
    id: uid(),
    key,
    value: valueFromSchemaOrParam(prop, undefined, registry),
    enabled: resolved?.required?.includes(key) ?? false,
  }))
}

function getMediaExample(media: OpenAPIMediaType, registry: SchemaRegistry): unknown {
  if (media.example !== undefined) return media.example
  const example = exampleFromExamples(media.examples)
  if (example !== undefined) return example
  if (media.schema) return schemaToExample(media.schema as OpenAPISchemaObject, registry)
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

function swaggerBaseUrl(spec: OpenAPISpec): string {
  if (!spec.host) return ''
  const scheme = spec.schemes?.[0] ?? 'https'
  const basePath = spec.basePath && spec.basePath !== '/' ? spec.basePath : ''
  return `${scheme}://${spec.host}${basePath}`.replace(/\/$/, '')
}

function buildBodiesFromOpenAPIRequestBody(
  body: OpenAPIRequestBody | undefined,
  requestBodies: Record<string, OpenAPIRequestBody> | undefined,
  registry: SchemaRegistry,
): RequestBody[] | undefined {
  const resolved = body?.$ref ? resolveRequestBodyRef(body.$ref, requestBodies) : body
  if (!resolved?.content) return undefined

  const picked = pickContentEntry(resolved.content)
  if (!picked) return undefined

  const [contentType, media] = picked
  const lower = contentType.toLowerCase()
  const schema = media.schema as OpenAPISchemaObject | undefined

  if (lower.includes('x-www-form-urlencoded') || lower.includes('multipart/form-data')) {
    return [{
      id: uid(),
      name: 'Body 1',
      type: lower.includes('multipart/form-data') ? 'formdata' : 'urlencoded',
      raw: '',
      lang: 'json',
      form: formRowsFromSchema(schema, registry),
    }]
  }

  const lang = langFromContentType(contentType)
  const example = getMediaExample(media, registry)
  return [{
    id: uid(),
    name: 'Body 1',
    type: 'raw',
    raw: example === undefined ? '' : stringifyBodyExample(example, lang),
    lang,
    form: [],
  }]
}

function buildBodiesFromSwaggerParameters(
  parameters: OpenAPIParameter[] | undefined,
  consumes: string[] | undefined,
  registry: SchemaRegistry,
): RequestBody[] | undefined {
  if (!parameters?.length) return undefined

  const formParams = parameters.filter((param) => param.in === 'formData')
  if (formParams.length > 0) {
    const isMultipart = consumes?.some((ct) => ct.toLowerCase().includes('multipart/form-data')) ?? false
    return [{
      id: uid(),
      name: 'Body 1',
      type: isMultipart ? 'formdata' : 'urlencoded',
      raw: '',
      lang: 'json',
      form: formParams.map((param) => ({
        id: uid(),
        key: param.name,
        value: valueFromSchemaOrParam(param.schema, param, registry),
        enabled: param.required ?? false,
      })),
    }]
  }

  const bodyParam = parameters.find((param) => param.in === 'body')
  if (!bodyParam) return undefined

  const contentType = consumes?.[0] ?? 'application/json'
  const lang = langFromContentType(contentType)
  const example = bodyParam.example
    ?? bodyParam.schema?.example
    ?? bodyParam.schema?.default
    ?? schemaToExample(bodyParam.schema, registry)

  return [{
    id: uid(),
    name: 'Body 1',
    type: 'raw',
    raw: example === undefined ? '' : stringifyBodyExample(example, lang),
    lang,
    form: [],
  }]
}

const HTTP_METHODS: HttpMethodKey[] = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']

function importableOperations(pathItem: OpenAPIPathItem): Array<[HttpMethodKey, OpenAPIOperation]> {
  return HTTP_METHODS
    .map((method) => [method, pathItem[method]] as const)
    .filter((entry): entry is [HttpMethodKey, OpenAPIOperation] => Boolean(entry[1]))
}

function mergeParameters(pathParams: OpenAPIParameter[] | undefined, opParams: OpenAPIParameter[] | undefined): OpenAPIParameter[] | undefined {
  if (!pathParams?.length) return opParams
  if (!opParams?.length) return pathParams

  const merged = new Map<string, OpenAPIParameter>()
  for (const param of pathParams) merged.set(`${param.in}:${param.name}`, param)
  for (const param of opParams) merged.set(`${param.in}:${param.name}`, param)
  return [...merged.values()]
}

function isExternalPathRefOnly(pathItem: OpenAPIPathItem): boolean {
  return Boolean(pathItem.$ref) && importableOperations(pathItem).length === 0
}

function buildUnresolvedRefOperation(path: string, ref: string): OpenAPIOperation {
  const leaf = ref.split(/[\\/]/).pop()?.replace(/\.(ya?ml|json)$/i, '') || path
  return {
    summary: `Referenced path: ${path}`,
    description: `This path is defined in an external OpenAPI file (${ref}). Import the bundled spec folder to hydrate the real method, parameters, request body, and responses.`,
    operationId: leaf.replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, ''),
    responses: {
      default: {
        description: `Unresolved external PathItem reference: ${ref}`,
      },
    },
  }
}

export function parseOpenAPI(raw: string): Collection[] {
  const spec = tryParseYaml(raw) as OpenAPISpec

  const isSwagger2 = typeof spec.swagger === 'string' && spec.swagger.startsWith('2')
  if (!spec.openapi && !isSwagger2) throw new Error('Not a valid OpenAPI spec: missing "openapi" or Swagger 2.0 "swagger" field')
  if (!spec.paths) throw new Error('No paths found in OpenAPI spec')

  const schemes = spec.components?.securitySchemes
  const schemaRegistry: SchemaRegistry = {
    components: spec.components?.schemas,
    definitions: spec.definitions,
  }
  const globalSecurity = spec.security
  const server = spec.servers?.[0]
  const baseUrl = isSwagger2 ? swaggerBaseUrl(spec) : (server ? resolveServerUrl(server) : '')
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

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    const operations = importableOperations(pathItem)
    if (operations.length === 0 && isExternalPathRefOnly(pathItem)) {
      operations.push(['get', buildUnresolvedRefOperation(path, pathItem.$ref!)])
    }

    for (const [method, op] of operations) {
      const parameters = mergeParameters(pathItem.parameters, op.parameters)

      const name = op.summary || op.operationId || `${method.toUpperCase()} ${path}`
      const fullUrl = baseUrl ? `${baseUrl}${path}` : path

      // Per-operation security overrides the global auth
      // An empty security array [] means "no auth" for that operation
      const auth = op.security !== undefined
        ? (op.security.length === 0 ? blankAuth() : inferAuth(op.security, schemes))
        : globalAuth

      const headers: KVRow[] = []
      const params: KVRow[] = []

      if (parameters) {
        for (const p of parameters) {
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

      const importedBodies = isSwagger2
        ? buildBodiesFromSwaggerParameters(parameters, op.consumes ?? pathItem.consumes ?? spec.consumes, schemaRegistry)
        : buildBodiesFromOpenAPIRequestBody(op.requestBody, spec.components?.requestBodies, schemaRegistry)
      if (importedBodies) bodies = importedBodies

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
