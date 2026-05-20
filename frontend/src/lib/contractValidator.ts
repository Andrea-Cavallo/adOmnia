import Ajv, { type ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'
import type { ContractValidationResult, ContractError, ContractWarning, ResponseData, RequestItem } from '@/lib/types'

const ajv = new Ajv({
  strict: false,
  allErrors: true,
  verbose: true,
  allowUnionTypes: true,
  coerceTypes: false,
  removeAdditional: false,
})
addFormats(ajv)

const ajvCache = new Map<string, ValidateFunction>()

function schemaKey(path: string, method: string, status: string): string {
  return `${method}:${path}:${status}`
}

function basicYamlToJson(yaml: string): Record<string, unknown> {
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
        const val = parseYamlValue(value.slice(colonIdx + 1).trim())
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
        arr.push(parseYamlValue(value))
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
      current[key] = parseYamlValue(value)
    }
  }

  return finalizeYaml(root) as Record<string, unknown>
}

function parseYamlValue(val: string): unknown {
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

function finalizeYaml(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(finalizeYaml)
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (k === '__array__') return (v as unknown[]).map(finalizeYaml)
    if (k === '__value__') return v
    result[k] = finalizeYaml(v)
  }
  return result
}

function parseSpec(raw: string): Record<string, unknown> | null {
  try {
    const trimmed = raw.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return JSON.parse(trimmed)
    }
    return basicYamlToJson(trimmed)
  } catch {
    return null
  }
}

function getSchemaForResponse(
  spec: Record<string, unknown>,
  oaPath: string,
  method: string,
  statusCode: number,
): Record<string, unknown> | null {
  const paths = spec.paths as Record<string, Record<string, unknown>> | undefined
  if (!paths) return null

  const pathEntry = paths[oaPath]
  if (!pathEntry) return null

  const op = pathEntry[method.toLowerCase()] as Record<string, unknown> | undefined
  if (!op) return null

  const responses = op.responses as Record<string, Record<string, unknown>> | undefined
  if (!responses) return null

  const statusStr = String(statusCode)

  let respEntry = responses[statusStr]

  if (!respEntry) {
    const pattern = statusStr.slice(0, 1) + 'XX'
    respEntry = responses[pattern]
  }

  if (!respEntry) {
    respEntry = responses.default
  }

  if (!respEntry) return null

  const content = respEntry.content as Record<string, Record<string, unknown>> | undefined
  if (!content) return null

  const firstCt = Object.keys(content)[0]
  if (!firstCt) return null

  const mediaType = content[firstCt]
  if (!mediaType?.schema) return null

  return preprocessOpenApiSchema(
    JSON.parse(JSON.stringify(mediaType.schema)) as Record<string, unknown>
  )
}

function preprocessOpenApiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...schema }

  if (result.nullable === true) {
    const t = result.type
    if (typeof t === 'string') {
      result.type = [t, 'null']
    } else if (Array.isArray(t) && !t.includes('null')) {
      result.type = [...t, 'null']
    }
    delete result.nullable
  }

  delete result.example
  delete result.examples
  delete result.deprecated
  delete result.writeOnly
  delete result.readOnly

  if (typeof result.type === 'object' && !Array.isArray(result.type)) {
    delete result.type
  }

  if (result.properties && typeof result.properties === 'object') {
    const props = result.properties as Record<string, unknown>
    for (const key of Object.keys(props)) {
      const propSchema = props[key] as Record<string, unknown>
      if (propSchema && typeof propSchema === 'object' && Object.keys(propSchema).length > 0) {
        props[key] = preprocessOpenApiSchema(propSchema)
      }
    }
  }

  if (result.items && typeof result.items === 'object' && !Array.isArray(result.items)) {
    result.items = preprocessOpenApiSchema(result.items as Record<string, unknown>)
  }

  if (result.allOf && Array.isArray(result.allOf)) {
    result.allOf = result.allOf.map((s) =>
      preprocessOpenApiSchema(typeof s === 'object' && s !== null ? s as Record<string, unknown> : {})
    )
  }

  if (result.oneOf && Array.isArray(result.oneOf)) {
    result.oneOf = result.oneOf.map((s) =>
      preprocessOpenApiSchema(typeof s === 'object' && s !== null ? s as Record<string, unknown> : {})
    )
  }

  if (result.anyOf && Array.isArray(result.anyOf)) {
    result.anyOf = result.anyOf.map((s) =>
      preprocessOpenApiSchema(typeof s === 'object' && s !== null ? s as Record<string, unknown> : {})
    )
  }

  return result
}

function getExpectedContentTypes(
  spec: Record<string, unknown>,
  oaPath: string,
  method: string,
  statusCode: number,
): string[] {
  const paths = spec.paths as Record<string, Record<string, unknown>> | undefined
  if (!paths) return []
  const op = paths[oaPath]?.[method.toLowerCase()] as Record<string, unknown> | undefined
  if (!op?.responses) return []

  const responses = op.responses as Record<string, Record<string, unknown>>
  const respEntry = responses[String(statusCode)] ||
    responses[String(statusCode).slice(0, 1) + 'XX'] ||
    responses.default

  if (!respEntry?.content) return []
  return Object.keys(respEntry.content as Record<string, unknown>)
}

function getExpectedStatusCodes(
  spec: Record<string, unknown>,
  oaPath: string,
  method: string,
): string[] {
  const paths = spec.paths as Record<string, Record<string, unknown>> | undefined
  if (!paths) return []
  const op = paths[oaPath]?.[method.toLowerCase()] as Record<string, unknown> | undefined
  if (!op?.responses) return []
  return Object.keys(op.responses as Record<string, unknown>).filter(
    (k) => k !== 'default'
  )
}

function getExpectedHeaders(
  spec: Record<string, unknown>,
  oaPath: string,
  method: string,
  statusCode: number,
): Record<string, Record<string, unknown>> {
  const paths = spec.paths as Record<string, Record<string, unknown>> | undefined
  if (!paths) return {}
  const op = paths[oaPath]?.[method.toLowerCase()] as Record<string, unknown> | undefined
  if (!op?.responses) return {}

  const responses = op.responses as Record<string, Record<string, unknown>>
  const respEntry = responses[String(statusCode)] ||
    responses[String(statusCode).slice(0, 1) + 'XX'] ||
    responses.default

  if (!respEntry?.headers) return {}
  return respEntry.headers as Record<string, Record<string, unknown>>
}

export function validateContract(
  oaSpecRaw: string | undefined,
  oaPath: string | undefined,
  method: string | undefined,
  response: ResponseData,
): ContractValidationResult {
  const errors: ContractError[] = []
  const warnings: ContractWarning[] = []

  if (!oaSpecRaw || !oaPath || !method) {
    return { valid: false, errors, warnings, hasSpec: false }
  }

  const spec = parseSpec(oaSpecRaw)
  if (!spec) {
    errors.push({ category: 'body', message: 'Failed to parse stored OpenAPI spec' })
    return { valid: false, errors, warnings, hasSpec: true }
  }

  const paths = spec.paths as Record<string, Record<string, unknown>> | undefined
  if (!paths) {
    errors.push({ category: 'body', message: 'OpenAPI spec has no paths' })
    return { valid: false, errors, warnings, hasSpec: true }
  }

  const pathEntry = paths[oaPath]
  if (!pathEntry) {
    errors.push({
      category: 'body',
      message: `Path "${oaPath}" not found in OpenAPI spec. The spec may have been updated.`,
    })
    return { valid: false, errors, warnings, hasSpec: true }
  }

  const lowered = method.toLowerCase()
  const op = pathEntry[lowered] as Record<string, unknown> | undefined
  if (!op) {
    errors.push({
      category: 'body',
      message: `Method ${method.toUpperCase()} not defined for path "${oaPath}" in OpenAPI spec`,
    })
    return { valid: false, errors, warnings, hasSpec: true }
  }

  const responses = op.responses as Record<string, Record<string, unknown>> | undefined
  if (!responses) {
    errors.push({
      category: 'status',
      message: 'No responses defined in OpenAPI spec for this operation',
    })
    return { valid: false, errors, warnings, hasSpec: true }
  }

  // 1. Validate status code
  const statusStr = String(response.status)
  const expectedStatuses = getExpectedStatusCodes(spec, oaPath, method)
  if (expectedStatuses.length > 0 && !expectedStatuses.some((s) => matchStatusCode(s, response.status))) {
    errors.push({
      category: 'status',
      message: `Status code ${response.status} is not in the expected list: ${expectedStatuses.join(', ')}`,
      detail: `Expected one of [${expectedStatuses.join(', ')}], got ${response.status}`,
    })
  }

  // 2. Validate content-type
  const expectedCts = getExpectedContentTypes(spec, oaPath, method, response.status)
  if (expectedCts.length > 0 && response.contentType) {
    const normalizedCt = response.contentType.split(';')[0].trim().toLowerCase()
    const matches = expectedCts.some(
      (ct) => ct.split(';')[0].trim().toLowerCase() === normalizedCt
    )
    if (!matches) {
      errors.push({
        category: 'contentType',
        message: `Content-Type "${response.contentType}" not in expected: ${expectedCts.join(', ')}`,
      })
    }
  }

  // 3. Validate headers
  const expectedHeaders = getExpectedHeaders(spec, oaPath, method, response.status)
  for (const [hName, hSchema] of Object.entries(expectedHeaders)) {
    const responseValue = response.headers[hName.toLowerCase()] ?? response.headers[hName]
    const required = (hSchema as Record<string, unknown>).required === true
    if (required && !responseValue) {
      errors.push({
        category: 'header',
        message: `Required response header "${hName}" is missing`,
      })
    }
  }

  // 4. Validate body against JSON Schema
  const bodySchema = getSchemaForResponse(spec, oaPath, method, response.status)
  if (!bodySchema && response.body.trim()) {
    warnings.push({
      category: 'unexpectedHeader',
      message: `No response schema defined for status ${response.status} — response body not validated`,
    })
  }

  if (bodySchema && response.body.trim()) {
    let parsedBody: unknown = undefined
    const normalizedCt = response.contentType?.split(';')[0].trim().toLowerCase() ?? ''

    const isJSON =
      normalizedCt.includes('json') ||
      /^\s*[\[{]/.test(response.body.trim())

    if (isJSON) {
      try {
        parsedBody = JSON.parse(response.body)
      } catch {
        errors.push({
          category: 'body',
          message: 'Response body is not valid JSON; cannot validate against schema',
        })
      }
    }

    if (parsedBody !== undefined) {
      const cacheKey = schemaKey(oaPath, method, statusStr)
      let validateFn = ajvCache.get(cacheKey)

      if (!validateFn) {
        try {
          validateFn = ajv.compile(bodySchema)
          ajvCache.set(cacheKey, validateFn)
        } catch (compileErr) {
          errors.push({
            category: 'body',
            message: `Schema compilation error: ${String(compileErr)}`,
          })
        }
      }

      if (validateFn) {
        const valid = validateFn(parsedBody)
        if (!valid && validateFn.errors) {
          for (const e of validateFn.errors) {
            const path = e.instancePath || '(root)'
            const keyword = e.keyword
            const params = e.params ? JSON.stringify(e.params) : ''
            let msg = ''

            switch (keyword) {
              case 'required':
                msg = `${path}: missing required field(s): ${(e.params as { missingProperty?: string })?.missingProperty || params}`
                break
              case 'type':
                msg = `${path}: expected ${e.message}, got ${e.data === null ? 'null' : typeof e.data}`
                break
              case 'enum':
                msg = `${path}: value "${String(e.data)}" not in allowed enum values: ${(e.params as { allowedValues?: unknown[] })?.allowedValues?.join(', ') || params}`
                break
              case 'additionalProperties':
                msg = `${path}: unexpected field(s): ${(e.params as { additionalProperty?: string })?.additionalProperty || params}`
                break
              case 'format':
                msg = `${path}: "${String(e.data)}" does not match format "${(e.params as { format?: string })?.format || 'unknown'}"`
                break
              case 'pattern':
                msg = `${path}: "${String(e.data)}" does not match required pattern`
                break
              case 'minimum':
              case 'maximum':
              case 'minLength':
              case 'maxLength':
              case 'minItems':
              case 'maxItems':
                msg = `${path}: ${e.message}`
                break
              default:
                msg = `${path}: ${e.message}`
            }

            errors.push({
              category: 'body',
              message: msg,
              detail: `${path} — ${keyword}`,
            })
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    hasSpec: true,
  }
}

function matchStatusCode(pattern: string, status: number): boolean {
  if (pattern === 'default') return true

  if (pattern.includes('X') || pattern.includes('x')) {
    const prefix = pattern[0]
    if (prefix === '2' && status >= 200 && status < 300) return true
    if (prefix === '3' && status >= 300 && status < 400) return true
    if (prefix === '4' && status >= 400 && status < 500) return true
    if (prefix === '5' && status >= 500 && status < 600) return true
    return false
  }

  return String(status) === pattern
}

// ─── Request Validation ────────────────────────────────────────

function getSchemaForRequest(
  spec: Record<string, unknown>,
  oaPath: string,
  method: string,
): Record<string, unknown> | null {
  const paths = spec.paths as Record<string, Record<string, unknown>> | undefined
  if (!paths) return null

  const op = paths[oaPath]?.[method.toLowerCase()] as Record<string, unknown> | undefined
  if (!op) return null

  const requestBody = op.requestBody as Record<string, unknown> | undefined
  if (!requestBody) return null
  const content = requestBody.content as Record<string, { schema?: unknown }> | undefined
  if (!content) return null

  const firstCt = Object.keys(content)[0]
  const schema = content[firstCt]?.schema
  if (!schema) return null

  return preprocessOpenApiSchema(
    JSON.parse(JSON.stringify(schema)) as Record<string, unknown>
  )
}

export function validateRequestContract(
  oaSpecRaw: string | undefined,
  oaPath: string | undefined,
  request: RequestItem,
): ContractValidationResult {
  const errors: ContractError[] = []
  const warnings: ContractWarning[] = []

  if (!oaSpecRaw || !oaPath) {
    return { valid: false, errors, warnings, hasSpec: false }
  }

  const spec = parseSpec(oaSpecRaw)
  if (!spec) {
    errors.push({ category: 'body', message: 'Failed to parse stored OpenAPI spec' })
    return { valid: false, errors, warnings, hasSpec: true }
  }

  const paths = spec.paths as Record<string, Record<string, unknown>> | undefined
  if (!paths) {
    errors.push({ category: 'body', message: 'OpenAPI spec has no paths' })
    return { valid: false, errors, warnings, hasSpec: true }
  }

  const op = paths[oaPath]?.[request.method.toLowerCase()] as Record<string, unknown> | undefined
  if (!op) {
    errors.push({ category: 'body', message: `Method ${request.method} not defined for "${oaPath}"` })
    return { valid: false, errors, warnings, hasSpec: true }
  }

  const opParams = op.parameters as Array<{
    name: string
    in: string
    required?: boolean
    schema?: { type?: string; enum?: unknown[]; pattern?: string }
  }> | undefined

  // Validate required path/query/header params
  if (opParams) {
    for (const p of opParams) {
      const isRequired = p.required === true
      const paramName = p.name

      let provided = ''
      let found = false
      if (p.in === 'header') {
        const row = request.headers.find((h) => h.key === paramName && h.enabled)
        found = !!row
        provided = row?.value || ''
      } else if (p.in === 'query') {
        const row = request.params.find((q) => q.key === paramName && q.enabled)
        found = !!row
        provided = row?.value || ''
      }

      if (isRequired && (!found || !provided)) {
        errors.push({
          category: p.in === 'header' ? 'header' : 'status',
          message: `Required ${p.in} parameter "${paramName}" is missing or empty`,
        })
      }
    }
  }

  // Validate request body
  const activeBody = request.bodies[request.activeBodyIdx]
  if (activeBody && activeBody.type === 'raw' && activeBody.raw.trim()) {
    const bodySchema = getSchemaForRequest(spec, oaPath, request.method)
    if (bodySchema) {
      let parsedBody: unknown
      try {
        parsedBody = JSON.parse(activeBody.raw)
      } catch {
        errors.push({
          category: 'body',
          message: 'Request body is not valid JSON; cannot validate against schema',
        })
      }

      if (parsedBody !== undefined) {
        const cacheKey = `req:${request.method}:${oaPath}`
        let validateFn = ajvCache.get(cacheKey)
        if (!validateFn) {
          try {
            validateFn = ajv.compile(bodySchema)
            ajvCache.set(cacheKey, validateFn)
          } catch (compileErr) {
            errors.push({
              category: 'body',
              message: `Schema compilation error: ${String(compileErr)}`,
            })
          }
        }
        if (validateFn) {
          const valid = validateFn(parsedBody)
          if (!valid && validateFn.errors) {
            for (const e of validateFn.errors) {
              const path = e.instancePath || '(root)'
              const keyword = e.keyword
              let msg = ''
              switch (keyword) {
                case 'required':
                  msg = `${path}: missing required field: ${(e.params as { missingProperty?: string })?.missingProperty || ''}`
                  break
                case 'type':
                  msg = `${path}: ${e.message}`
                  break
                case 'enum':
                  msg = `${path}: value "${String(e.data)}" not in allowed enum`
                  break
                case 'additionalProperties':
                  msg = `${path}: unexpected field: ${(e.params as { additionalProperty?: string })?.additionalProperty || ''}`
                  break
                default:
                  msg = `${path}: ${e.message}`
              }
              errors.push({
                category: 'body',
                message: msg,
                detail: `${path} — ${keyword}`,
              })
            }
          }
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings, hasSpec: true }
}

export function validateContractAuto(
  oaSpecRaw: string | undefined,
  oaPath: string | undefined,
  method: string | undefined,
  response: ResponseData,
): ContractValidationResult {
  return validateContract(oaSpecRaw, oaPath, method, response)
}

// ─── Report Export ─────────────────────────────────────────────

export function exportContractReportMarkdown(
  result: ContractValidationResult,
  requestName?: string,
): string {
  const lines: string[] = []
  lines.push(`# Contract Test Report`)
  if (requestName) lines.push(`**Request:** ${requestName}`)
  lines.push(`**Result:** ${result.valid ? '✅ Passed' : '❌ Failed'}`)
  lines.push(`**Errors:** ${result.errors.length} | **Warnings:** ${result.warnings.length}`)
  lines.push('')

  if (!result.hasSpec) {
    lines.push('> No OpenAPI contract linked to this request.')
    return lines.join('\n')
  }

  const byCategory = new Map<string, ContractError[]>()
  for (const e of result.errors) {
    const list = byCategory.get(e.category) || []
    list.push(e)
    byCategory.set(e.category, list)
  }

  for (const [cat, errs] of byCategory) {
    lines.push(`### ${cat} (${errs.length})`)
    for (const e of errs) {
      lines.push(`- ❌ ${e.message}`)
    }
    lines.push('')
  }

  if (result.warnings.length > 0) {
    lines.push('### Warnings')
    for (const w of result.warnings) {
      lines.push(`- ⚠️ ${w.message}`)
    }
    lines.push('')
  }

  if (result.valid) {
    lines.push('All contract checks passed.')
  }

  return lines.join('\n')
}

export function exportContractReportHtml(
  result: ContractValidationResult,
  requestName?: string,
): string {
  const parts: string[] = []
  parts.push(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Contract Test Report</title>`)
  parts.push(`<style>body{font-family:system-ui;background:#1e1e2e;color:#cdd6f4;padding:20px;max-width:800px;margin:0 auto}.pass{color:#a6e3a1}.fail{color:#f38ba8}.warn{color:#f9e2af}.cat{margin-top:16px;font-weight:bold;color:#89b4fa}li{margin:4px 0;font-size:14px}.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:bold}.badge-pass{background:#a6e3a120;color:#a6e3a1}.badge-fail{background:#f38ba820;color:#f38ba8}</style></head><body>`)
  parts.push(`<h1>Contract Test Report</h1>`)
  if (requestName) parts.push(`<p><strong>Request:</strong> ${requestName}</p>`)
  parts.push(`<p><strong>Result:</strong> ${result.valid ? '<span class="pass">PASS</span>' : '<span class="fail">FAIL</span>'}</p>`)
  parts.push(`<p>Errors: <span class="badge ${result.errors.length ? 'badge-fail' : 'badge-pass'}">${result.errors.length}</span> | Warnings: ${result.warnings.length}</p>`)

  if (!result.hasSpec) {
    parts.push('<p><em>No OpenAPI contract linked to this request.</em></p>')
    parts.push('</body></html>')
    return parts.join('\n')
  }

  const byCategory = new Map<string, ContractError[]>()
  for (const e of result.errors) {
    const list = byCategory.get(e.category) || []
    list.push(e)
    byCategory.set(e.category, list)
  }

  for (const [cat, errs] of byCategory) {
    parts.push(`<div class="cat">${cat} (${errs.length})</div>`)
    parts.push('<ul>')
    for (const e of errs) {
      parts.push(`<li class="fail">${e.message}</li>`)
    }
    parts.push('</ul>')
  }

  if (result.warnings.length > 0) {
    parts.push('<div class="cat">Warnings</div><ul>')
    for (const w of result.warnings) {
      parts.push(`<li class="warn">${w.message}</li>`)
    }
    parts.push('</ul>')
  }

  if (result.valid) {
    parts.push('<p class="pass">All contract checks passed.</p>')
  }

  parts.push('</body></html>')
  return parts.join('\n')
}

export function exportContractReportJson(
  result: ContractValidationResult,
  requestName?: string,
): string {
  return JSON.stringify({ report: 'contract-test', requestName, result, timestamp: new Date().toISOString() }, null, 2)
}
