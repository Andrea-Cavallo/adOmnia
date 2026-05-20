import type { RequestAssertion, AssertionResult, ResponseData } from '@/lib/types'

function resolveJsonPath(json: unknown, path: string): unknown {
  const parts = path.replace(/^\$\.?/, '').split('.')
  let current: unknown = json

  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined

    const bracketMatch = part.match(/^(\w+)\[(\d+)\]$/)
    if (bracketMatch) {
      const obj = current as Record<string, unknown>
      current = obj[bracketMatch[1]]
      if (Array.isArray(current)) {
        current = current[parseInt(bracketMatch[2])]
      } else {
        return undefined
      }
      continue
    }

    if (Array.isArray(current)) {
      const idx = parseInt(part)
      if (isNaN(idx)) return undefined
      current = current[idx]
      continue
    }

    current = (current as Record<string, unknown>)[part]
  }

  return current
}

function jsonType(val: unknown): string {
  if (val === null) return 'null'
  if (Array.isArray(val)) return 'array'
  return typeof val
}

export function evaluateAssertion(
  assertion: RequestAssertion,
  response: ResponseData,
  parsedBody: unknown,
): { passed: boolean; actual: string } {
  const target = assertion.target
  const op = assertion.operator
  let actual = ''

  switch (target) {
    case 'statusCode': {
      actual = String(response.status)
      const expected = assertion.expected ?? ''

      switch (op) {
        case 'eq': return { passed: actual === expected, actual }
        case 'neq': return { passed: actual !== expected, actual }
        case 'contains': return { passed: actual.includes(expected), actual }
        case 'gt': {
          const a = parseInt(actual)
          const e = parseInt(expected)
          return { passed: !isNaN(a) && !isNaN(e) && a > e, actual: `${actual} > ${expected}` }
        }
        case 'lt': {
          const a = parseInt(actual)
          const e = parseInt(expected)
          return { passed: !isNaN(a) && !isNaN(e) && a < e, actual: `${actual} < ${expected}` }
        }
        default: return { passed: false, actual: `unsupported operator ${op}` }
      }
    }

    case 'responseTime': {
      actual = String(response.ms)
      const expected = assertion.expected ?? ''
      const a = response.ms
      const e = parseInt(expected)

      switch (op) {
        case 'lt': return { passed: !isNaN(e) && a < e, actual: `${a}ms < ${e}ms` }
        case 'lte': return { passed: !isNaN(e) && a <= e, actual: `${a}ms <= ${e}ms` }
        case 'gt': return { passed: !isNaN(e) && a > e, actual: `${a}ms > ${e}ms` }
        case 'eq': return { passed: !isNaN(e) && a === e, actual: `${a}ms == ${e}ms` }
        default: return { passed: false, actual: `unsupported operator ${op}` }
      }
    }

    case 'header': {
      const headerName = assertion.headerName ?? ''
      const value = response.headers[headerName.toLowerCase()] ?? response.headers[headerName] ?? ''
      actual = value
      const expected = assertion.expected ?? ''

      switch (op) {
        case 'exists': return { passed: !!value, actual: value ? `"${value}"` : '(missing)' }
        case 'eq': return { passed: value === expected, actual: `"${value}"` }
        case 'contains': return { passed: value.includes(expected), actual: `"${value}"` }
        case 'not_contains': return { passed: !value.includes(expected), actual: `"${value}"` }
        case 'regex': {
          try { return { passed: new RegExp(expected).test(value), actual: `"${value}"` } }
          catch { return { passed: false, actual: `invalid regex` } }
        }
        default: return { passed: false, actual: `unsupported operator ${op}` }
      }
    }

    case 'bodyText': {
      actual = response.body
      const expected = assertion.expected ?? ''

      switch (op) {
        case 'contains': return { passed: actual.includes(expected), actual: `contains "${expected}"` }
        case 'not_contains': return { passed: !actual.includes(expected), actual: `doesn't contain "${expected}"` }
        case 'regex': {
          try { return { passed: new RegExp(expected).test(actual), actual: `matches regex` } }
          catch { return { passed: false, actual: `invalid regex` } }
        }
        case 'exists': return { passed: actual.length > 0, actual: `${actual.length} chars` }
        default: return { passed: false, actual: `unsupported operator ${op}` }
      }
    }

    case 'xmlPath': {
      const path = assertion.path ?? ''
      const expected = assertion.expected ?? ''
      let val: string | undefined

      try {
        const parser = new DOMParser()
        const doc = parser.parseFromString(response.body, 'text/xml')
        const nodes = doc.evaluate(path, doc, null, XPathResult.ANY_TYPE, null)
        let node = nodes.iterateNext()
        if (node) {
          val = node.textContent ?? (node as Element).outerHTML
        }
      } catch {
        val = undefined
      }

      switch (op) {
        case 'exists': {
          actual = val !== undefined ? `found` : '(missing)'
          return { passed: val !== undefined, actual }
        }
        case 'eq': {
          actual = val ?? '(missing)'
          return { passed: val === expected, actual }
        }
        case 'contains': {
          actual = val ?? '(missing)'
          return { passed: (val ?? '').includes(expected), actual }
        }
        case 'regex': {
          actual = val ?? '(missing)'
          try { return { passed: new RegExp(expected).test(val ?? ''), actual } }
          catch { return { passed: false, actual: 'invalid regex' } }
        }
        default: return { passed: false, actual: `unsupported operator ${op}` }
      }
    }

    case 'jsonPath': {
      const path = assertion.path ?? ''
      const val = resolveJsonPath(parsedBody, path)
      const expected = assertion.expected ?? ''

      switch (op) {
        case 'exists': {
          actual = val !== undefined ? jsonType(val) : '(missing)'
          return { passed: val !== undefined, actual }
        }
        case 'eq': {
          actual = val !== undefined ? String(val) : '(missing)'
          return { passed: String(val) === expected, actual }
        }
        case 'neq': {
          actual = val !== undefined ? String(val) : '(missing)'
          return { passed: String(val) !== expected, actual }
        }
        case 'contains': {
          actual = val !== undefined ? String(val) : '(missing)'
          return { passed: String(val).includes(expected), actual }
        }
        case 'regex': {
          actual = val !== undefined ? String(val) : '(missing)'
          try { return { passed: new RegExp(expected).test(String(val)), actual } }
          catch { return { passed: false, actual: 'invalid regex' } }
        }
        case 'type': {
          const t = val !== undefined ? jsonType(val) : 'undefined'
          actual = t
          return { passed: t === (assertion.type ?? 'string'), actual }
        }
        case 'gt': {
          const n = parseFloat(String(val))
          const e = parseFloat(expected)
          actual = val !== undefined ? String(val) : '(missing)'
          return { passed: !isNaN(n) && !isNaN(e) && n > e, actual }
        }
        case 'lt': {
          const n = parseFloat(String(val))
          const e = parseFloat(expected)
          actual = val !== undefined ? String(val) : '(missing)'
          return { passed: !isNaN(n) && !isNaN(e) && n < e, actual }
        }
        case 'lte': {
          const n = parseFloat(String(val))
          const e = parseFloat(expected)
          actual = val !== undefined ? String(val) : '(missing)'
          return { passed: !isNaN(n) && !isNaN(e) && n <= e, actual }
        }
        case 'gte': {
          const n = parseFloat(String(val))
          const e = parseFloat(expected)
          actual = val !== undefined ? String(val) : '(missing)'
          return { passed: !isNaN(n) && !isNaN(e) && n >= e, actual }
        }
        default: return { passed: false, actual: `unsupported operator ${op}` }
      }
    }

    case 'contentType': {
      actual = response.contentType
      const expected = assertion.expected ?? ''

      switch (op) {
        case 'contains': return { passed: actual.includes(expected), actual }
        case 'eq': return { passed: actual.split(';')[0].trim() === expected.split(';')[0].trim(), actual }
        case 'exists': return { passed: !!actual, actual }
        default: return { passed: false, actual: `unsupported operator ${op}` }
      }
    }

    case 'arrayLength': {
      const path = assertion.path ?? ''
      const val = resolveJsonPath(parsedBody, path)
      const expected = assertion.expected ?? ''
      if (!Array.isArray(val)) {
        actual = val !== undefined ? `${jsonType(val)} (not array)` : '(missing)'
        return { passed: false, actual }
      }
      actual = String(val.length)
      const expectedNum = parseInt(expected)
      switch (op) {
        case 'eq': return { passed: val.length === expectedNum, actual: `${val.length} items` }
        case 'neq': return { passed: val.length !== expectedNum, actual: `${val.length} items` }
        case 'gt': return { passed: !isNaN(expectedNum) && val.length > expectedNum, actual: `${val.length} items` }
        case 'lt': return { passed: !isNaN(expectedNum) && val.length < expectedNum, actual: `${val.length} items` }
        case 'gte': return { passed: !isNaN(expectedNum) && val.length >= expectedNum, actual: `${val.length} items` }
        case 'lte': return { passed: !isNaN(expectedNum) && val.length <= expectedNum, actual: `${val.length} items` }
        default: return { passed: false, actual: `unsupported operator ${op}` }
      }
    }

    case 'schema': {
      // Schema validation is done by contractValidator, skip here
      actual = 'delegated to Contract tab'
      return { passed: true, actual }
    }

    default:
      return { passed: false, actual: `unknown target ${target}` }
  }
}

export function evaluateAssertions(
  assertions: RequestAssertion[] | undefined,
  response: ResponseData,
): AssertionResult[] {
  if (!assertions || assertions.length === 0) return []

  let parsedBody: unknown = undefined
  try {
    parsedBody = JSON.parse(response.body)
  } catch {
    // not JSON, use as string
  }

  return assertions
    .filter((a) => a.enabled)
    .map((a) => {
      const { passed, actual } = evaluateAssertion(a, response, parsedBody)

      const targetLabel = (() => {
        switch (a.target) {
          case 'statusCode': return 'Status'
          case 'responseTime': return 'Time'
          case 'header': return `Header '${a.headerName ?? ''}'`
          case 'bodyText': return 'Body'
          case 'jsonPath': return `$.${a.path ?? ''}`
          case 'xmlPath': return `${a.path ?? ''}`
          case 'contentType': return 'Content-Type'
          case 'schema': return 'Schema'
          case 'arrayLength': return `$.${a.path ?? ''} length`
        }
      })()

      const opLabel = (() => {
        switch (a.operator) {
          case 'eq': return 'equals'
          case 'neq': return '!='
          case 'gt': return '>'
          case 'lt': return '<'
          case 'gte': return '>='
          case 'lte': return '<='
          case 'contains': return 'contains'
          case 'not_contains': return '!contains'
          case 'regex': return 'matches'
          case 'exists': return 'exists'
          case 'type': return `type=${a.type ?? ''}`
        }
      })()

      return {
        assertionId: a.id,
        passed,
        label: `${targetLabel} ${opLabel} ${a.expected ?? ''}`,
        actual,
        expected: a.expected ?? '',
      }
    })
}

export function blankAssertion(): RequestAssertion {
  return {
    id: Math.random().toString(36).slice(2, 10),
    enabled: true,
    target: 'statusCode',
    operator: 'eq',
    expected: '200',
  }
}

export function pmCompatSnippet(assertion: RequestAssertion): string {
  const e = assertion.expected ? `"${assertion.expected}"` : ''
  const p = assertion.path ? `"${assertion.path}"` : ''
  const h = assertion.headerName ? `"${assertion.headerName}"` : ''

  switch (assertion.target) {
    case 'statusCode':
      if (assertion.operator === 'eq') return `pm.test("Status is ${assertion.expected}", () => {\n  pm.expect(pm.response.code).to.equal(${assertion.expected});\n});`
      return `pm.test("Status code check", () => {\n  pm.expect(pm.response.code).to.equal(/* expected */);\n});`
    case 'responseTime':
      return `pm.test("Response time < ${assertion.expected}ms", () => {\n  pm.expect(pm.response.responseTime).to.be.below(${assertion.expected ?? '2000'});\n});`
    case 'header':
      if (assertion.operator === 'exists') return `pm.test("Header ${h} exists", () => {\n  pm.expect(pm.response.headers.has(${h})).to.be.true;\n});`
      return `pm.test("Header check", () => {\n  pm.expect(pm.response.headers.get(${h})).to.include(${e});\n});`
    case 'jsonPath':
      if (assertion.operator === 'exists') return `pm.test("JSON path ${p} exists", () => {\n  pm.expect(pm.response.json().${p}).to.exist;\n});`
      if (assertion.operator === 'eq') return `pm.test("JSON path equals", () => {\n  pm.expect(pm.response.json().${p}).to.equal(${e});\n});`
      if (assertion.operator === 'type') return `pm.test("JSON path type is ${assertion.type}", () => {\n  pm.expect(pm.response.json().${p}).to.be.a("${assertion.type}");\n});`
      return `pm.test("JSON path check", () => {\n  pm.expect(pm.response.json().${p}).to.be.ok;\n});`
    case 'bodyText':
      return `pm.test("Body contains text", () => {\n  pm.expect(pm.response.text()).to.include(${e});\n});`
    default:
      return `// pm.test("...", () => { ... })`
  }
}
