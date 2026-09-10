// Validating a logged payload against the contracts already in adOmnia.
//
// A collection imported from OpenAPI carries its spec (`_openapiSpec`). The
// log records a concrete route (`/orders/8f21`) while the contract declares a
// template (`/orders/{orderId}`), so matching is done on the path shape. Every
// violation is reported on its JSONPath together with the rule it broke — the
// contract is shown, never guessed.

import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { parseSpec, preprocessOpenApiSchema, resolveLocalRefs } from '@/lib/contractValidator'

const ajv = new Ajv({ strict: false, allErrors: true, verbose: true, allowUnionTypes: true })
addFormats(ajv)

export type PayloadDirection = 'request' | 'response'

export interface ContractSource {
  id: string
  name: string
  spec: string
}

export interface PayloadViolation {
  /** JSONPath inside the payload, copyable into the query bar. */
  path: string
  keyword: string
  message: string
  /** The contract rule that was broken, in words. */
  expected: string
}

export interface PayloadContractResult {
  matched: boolean
  collectionName: string
  openApiPath: string
  method: string
  direction: PayloadDirection
  required: string[]
  violations: PayloadViolation[]
  /** Why no contract could be applied, empty when one was. */
  reason: string
}

function routeShape(route: string): string[] {
  return route.split('?')[0].replace(/\/+$/, '').split('/').filter(Boolean)
}

/** `/orders/{id}` matches `/orders/8f21`; a `:param` template matches too. */
function pathMatches(template: string, route: string): boolean {
  const left = routeShape(template)
  const right = routeShape(route)
  if (left.length !== right.length) return false
  return left.every((segment, index) => (
    /^\{[^}]+\}$/.test(segment) || /^:[\w-]+$/.test(segment) || segment === right[index]
  ))
}

function jsonPath(instancePath: string): string {
  if (!instancePath) return '$'
  return `$${instancePath.split('/').filter(Boolean).map((part) => (
    /^\d+$/.test(part) ? `[${part}]` : `.${part.replace(/~1/g, '/').replace(/~0/g, '~')}`
  )).join('')}`
}

function describe(keyword: string, params: Record<string, unknown>, schema: unknown): string {
  switch (keyword) {
    case 'required': return `the contract declares "${String(params.missingProperty)}" as required`
    case 'type': return `the contract declares type ${String(params.type)}`
    case 'enum': return `the contract allows only ${JSON.stringify(params.allowedValues)}`
    case 'format': return `the contract declares format "${String(params.format)}"`
    case 'additionalProperties': return `the contract does not declare "${String(params.additionalProperty)}"`
    case 'minimum': case 'maximum': case 'minLength': case 'maxLength':
      return `the contract declares ${keyword} ${String(params.limit)}`
    default: return typeof schema === 'object' ? `contract rule ${keyword}` : `contract rule ${keyword}: ${String(schema)}`
  }
}

function contentSchema(container: Record<string, unknown> | undefined): Record<string, unknown> | null {
  const content = container?.content as Record<string, Record<string, unknown>> | undefined
  if (!content) return null
  const key = Object.keys(content).find((type) => type.includes('json')) ?? Object.keys(content)[0]
  const schema = key ? content[key]?.schema : undefined
  return schema && typeof schema === 'object' ? schema as Record<string, unknown> : null
}

function operationSchema(
  spec: Record<string, unknown>,
  operation: Record<string, unknown>,
  direction: PayloadDirection,
  status: number | null,
): Record<string, unknown> | null {
  const raw = direction === 'request'
    ? contentSchema(operation.requestBody as Record<string, unknown> | undefined)
    : (() => {
        const responses = operation.responses as Record<string, Record<string, unknown>> | undefined
        if (!responses) return null
        const code = status === null ? '' : String(status)
        const entry = responses[code]
          ?? responses[`${code.slice(0, 1)}XX`]
          ?? responses[`${code.slice(0, 1)}xx`]
          ?? responses.default
        return contentSchema(entry)
      })()
  if (!raw) return null
  return preprocessOpenApiSchema(resolveLocalRefs(raw, spec) as Record<string, unknown>)
}

/** Collections that carry an imported OpenAPI document. */
export function contractSourcesFromCollections(
  collections: { id: string; name: string; _openapiSpec?: string }[],
): ContractSource[] {
  return collections
    .filter((collection): collection is { id: string; name: string; _openapiSpec: string } => Boolean(collection._openapiSpec))
    .map((collection) => ({ id: collection.id, name: collection.name, spec: collection._openapiSpec }))
}

export interface PayloadContractInput {
  method: string
  route: string
  status: number | null
  direction: PayloadDirection
  payload: unknown
}

/** Validate one logged payload against the first contract that covers its route. */
export function validateLogPayload(sources: ContractSource[], input: PayloadContractInput): PayloadContractResult {
  const empty: PayloadContractResult = {
    matched: false, collectionName: '', openApiPath: '', method: input.method,
    direction: input.direction, required: [], violations: [], reason: '',
  }
  if (!sources.length) return { ...empty, reason: 'No collection in this workspace carries an OpenAPI document.' }
  if (!input.route) return { ...empty, reason: 'The log does not record a route for this call.' }
  if (input.payload === null || input.payload === undefined) return { ...empty, reason: 'This call has no logged payload.' }

  const method = (input.method || 'GET').toLowerCase() === 'query' ? 'get' : (input.method || 'GET').toLowerCase()
  for (const source of sources) {
    const spec = parseSpec(source.spec)
    const paths = spec?.paths as Record<string, Record<string, unknown>> | undefined
    if (!spec || !paths) continue
    const openApiPath = Object.keys(paths).find((template) => pathMatches(template, input.route))
    if (!openApiPath) continue
    const operation = paths[openApiPath]?.[method] as Record<string, unknown> | undefined
    if (!operation) continue

    const schema = operationSchema(spec, operation, input.direction, input.status)
    if (!schema) {
      return {
        ...empty,
        matched: true,
        collectionName: source.name,
        openApiPath,
        reason: `${source.name} declares ${method.toUpperCase()} ${openApiPath} but no ${input.direction} body schema${input.direction === 'response' && input.status !== null ? ` for status ${input.status}` : ''}.`,
      }
    }

    let validate
    try {
      validate = ajv.compile(schema)
    } catch (error: unknown) {
      return { ...empty, matched: true, collectionName: source.name, openApiPath, reason: `The contract schema could not be compiled: ${error instanceof Error ? error.message : 'unknown error'}.` }
    }
    const valid = validate(input.payload)
    const violations: PayloadViolation[] = valid ? [] : (validate.errors ?? []).map((error) => ({
      path: error.keyword === 'required'
        ? `${jsonPath(error.instancePath)}${jsonPath(error.instancePath) === '$' ? '.' : '.'}${String((error.params as { missingProperty?: string }).missingProperty ?? '')}`
        : jsonPath(error.instancePath),
      keyword: error.keyword,
      message: error.message ?? 'does not satisfy the contract',
      expected: describe(error.keyword, error.params as Record<string, unknown>, error.schema),
    }))

    return {
      matched: true,
      collectionName: source.name,
      openApiPath,
      method: method.toUpperCase(),
      direction: input.direction,
      required: Array.isArray(schema.required) ? schema.required as string[] : [],
      violations,
      reason: '',
    }
  }

  return { ...empty, reason: `No OpenAPI operation matches ${input.method || 'GET'} ${input.route}.` }
}
