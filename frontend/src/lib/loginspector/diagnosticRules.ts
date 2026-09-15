import { operationalContext } from './analyze'
import { buildLookup, flattenPayload } from './normalize'
import type { LogEvent } from './types'

export const DIAGNOSTIC_RULE_SCHEMA_VERSION = 1 as const
export const DIAGNOSTIC_RULES_STORAGE_KEY = 'adomnia.loginspector.diagnostic-rules.v1'

export type DiagnosticOperator = 'contains' | 'matches' | 'equals' | 'exists' | 'gte' | 'lte'
export type DiagnosticScope = 'correlation' | 'service' | 'route' | 'global'

export interface DiagnosticCondition {
  field: string
  operator: DiagnosticOperator
  value?: string | number | boolean
}

export interface DiagnosticRule {
  schemaVersion: typeof DIAGNOSTIC_RULE_SCHEMA_VERSION
  id: string
  version: string
  name: string
  description?: string
  enabled: boolean
  severity: 'info' | 'warn' | 'error'
  scope: DiagnosticScope
  all: DiagnosticCondition[]
  minMatches: number
  withinMs?: number
  evidence: string
  action: string
}

export interface DiagnosticRuleFinding {
  ruleId: string
  ruleVersion: string
  ruleName: string
  severity: DiagnosticRule['severity']
  scopeKey: string
  evidence: string
  action: string
  eventIds: number[]
  sourceLines: { source: string; line: number }[]
}

export const BUILTIN_DIAGNOSTIC_RULES: DiagnosticRule[] = [
  {
    schemaVersion: 1, id: 'circuit-breaker-open', version: '1.0.0', name: 'Circuit breaker open', enabled: true,
    severity: 'error', scope: 'correlation', all: [{ field: 'text', operator: 'matches', value: 'circuit[ -]?breaker.*(?:open|reject)' }], minMatches: 1,
    evidence: 'The log explicitly reports an open or rejecting circuit breaker.', action: 'Inspect the breaker state, its failure window and the protected downstream.',
  },
  {
    schemaVersion: 1, id: 'retry-storm', version: '1.0.0', name: 'Retry storm', enabled: true,
    severity: 'warn', scope: 'correlation', all: [{ field: 'text', operator: 'matches', value: '\\bretr(?:y|ied|ying|ies)\\b|attempt\\s+\\d+' }], minMatches: 3, withinMs: 30_000,
    evidence: 'At least three explicit retry signals occur in one correlated chain within 30 seconds.', action: 'Verify the retry limit, backoff, jitter and idempotency behavior.',
  },
  {
    schemaVersion: 1, id: 'pool-exhausted', version: '1.0.0', name: 'Connection pool exhausted', enabled: true,
    severity: 'error', scope: 'service', all: [{ field: 'text', operator: 'matches', value: '(?:pool.*(?:exhausted|timeout)|no available connections|waiting for (?:a )?connection)' }], minMatches: 1,
    evidence: 'The log contains an explicit connection-pool exhaustion signal.', action: 'Inspect pool capacity, checkout time, leaked connections and downstream latency.',
  },
  {
    schemaVersion: 1, id: 'explicit-duplicate', version: '1.0.0', name: 'Duplicate operation reported', enabled: true,
    severity: 'warn', scope: 'correlation', all: [{ field: 'text', operator: 'matches', value: '(?:duplicate (?:request|operation|message)|already processed|idempotency.*replay)' }], minMatches: 1,
    evidence: 'The application explicitly labels the operation as duplicated or already processed.', action: 'Compare request/idempotency IDs and verify whether the duplicate was safely rejected.',
  },
]

function fieldValue(event: LogEvent, field: string): unknown {
  const context = operationalContext(event)
  const known: Record<string, unknown> = {
    text: `${event.message}\n${event.stack}\n${event.raw}`,
    level: event.level,
    service: context.service,
    route: context.httpRoute || context.httpUrl,
    status: context.httpStatus,
    durationMs: context.durationMs,
    correlationId: event.correlationId,
    traceId: event.traceId,
    requestId: event.requestId,
  }
  if (field in known) return known[field]
  if (!event.json || typeof event.json !== 'object' || Array.isArray(event.json)) return undefined
  return buildLookup(flattenPayload(event.json as Record<string, unknown>)).get(field)?.value
}

function conditionMatches(event: LogEvent, condition: DiagnosticCondition): boolean {
  const actual = fieldValue(event, condition.field)
  if (condition.operator === 'exists') return actual !== undefined && actual !== null && actual !== ''
  if (actual === undefined || actual === null) return false
  if (condition.operator === 'equals') return String(actual) === String(condition.value ?? '')
  if (condition.operator === 'contains') return String(actual).toLowerCase().includes(String(condition.value ?? '').toLowerCase())
  if (condition.operator === 'matches') {
    try { return new RegExp(String(condition.value ?? ''), 'i').test(String(actual)) } catch { return false }
  }
  const left = Number(actual)
  const right = Number(condition.value)
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false
  return condition.operator === 'gte' ? left >= right : left <= right
}

function scopeKey(event: LogEvent, scope: DiagnosticScope): string {
  if (scope === 'global') return 'all events'
  if (scope === 'service') return event.service || '(unknown service)'
  if (scope === 'route') {
    const context = operationalContext(event)
    return context.httpRoute || context.httpUrl || '(unknown route)'
  }
  return event.correlationId || event.traceId || event.requestId || `uncorrelated:${event.id}`
}

function satisfiesWindow(events: LogEvent[], withinMs: number | undefined): boolean {
  if (!withinMs) return true
  const timestamps = events.map((event) => event.ts).filter((value): value is number => value !== null)
  if (timestamps.length !== events.length) return false
  return Math.max(...timestamps) - Math.min(...timestamps) <= withinMs
}

export function evaluateDiagnosticRules(events: LogEvent[], rules: DiagnosticRule[]): DiagnosticRuleFinding[] {
  const findings: DiagnosticRuleFinding[] = []
  for (const rule of rules.filter((item) => item.enabled)) {
    const matched = events.filter((event) => rule.all.every((condition) => conditionMatches(event, condition)))
    const groups = new Map<string, LogEvent[]>()
    for (const event of matched) {
      const key = scopeKey(event, rule.scope)
      groups.set(key, [...(groups.get(key) ?? []), event])
    }
    for (const [key, group] of groups) {
      if (group.length < Math.max(1, rule.minMatches) || !satisfiesWindow(group, rule.withinMs)) continue
      findings.push({
        ruleId: rule.id,
        ruleVersion: rule.version,
        ruleName: rule.name,
        severity: rule.severity,
        scopeKey: key,
        evidence: `${rule.evidence} Matched ${group.length} event(s).`,
        action: rule.action,
        eventIds: group.map((event) => event.id),
        sourceLines: group.map((event) => ({ source: event.sourceName || event.sourceId || 'source', line: event.line })),
      })
    }
  }
  return findings.sort((a, b) => b.eventIds.length - a.eventIds.length || a.ruleName.localeCompare(b.ruleName))
}

export function validateDiagnosticRule(value: unknown): { rule?: DiagnosticRule; errors: string[] } {
  const errors: string[] = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { errors: ['Rule must be a JSON object.'] }
  const rule = value as DiagnosticRule
  if (rule.schemaVersion !== 1) errors.push('schemaVersion must be 1.')
  if (!rule.id || !/^[a-z0-9][a-z0-9._-]+$/i.test(rule.id)) errors.push('A stable id is required.')
  if (!rule.version || !rule.name) errors.push('version and name are required.')
  if (!['info', 'warn', 'error'].includes(rule.severity)) errors.push('severity must be info, warn or error.')
  if (!['correlation', 'service', 'route', 'global'].includes(rule.scope)) errors.push('scope is invalid.')
  if (!Array.isArray(rule.all) || !rule.all.length) errors.push('At least one condition is required.')
  else for (const condition of rule.all) {
    if (!condition.field || !['contains', 'matches', 'equals', 'exists', 'gte', 'lte'].includes(condition.operator)) errors.push('A condition has an invalid field or operator.')
    if (condition.operator === 'matches') try { new RegExp(String(condition.value ?? '')) } catch { errors.push(`Invalid regex for ${condition.field}.`) }
  }
  if (!Number.isInteger(rule.minMatches) || rule.minMatches < 1) errors.push('minMatches must be a positive integer.')
  if (!rule.evidence || !rule.action) errors.push('evidence and action are required.')
  return errors.length ? { errors } : { rule, errors }
}

export function importDiagnosticRules(text: string): DiagnosticRule[] {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { throw new Error('Diagnostic rules are not valid JSON.') }
  const items = Array.isArray(parsed) ? parsed : [parsed]
  return items.map((item) => {
    const checked = validateDiagnosticRule(item)
    if (!checked.rule) throw new Error(checked.errors.join(' '))
    return checked.rule
  })
}

export function loadDiagnosticRules(): DiagnosticRule[] {
  if (typeof localStorage === 'undefined') return BUILTIN_DIAGNOSTIC_RULES
  try {
    const stored = localStorage.getItem(DIAGNOSTIC_RULES_STORAGE_KEY)
    return stored ? importDiagnosticRules(stored) : BUILTIN_DIAGNOSTIC_RULES
  } catch { return BUILTIN_DIAGNOSTIC_RULES }
}

export function saveDiagnosticRules(rules: DiagnosticRule[]): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(DIAGNOSTIC_RULES_STORAGE_KEY, JSON.stringify(rules))
}
