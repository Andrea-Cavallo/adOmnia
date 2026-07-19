// Parse a raw OpenAPI 3.x or Swagger 2.0 document (JSON or YAML string) into a
// flat, render-friendly model for the read-only API Docs viewer.
//
// Local $ref targets (#/components/schemas/* for OAS3, #/definitions/* for
// Swagger 2.0) are kept as named references and resolved on demand by the
// SchemaView component against `schemaRegistry`, with a depth guard for cycles.

import { parseYamlLenient as parseYaml } from '@/lib/yamlParse'

export interface ApiDocSchema {
  // A permissive JSON-Schema-ish node. `$ref` is preserved for lazy resolution.
  [key: string]: unknown
  $ref?: string
}

export interface ApiDocParam {
  name: string
  in: 'query' | 'path' | 'header' | 'cookie'
  required: boolean
  description?: string
  schema?: ApiDocSchema
}

export interface ApiDocBody {
  required: boolean
  contentTypes: string[]
  description?: string
  schema?: ApiDocSchema
  example?: unknown
}

export interface ApiDocResponse {
  status: string
  description?: string
  contentTypes: string[]
  schema?: ApiDocSchema
  example?: unknown
}

export interface ApiDocOperation {
  id: string
  method: string
  path: string
  summary?: string
  description?: string
  deprecated: boolean
  parameters: ApiDocParam[]
  requestBody?: ApiDocBody
  responses: ApiDocResponse[]
}

export interface ApiDocTagGroup {
  name: string
  description?: string
  operations: ApiDocOperation[]
}

export interface ApiDocModel {
  title: string
  version: string
  description?: string
  servers: string[]
  tags: ApiDocTagGroup[]
  schemaRegistry: Record<string, ApiDocSchema>
  operationCount: number
}

const HTTP_METHODS = ['get', 'query', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace']
const MAX_EXAMPLE_DEPTH = 8

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/** Parse a spec string as JSON, falling back to YAML. Throws on both failing. */
export function parseSpecText(raw: string): unknown {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('Empty document')
  try {
    return JSON.parse(trimmed)
  } catch {
    try {
      return parseYaml(trimmed)
    } catch (e: unknown) {
      throw new Error(`Not valid JSON or YAML: ${e instanceof Error ? e.message : 'parse error'}`)
    }
  }
}

/** Build the viewer model from a parsed spec object (OAS3 or Swagger 2.0). */
export function buildApiDocModel(spec: unknown): ApiDocModel {
  const root = asRecord(spec)
  const isSwagger2 = asString(root.swagger).startsWith('2')
  const info = asRecord(root.info)

  const schemaRegistry = isSwagger2
    ? collectSchemas(asRecord(root.definitions), '#/definitions/')
    : collectSchemas(asRecord(asRecord(root.components).schemas), '#/components/schemas/')

  const servers = isSwagger2
    ? swaggerServers(root)
    : (Array.isArray(root.servers) ? root.servers : [])
        .map((s) => asString(asRecord(s).url))
        .filter(Boolean)

  const tagDescriptions = new Map<string, string>()
  if (Array.isArray(root.tags)) {
    for (const t of root.tags) {
      const tr = asRecord(t)
      const name = asString(tr.name)
      if (name) tagDescriptions.set(name, asString(tr.description))
    }
  }

  const groups = new Map<string, ApiDocOperation[]>()
  const paths = asRecord(root.paths)
  let operationCount = 0

  for (const [path, pathItemRaw] of Object.entries(paths)) {
    const pathItem = asRecord(pathItemRaw)
    const sharedParams = Array.isArray(pathItem.parameters) ? pathItem.parameters : []
    for (const method of HTTP_METHODS) {
      const opRaw = pathItem[method]
      if (!opRaw) continue
      const op = asRecord(opRaw)
      const tags = Array.isArray(op.tags) && op.tags.length > 0
        ? op.tags.map((t) => asString(t)).filter(Boolean)
        : ['default']
      const operation = buildOperation(method.toUpperCase(), path, op, sharedParams, isSwagger2, schemaRegistry)
      operationCount += 1
      for (const tag of tags) {
        if (!groups.has(tag)) groups.set(tag, [])
        groups.get(tag)!.push(operation)
      }
    }
  }

  const tags: ApiDocTagGroup[] = Array.from(groups.entries())
    .map(([name, operations]) => ({ name, description: tagDescriptions.get(name), operations }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    title: asString(info.title, 'API Documentation'),
    version: asString(info.version, ''),
    description: asString(info.description) || undefined,
    servers,
    tags,
    schemaRegistry,
    operationCount,
  }
}

function swaggerServers(root: Record<string, unknown>): string[] {
  const host = asString(root.host)
  if (!host) return []
  const basePath = asString(root.basePath)
  const schemes = Array.isArray(root.schemes) && root.schemes.length > 0
    ? root.schemes.map((s) => asString(s))
    : ['https']
  return schemes.map((scheme) => `${scheme}://${host}${basePath}`)
}

function collectSchemas(schemas: Record<string, unknown>, prefix: string): Record<string, ApiDocSchema> {
  const registry: Record<string, ApiDocSchema> = {}
  for (const [name, schema] of Object.entries(schemas)) {
    registry[`${prefix}${name}`] = asRecord(schema) as ApiDocSchema
    registry[name] = asRecord(schema) as ApiDocSchema // also index by bare name
  }
  return registry
}

function buildOperation(
  method: string,
  path: string,
  op: Record<string, unknown>,
  sharedParams: unknown[],
  isSwagger2: boolean,
  schemaRegistry: Record<string, ApiDocSchema>,
): ApiDocOperation {
  const allParams = [...sharedParams, ...(Array.isArray(op.parameters) ? op.parameters : [])]
  const parameters: ApiDocParam[] = []
  let bodyFromParam: ApiDocBody | undefined

  for (const raw of allParams) {
    const p = asRecord(raw)
    const location = asString(p.in)
    if (isSwagger2 && location === 'body') {
      const schema = asRecord(p.schema) as ApiDocSchema
      bodyFromParam = {
        required: Boolean(p.required),
        contentTypes: ['application/json'],
        description: asString(p.description) || undefined,
        schema,
        example: exampleFromSchema(schema, schemaRegistry),
      }
      continue
    }
    if (location !== 'query' && location !== 'path' && location !== 'header' && location !== 'cookie') continue
    parameters.push({
      name: asString(p.name),
      in: location,
      required: Boolean(p.required),
      description: asString(p.description) || undefined,
      schema: isSwagger2 ? (p as ApiDocSchema) : (asRecord(p.schema) as ApiDocSchema),
    })
  }

  const requestBody = isSwagger2 ? bodyFromParam : buildRequestBody(asRecord(op.requestBody), schemaRegistry)
  const responses = buildResponses(asRecord(op.responses), isSwagger2, schemaRegistry)

  return {
    id: `${method} ${path}`,
    method,
    path,
    summary: asString(op.summary) || undefined,
    description: asString(op.description) || undefined,
    deprecated: Boolean(op.deprecated),
    parameters,
    requestBody,
    responses,
  }
}

function buildRequestBody(rb: Record<string, unknown>, schemaRegistry: Record<string, ApiDocSchema>): ApiDocBody | undefined {
  const content = asRecord(rb.content)
  const contentTypes = Object.keys(content)
  if (contentTypes.length === 0) return undefined
  const first = asRecord(content[contentTypes[0]])
  const schema = asRecord(first.schema) as ApiDocSchema
  return {
    required: Boolean(rb.required),
    contentTypes,
    description: asString(rb.description) || undefined,
    schema,
    example: first.example ?? exampleFromExamples(first.examples) ?? exampleFromSchema(schema, schemaRegistry),
  }
}

function buildResponses(
  responses: Record<string, unknown>,
  isSwagger2: boolean,
  schemaRegistry: Record<string, ApiDocSchema>,
): ApiDocResponse[] {
  const out: ApiDocResponse[] = []
  for (const [status, raw] of Object.entries(responses)) {
    const r = asRecord(raw)
    if (isSwagger2) {
      const schema = r.schema ? (asRecord(r.schema) as ApiDocSchema) : undefined
      out.push({
        status,
        description: asString(r.description) || undefined,
        contentTypes: [],
        schema,
        example: exampleFromSchema(schema, schemaRegistry),
      })
      continue
    }
    const content = asRecord(r.content)
    const contentTypes = Object.keys(content)
    const first = contentTypes.length > 0 ? asRecord(content[contentTypes[0]]) : {}
    const schema = first.schema ? (asRecord(first.schema) as ApiDocSchema) : undefined
    out.push({
      status,
      description: asString(r.description) || undefined,
      contentTypes,
      schema,
      example: first.example ?? exampleFromExamples(first.examples) ?? exampleFromSchema(schema, schemaRegistry),
    })
  }
  return out.sort((a, b) => a.status.localeCompare(b.status))
}

function exampleFromExamples(examples: unknown): unknown {
  const rec = asRecord(examples)
  const first = Object.values(rec)[0]
  return first !== undefined ? asRecord(first).value : undefined
}

export function exampleFromSchema(
  schema: ApiDocSchema | undefined,
  registry: Record<string, ApiDocSchema> | undefined,
  depth = 0,
): unknown {
  if (!schema || depth > MAX_EXAMPLE_DEPTH) return undefined
  if (schema.example !== undefined) return schema.example
  if (schema.default !== undefined) return schema.default
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0]
  if (schema.$ref) {
    const resolved = registry ? resolveSchemaRef(schema.$ref, registry) : null
    return resolved ? exampleFromSchema(resolved, registry, depth + 1) : {}
  }

  const composite = firstSchema(schema.allOf) ?? firstSchema(schema.oneOf) ?? firstSchema(schema.anyOf)
  if (composite) {
    const base = exampleFromSchema(composite, registry, depth + 1)
    if (!Array.isArray(schema.allOf)) return base
    const merged = typeof base === 'object' && base !== null && !Array.isArray(base) ? { ...base } : {}
    for (const part of schema.allOf) {
      const value = exampleFromSchema(asRecord(part) as ApiDocSchema, registry, depth + 1)
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) Object.assign(merged, value)
    }
    return merged
  }

  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type
  if (type === 'array' || schema.items) {
    const item = exampleFromSchema(asRecord(schema.items) as ApiDocSchema, registry, depth + 1)
    return [item ?? 'string']
  }
  if (type === 'object' || schema.properties) {
    const properties = asRecord(schema.properties)
    const out: Record<string, unknown> = {}
    for (const [key, prop] of Object.entries(properties)) {
      out[key] = exampleFromSchema(asRecord(prop) as ApiDocSchema, registry, depth + 1)
    }
    return out
  }
  if (type === 'integer') return 0
  if (type === 'number') return 0
  if (type === 'boolean') return true
  if (type === 'string') {
    if (schema.format === 'date-time') return '2024-01-01T00:00:00Z'
    if (schema.format === 'date') return '2024-01-01'
    if (schema.format === 'email') return 'user@example.com'
    if (schema.format === 'uri') return 'https://example.com'
    return 'string'
  }
  return undefined
}

function firstSchema(value: unknown): ApiDocSchema | undefined {
  return Array.isArray(value) && value.length > 0 ? (asRecord(value[0]) as ApiDocSchema) : undefined
}

/** Resolve a `$ref` against the registry, or return null if unknown. */
export function resolveSchemaRef(
  ref: string,
  registry: Record<string, ApiDocSchema>,
): ApiDocSchema | null {
  if (registry[ref]) return registry[ref]
  const bare = ref.split('/').pop() ?? ref
  return registry[bare] ?? null
}

/** A short human label for a `$ref` (the trailing schema name). */
export function refName(ref: string): string {
  return ref.split('/').pop() ?? ref
}
