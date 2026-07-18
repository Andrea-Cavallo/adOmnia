/**
 * Swagger 2.0 export for adOmnia collections.
 * Logic derived from swaggymnia (github.com/mlabouardy/swaggymnia), adapted for
 * adOmnia's data model (Collection → TreeNode → RequestItem).
 */
import type { Collection, RequestAuth, RequestItem, TreeNode } from '@/lib/types'

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Extract path-parameter names from a URL with {param} or {{param}} patterns. */
function extractPathParams(url: string): string[] {
  const params: string[] = []
  // Match both {param} (OpenAPI style) and {{param}} (Insomnia/adOmnia variable)
  const re = /\{+([^}]+?)\}+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(url)) !== null) {
    // Skip adOmnia environment variables that are wrapped in {{}}  — they look like
    // {{baseUrl}} and are not path parameters.
    const raw = m[0]
    const name = m[1].trim()
    if (raw.startsWith('{{')) continue   // skip env variables
    if (name && !params.includes(name)) params.push(name)
  }
  return params
}

/** Strip the base URL / server prefix and query string from a full URL to get the path. */
function toPath(url: string, baseUrl: string): string {
  let path = url
  if (baseUrl && path.startsWith(baseUrl)) path = path.slice(baseUrl.length) || '/'
  else if (path.startsWith('http://') || path.startsWith('https://')) {
    try { path = new URL(path).pathname } catch { /* keep raw */ }
  }
  const q = path.indexOf('?')
  if (q >= 0) path = path.slice(0, q)
  if (!path.startsWith('/')) path = `/${path}`
  return path
}

/** Infer scheme (http/https) and host from the first fully-qualified URL in the tree. */
function inferHostInfo(nodes: TreeNode[]): { scheme: string; host: string; basePath: string } {
  for (const n of nodes) {
    if (n.type === 'folder') {
      const r = inferHostInfo(n.children)
      if (r.host) return r
    } else {
      const url = (n as RequestItem).url
      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        try {
          const u = new URL(url)
          return {
            scheme: u.protocol.replace(':', ''),
            host: u.host,
            basePath: u.pathname.split('/').slice(0, 2).join('/') || '/',
          }
        } catch { /* skip */ }
      }
    }
  }
  return { scheme: 'https', host: '', basePath: '/' }
}

/** Build Swagger 2.0 security definitions + per-operation security entry. */
function buildSecurityDef(
  auth: RequestAuth,
  secDefs: Record<string, unknown>,
): Array<Record<string, string[]>> | undefined {
  switch (auth.type) {
    case 'bearer': {
      if (!secDefs['BearerAuth']) {
        secDefs['BearerAuth'] = { type: 'apiKey', name: 'Authorization', in: 'header' }
      }
      return [{ BearerAuth: [] }]
    }
    case 'basic': {
      if (!secDefs['BasicAuth']) {
        secDefs['BasicAuth'] = { type: 'basic' }
      }
      return [{ BasicAuth: [] }]
    }
    case 'apikey': {
      const headerName = auth.username || 'X-API-Key'
      const key = `ApiKeyAuth_${headerName}`
      if (!secDefs[key]) {
        secDefs[key] = { type: 'apiKey', name: headerName, in: 'header' }
      }
      return [{ [key]: [] }]
    }
    case 'oauth2': {
      if (!secDefs['OAuth2']) {
        secDefs['OAuth2'] = {
          type: 'oauth2',
          flow: 'accessCode',
          authorizationUrl: auth.oauth2AuthUrl || '',
          tokenUrl: auth.oauth2TokenUrl || '',
          scopes: auth.oauth2Scope
            ? Object.fromEntries(
                auth.oauth2Scope.split(' ').filter(Boolean).map((s) => [s, s]),
              )
            : {},
        }
      }
      return [{ OAuth2: [] }]
    }
  }
  return undefined
}

// ─── Swagger 2.0 operation builder ───────────────────────────────────────────

function buildOperation(
  req: RequestItem,
  tag: string | undefined,
  secDefs: Record<string, unknown>,
): Record<string, unknown> {
  const op: Record<string, unknown> = {}
  if (tag) op.tags = [tag]
  if (req.name) op.summary = req.name
  if (req.description) op.description = req.description

  const parameters: unknown[] = []

  // Path parameters extracted from the URL pattern
  const pathParams = extractPathParams(req.url || '')
  for (const p of pathParams) {
    parameters.push({ name: p, in: 'path', type: 'string', description: '', required: true })
  }

  // Query parameters from req.params
  for (const p of req.params) {
    if (!p.key) continue
    const param: Record<string, unknown> = {
      name: p.key,
      in: 'query',
      type: 'string',
      description: '',
      required: p.enabled,
    }
    if (p.value) param.default = p.value
    parameters.push(param)
  }

  // Explicit headers (excluding Content-Type which goes into consumes)
  for (const h of req.headers) {
    if (!h.key) continue
    if (h.key.toLowerCase() === 'content-type') continue
    parameters.push({
      name: h.key,
      in: 'header',
      type: 'string',
      description: '',
      required: false,
      ...(h.value ? { default: h.value } : {}),
    })
  }

  // Request body — only for methods that carry a body
  const method = req.method.toLowerCase()
  const hasBody = !['get', 'head', 'delete', 'options'].includes(method)
  if (hasBody) {
    const body = req.bodies[req.activeBodyIdx]
    if (body && body.type !== 'none') {
      if (body.type === 'raw') {
        const ct = body.lang === 'xml' ? 'application/xml'
          : body.lang === 'text' ? 'text/plain'
          : 'application/json'
        op.consumes = [ct]
        let schema: Record<string, unknown> = { type: 'object' }
        if (body.lang === 'json' && body.raw) {
          try {
            const parsed = JSON.parse(body.raw)
            if (parsed && typeof parsed === 'object') {
              schema = {
                type: 'object',
                example: parsed,
              }
            }
          } catch { /* keep generic schema */ }
        } else if (body.lang === 'xml') {
          schema = { type: 'string', example: body.raw || '' }
        }
        parameters.push({ name: 'body', in: 'body', description: '', required: true, schema })
      } else if (body.type === 'urlencoded') {
        op.consumes = ['application/x-www-form-urlencoded']
        for (const f of body.form) {
          if (!f.key) continue
          parameters.push({ name: f.key, in: 'formData', type: 'string', description: '', required: f.enabled, ...(f.value ? { default: f.value } : {}) })
        }
      } else if (body.type === 'formdata') {
        op.consumes = ['multipart/form-data']
        for (const f of body.form) {
          if (!f.key) continue
          parameters.push({ name: f.key, in: 'formData', type: 'string', description: '', required: f.enabled, ...(f.value ? { default: f.value } : {}) })
        }
      }
    }
  }

  if (parameters.length) op.parameters = parameters

  // Security
  if (req.auth && req.auth.type !== 'none') {
    const sec = buildSecurityDef(req.auth, secDefs)
    if (sec) op.security = sec
  }

  op.produces = ['application/json']
  op.responses = { 200: { description: 'successful operation' } }

  return op
}

// ─── public export ────────────────────────────────────────────────────────────

/**
 * Export one or more adOmnia Collections to a Swagger 2.0 JSON spec string.
 * Approach inspired by swaggymnia (github.com/mlabouardy/swaggymnia).
 *
 * Mapping:
 *  - Collection / folder names → tags
 *  - Request name → operation.summary
 *  - URL path params {p} → parameters[in:path]
 *  - req.params → parameters[in:query]
 *  - req.headers → parameters[in:header]
 *  - req.bodies (raw/urlencoded/formdata) → parameters[in:body] or [in:formData]
 *  - req.auth → securityDefinitions + operation.security
 */
export function exportToSwagger2(collections: Collection[]): string {
  const allNodes = collections.flatMap((c) => c.children)
  const { scheme, host, basePath } = inferHostInfo(allNodes)

  // Build base URL for path stripping
  const baseUrl = host ? `${scheme}://${host}` : ''

  const secDefs: Record<string, unknown> = {}
  const tags: Array<{ name: string; description: string }> = []
  const paths: Record<string, Record<string, unknown>> = {}

  function walk(nodes: TreeNode[], tag?: string) {
    for (const n of nodes) {
      if (n.type === 'folder') {
        // Each top-level folder becomes a Swagger tag (mirroring swaggymnia group behaviour)
        if (!tags.some((t) => t.name === n.name)) {
          tags.push({ name: n.name, description: '' })
        }
        walk(n.children, n.name)
      } else {
        const req = n as RequestItem
        const method = req.method.toLowerCase()
        if (!['get', 'query', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method)) continue

        const path = toPath(req.url || '/', baseUrl)
        if (!paths[path]) paths[path] = {}
        paths[path][method] = buildOperation(req, tag, secDefs)
      }
    }
  }

  for (const col of collections) {
    // Use the collection name as the tag when there are multiple collections
    const colTag = collections.length > 1 ? col.name : undefined
    if (colTag && !tags.some((t) => t.name === colTag)) {
      tags.push({ name: colTag, description: '' })
    }
    walk(col.children, colTag)
  }

  const spec: Record<string, unknown> = {
    swagger: '2.0',
    info: {
      title: collections.length === 1 ? collections[0].name : 'Exported API',
      description: '',
      version: '1.0.0',
    },
    ...(host ? { host, basePath: basePath || '/', schemes: [scheme] } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    paths,
    ...(Object.keys(secDefs).length > 0 ? { securityDefinitions: secDefs } : {}),
  }

  return JSON.stringify(spec, null, 2)
}
