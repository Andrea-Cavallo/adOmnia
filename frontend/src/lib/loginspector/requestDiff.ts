import { operationalContext, type AnalyzedRequest } from './analyze'
import type { LogEvent } from './types'

export type PayloadDifferenceKind = 'missing-left' | 'missing-right' | 'type' | 'value'

export interface PayloadDifference {
  path: string
  kind: PayloadDifferenceKind
  left: unknown
  right: unknown
}

export interface RequestPayloadDiff {
  leftBody: unknown | null
  rightBody: unknown | null
  differences: PayloadDifference[]
  ignoredPaths: string[]
}

export const DEFAULT_VOLATILE_PATHS = ['timestamp', 'time', 'traceId', 'correlationId', 'requestId', 'spanId']

function requestBody(events: LogEvent[], request: AnalyzedRequest): unknown | null {
  const ids = new Set(request.eventIds)
  for (let index = events.length - 1; index >= 0; index--) {
    if (!ids.has(events[index].id)) continue
    const body = operationalContext(events[index]).requestBody
    if (body !== null) return body
  }
  return null
}

function valueType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function jsonPath(parent: string, key: string): string {
  if (/^[A-Za-z_$][\w$]*$/.test(key)) return `${parent}.${key}`
  return `${parent}[${JSON.stringify(key)}]`
}

function ignored(path: string, patterns: string[]): boolean {
  const leaf = path.replace(/\[\d+\]$/, '').split('.').pop() || ''
  return patterns.some((pattern) => path === pattern || path === `$.${pattern}` || leaf === pattern || path.startsWith(`${pattern}.`))
}

export function diffPayloads(left: unknown, right: unknown, ignoredPaths: string[] = DEFAULT_VOLATILE_PATHS): PayloadDifference[] {
  const differences: PayloadDifference[] = []
  const visit = (a: unknown, b: unknown, path: string) => {
    if (ignored(path, ignoredPaths)) return
    if (a === undefined) { differences.push({ path, kind: 'missing-left', left: a, right: b }); return }
    if (b === undefined) { differences.push({ path, kind: 'missing-right', left: a, right: b }); return }
    if (valueType(a) !== valueType(b)) { differences.push({ path, kind: 'type', left: a, right: b }); return }
    if (a && b && typeof a === 'object') {
      if (Array.isArray(a) && Array.isArray(b)) {
        const length = Math.max(a.length, b.length)
        for (let index = 0; index < length; index++) visit(a[index], b[index], `${path}[${index}]`)
      } else if (!Array.isArray(a) && !Array.isArray(b)) {
        const leftObject = a as Record<string, unknown>
        const rightObject = b as Record<string, unknown>
        const keys = [...new Set([...Object.keys(leftObject), ...Object.keys(rightObject)])].sort()
        for (const key of keys) visit(leftObject[key], rightObject[key], jsonPath(path, key))
      }
      return
    }
    if (!Object.is(a, b)) differences.push({ path, kind: 'value', left: a, right: b })
  }
  visit(left, right, '$')
  return differences
}

export function compareRequestPayloads(
  events: LogEvent[],
  left: AnalyzedRequest,
  right: AnalyzedRequest,
  ignoredPaths: string[] = DEFAULT_VOLATILE_PATHS,
): RequestPayloadDiff {
  const leftBody = requestBody(events, left)
  const rightBody = requestBody(events, right)
  return { leftBody, rightBody, differences: diffPayloads(leftBody, rightBody, ignoredPaths), ignoredPaths }
}
