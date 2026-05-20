import type { Collection, RequestItem, KVRow, RequestBody, RequestAuth } from '@/lib/types'
import { uid, blankBody, blankAuth } from '@/lib/types'

// Basic YAML to JSON converter (handles common OpenAPI patterns)
function basicYamlToJson(yaml: string): unknown {
  const lines = yaml.split('\n')
  const root: Record<string, unknown> = {}
  const indentStack: number[] = [0]
  const objStack: unknown[] = [root]

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const indent = line.search(/\S/)
    while (indentStack.length > 1 && indent < indentStack[indentStack.length - 1]) {
      indentStack.pop()
      objStack.pop()
    }

    const current = objStack[objStack.length - 1] as Record<string, unknown>

    if (trimmed.startsWith('- ')) {
      const value = trimmed.slice(2).trim()
      const colonIdx = value.indexOf(':')
      const arr = (current['__array__'] as unknown[]) || []
      if (colonIdx > 0 && !value.startsWith('http://') && !value.startsWith('https://')) {
        const key = value.slice(0, colonIdx).trim()
        const val = parseValue(value.slice(colonIdx + 1).trim())
        const item: Record<string, unknown> = { [key]: val }
        const nextLine = i + 1 < lines.length ? lines[i + 1] : ''
        const nextIndent = nextLine ? nextLine.search(/\S/) : -1
        if (nextIndent > indent) {
          arr.push(item)
          current['__array__'] = arr
          indentStack.push(nextIndent)
          objStack.push(item)
        } else {
          arr.push(item)
          current['__array__'] = arr
        }
      } else {
        arr.push(parseValue(value))
        current['__array__'] = arr
      }
      continue
    }

    const colonIdx = trimmed.indexOf(':')
    if (colonIdx === -1) continue

    const key = trimmed.slice(0, colonIdx).trim()
    const value = trimmed.slice(colonIdx + 1).trim()

    if (value === '' || value === '|' || value === '>') {
      const newObj: Record<string, unknown> = {}
      current[key] = newObj
      indentStack.push(indent)
      objStack.push(newObj)

      if (value === '|' || value === '>') {
        let literal = ''
        i++
        while (i < lines.length) {
          const nl = lines[i]
          if (nl.search(/\S/) <= indent) { i--; break }
          literal += nl.trim() + '\n'
          i++
        }
        newObj['__value__'] = literal.trim()
      }
    } else {
      current[key] = parseValue(value)
    }
  }

  return finalize(root)
}

function parseValue(val: string): unknown {
  const t = val.trim()
  if (t === 'true') return true
  if (t === 'false') return false
  if (t === 'null' || t === '~') return null
  if (/^-?\d+$/.test(t)) return parseInt(t, 10)
  if (/^-?\d+\.\d+$/.test(t)) return parseFloat(t)
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    return t.slice(1, -1)
  }
  return t
}

function finalize(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(finalize)
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (k === '__array__') return (v as unknown[]).map(finalize)
    if (k === '__value__') return v
    result[k] = finalize(v)
  }
  return result
}

function tryParseYaml(text: string): unknown {
  const t = text.trim()
  if (t.startsWith('{') || t.startsWith('[')) {
    try { return JSON.parse(t) } catch { throw new Error('Invalid JSON') }
  }
  try { return basicYamlToJson(t) } catch { throw new Error('Invalid OpenAPI spec format (must be JSON or YAML)') }
}

interface OpenAPIOperation {
  operationId?: string
  summary?: string
  description?: string
  tags?: string[]
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

interface OpenAPISpec {
  openapi: string
  info: { title: string; version?: string; description?: string }
  servers?: Array<{ url: string; description?: string }>
  paths?: Record<string, Record<string, OpenAPIOperation>>
  components?: {
    securitySchemes?: Record<string, {
      type: string
      scheme?: string
      bearerFormat?: string
      name?: string
      in?: string
      flows?: Record<string, unknown>
    }>
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

function inferAuth(spec: OpenAPISpec): RequestAuth {
  const schemes = spec.components?.securitySchemes
  if (!schemes) return blankAuth()
  const scheme = Object.values(schemes)[0]
  if (!scheme) return blankAuth()
  switch (scheme.type) {
    case 'http':
      if (scheme.scheme === 'bearer') return { ...blankAuth(), type: 'bearer' }
      if (scheme.scheme === 'basic') return { ...blankAuth(), type: 'basic' }
      break
    case 'apiKey':
      return { ...blankAuth(), type: 'apikey', username: scheme.name || 'X-API-Key' }
  }
  return blankAuth()
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

  const baseUrl = spec.servers?.[0]?.url ?? ''
  const auth = inferAuth(spec)

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
      const fullUrl = baseUrl ? `${baseUrl.replace(/\/$/, '')}${path}` : path

      const headers: KVRow[] = []
      const params: KVRow[] = []

      if (op.parameters) {
        for (const p of op.parameters) {
          const row: KVRow = {
            id: uid(),
            key: p.name,
            value: p.example != null ? String(p.example) : '',
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

      const request: RequestItem = {
        id: uid(),
        name,
        type: 'request',
        method: method.toUpperCase() as RequestItem['method'],
        url: fullUrl,
        _openapiPath: path,
        params,
        headers,
        bodies,
        activeBodyIdx,
        auth,
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
