import { describe, expect, it } from 'vitest'
import { BUILTIN_DIAGNOSTIC_RULES, evaluateDiagnosticRules, importDiagnosticRules } from './diagnosticRules'
import { parseLogText } from './parse'

describe('versioned diagnostic rules', () => {
  it('requires the declared threshold before reporting a retry storm', () => {
    const parse = (count: number) => parseLogText(Array.from({ length: count }, (_, index) => JSON.stringify({ timestamp: `2026-09-15T10:00:0${index}Z`, correlation_id: 'c1', service: 'orders', message: `retry attempt ${index + 1}` })).join('\n')).events
    expect(evaluateDiagnosticRules(parse(2), BUILTIN_DIAGNOSTIC_RULES).some((finding) => finding.ruleId === 'retry-storm')).toBe(false)
    const finding = evaluateDiagnosticRules(parse(3), BUILTIN_DIAGNOSTIC_RULES).find((item) => item.ruleId === 'retry-storm')
    expect(finding).toMatchObject({ ruleVersion: '1.0.0', eventIds: [0, 1, 2] })
    expect(finding?.sourceLines).toHaveLength(3)
  })

  it('imports portable rules and rejects invalid regex', () => {
    expect(importDiagnosticRules(JSON.stringify(BUILTIN_DIAGNOSTIC_RULES[0]))).toHaveLength(1)
    const invalid = { ...BUILTIN_DIAGNOSTIC_RULES[0], all: [{ field: 'text', operator: 'matches', value: '[' }] }
    expect(() => importDiagnosticRules(JSON.stringify(invalid))).toThrow(/invalid regex/i)
  })
})
