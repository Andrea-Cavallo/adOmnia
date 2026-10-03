import { describe, expect, it } from 'vitest'
import { filterSonarIssues, formatSonarIssue, formatSonarIssues, isSecurityIssue, sonarIssuesToAIFixTargets, sortSonarIssues, type SonarIssue } from './goStudioSonar'

function issue(overrides: Partial<SonarIssue> = {}): SonarIssue {
  return { key: 'k', rule: 'go:S1', severity: 'MAJOR', type: 'CODE_SMELL', message: 'msg', file: 'a.go', line: 3, ...overrides }
}

describe('goStudioSonar', () => {
  it('formats a problem like file:line [SEVERITY rule] message', () => {
    expect(formatSonarIssue(issue())).toBe('a.go:3 [MAJOR go:S1] msg')
    expect(formatSonarIssue(issue({ line: undefined, severity: 'CRITICAL', rule: 'go:S2' }))).toBe('a.go [CRITICAL go:S2] msg')
  })

  it('sorts by severity then file then line', () => {
    const sorted = sortSonarIssues([
      issue({ key: 'b', severity: 'MINOR', file: 'b.go' }),
      issue({ key: 'a', severity: 'BLOCKER', file: 'z.go' }),
      issue({ key: 'c', severity: 'MAJOR', file: 'a.go', line: 1 }),
      issue({ key: 'd', severity: 'MAJOR', file: 'a.go', line: 9 }),
    ])
    expect(sorted.map((item) => item.key)).toEqual(['a', 'c', 'd', 'b'])
    expect(formatSonarIssues([issue({ key: 'b', severity: 'MINOR' }), issue({ key: 'a', severity: 'BLOCKER' })])).toContain('a.go:3 [BLOCKER')
  })

  it('filters by query, severity and security', () => {
    const issues = [
      issue({ key: 'a', message: 'SQL injection', type: 'VULNERABILITY' }),
      issue({ key: 'b', message: 'unused variable', severity: 'MINOR' }),
    ]
    expect(filterSonarIssues(issues, {})).toHaveLength(2)
    expect(filterSonarIssues(issues, { query: 'injection' }).map((i) => i.key)).toEqual(['a'])
    expect(filterSonarIssues(issues, { severity: 'MINOR' }).map((i) => i.key)).toEqual(['b'])
    expect(filterSonarIssues(issues, { securityOnly: true }).map((i) => i.key)).toEqual(['a'])
    expect(isSecurityIssue(issues[0])).toBe(true)
    expect(isSecurityIssue(issues[1])).toBe(false)
  })

  it('ranks SonarQube 10 MQR severities and security quality', () => {
    const sorted = sortSonarIssues([issue({ key: 'low', severity: 'LOW' }), issue({ key: 'high', severity: 'HIGH' }), issue({ key: 'medium', severity: 'MEDIUM' })])
    expect(sorted.map((item) => item.key)).toEqual(['high', 'medium', 'low'])
    expect(isSecurityIssue(issue({ type: 'SECURITY' }))).toBe(true)
  })

  it('groups issues per file for the AI fixer', () => {
    const targets = sonarIssuesToAIFixTargets([
      issue({ key: 'a', file: 'x.go', line: 5, message: 'one' }),
      issue({ key: 'b', file: 'x.go', line: 2, message: 'two' }),
      issue({ key: 'c', file: 'y.go', line: 1 }),
    ])
    expect(targets.map((target) => target.relativePath)).toEqual(['x.go', 'y.go'])
    expect(targets[0].problems[0].line).toBe(2)
    expect(targets[0].problems[0].source).toContain('go:S1')
  })
})
