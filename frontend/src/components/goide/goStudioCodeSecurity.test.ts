import { describe, expect, it } from 'vitest'
import type { GoIDESecurityReport } from '@/lib/goide-api'
import { DEFAULT_SECURITY_FILTER, filterFindings, groupByCategory, inlineSuppressionComment, securityReportToMarkdown, summarize } from './goStudioCodeSecurity'

const finding = (overrides: Record<string, unknown>) => ({
  rule: 'go/sql-injection', category: 'Injection', severity: 'high', title: 'SQL built from strings', message: 'The SQL text is built with fmt.Sprintf.',
  file: 'store/repo.go', line: 88, fingerprint: 'f1', snippet: 'db.Query(fmt.Sprintf("SELECT * FROM t WHERE id=%s", id))', ...overrides,
})

const report = {
  root: '/home/andrea/shop', filesScanned: 42, truncated: false,
  rules: [
    { id: 'go/sql-injection', category: 'Injection', severity: 'high', title: 'SQL built from strings', description: 'Values can change the SQL.', remediation: 'Use placeholders.' },
    { id: 'secret/hardcoded', category: 'Secrets', severity: 'high', title: 'Hardcoded secret', description: 'Ends up in Git.', remediation: 'Rotate it.' },
    { id: 'go/weak-crypto', category: 'Crypto', severity: 'medium', title: 'Weak crypto', description: 'MD5 is broken.', remediation: 'Use SHA-256.' },
  ],
  findings: [
    finding({}),
    finding({ rule: 'secret/hardcoded', category: 'Secrets', file: 'config/app.go', line: 3, fingerprint: 'f2', title: 'Hardcoded secret', message: 'Possible AWS access key.', snippet: 'key = "AKIA••••••••"' }),
    finding({ rule: 'go/weak-crypto', category: 'Crypto', severity: 'medium', file: 'cache/key.go', line: 9, fingerprint: 'f3', suppressed: true, suppressionReason: 'checksum only' }),
    finding({ rule: 'go/weak-crypto', category: 'Crypto', severity: 'medium', file: 'legacy/hash.go', line: 4, fingerprint: 'f4', baselined: true }),
  ],
} as unknown as GoIDESecurityReport

describe('code security helpers', () => {
  it('summarises active, suppressed and baselined findings', () => {
    expect(summarize(report.findings)).toEqual({ active: { high: 2, medium: 0, low: 0 }, suppressed: 1, baselined: 1 })
  })

  it('hides reviewed findings unless asked, and filters by severity and text', () => {
    expect(filterFindings(report.findings, DEFAULT_SECURITY_FILTER).map((item) => item.fingerprint)).toEqual(['f1', 'f2'])
    expect(filterFindings(report.findings, { ...DEFAULT_SECURITY_FILTER, showSuppressed: true, showBaselined: true }).length).toBe(4)
    expect(filterFindings(report.findings, { ...DEFAULT_SECURITY_FILTER, query: 'config/' }).map((item) => item.fingerprint)).toEqual(['f2'])
    expect(filterFindings(report.findings, { ...DEFAULT_SECURITY_FILTER, severity: 'medium', showBaselined: true }).map((item) => item.fingerprint)).toEqual(['f4'])
  })

  it('groups by category and builds the inline suppression comment', () => {
    expect(groupByCategory(report.findings).map((group) => group.category)).toEqual(['Injection', 'Secrets', 'Crypto'])
    expect(inlineSuppressionComment('go/weak-crypto', ' checksum only ')).toBe('// adomnia:security-ignore go/weak-crypto: checksum only')
  })

  it('exports only active findings with rule guidance for an assistant', () => {
    const markdown = securityReportToMarkdown(report, 'shop')
    expect(markdown).toContain('# Security review: shop')
    expect(markdown).toContain('| Active findings | 2 (high 2, medium 0, low 0) |')
    expect(markdown).toContain('| high | go/sql-injection | store/repo.go:88 | The SQL text is built with fmt.Sprintf. |')
    expect(markdown).toContain('- How to fix: Use placeholders.')
    expect(markdown).toContain('AKIA••••••••')
    expect(markdown).not.toContain('cache/key.go')
    expect(markdown).not.toContain('legacy/hash.go')
    expect(markdown).not.toContain('/home/andrea')
  })
})
