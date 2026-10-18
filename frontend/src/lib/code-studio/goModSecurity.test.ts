import { describe, expect, it } from 'vitest'
import { goModStatuses, goModVersionEdit, goVersion } from './goModSecurity'
import type { SecurityFinding } from '../securityIntel-api'

const finding = (name: string, version: string, id: string, band: string, fixed?: string, ignored = false) => ({
  advisory: { id, summary: `${id} summary` }, component: { name, version }, risk: { band }, remediation: { fixedVersion: fixed }, ignored: ignored ? { reason: 'x' } : null,
}) as unknown as SecurityFinding

describe('goModStatuses', () => {
  const requirements = [
    { line: 3, path: 'golang.org/x/net', version: 'v0.10.0', indirect: false },
    { line: 4, path: 'github.com/a/b', version: 'v1.0.0', indirect: true },
  ]
  it('matches findings by module and version, worst first, with the highest fix', () => {
    const [net, other] = goModStatuses(requirements, [
      finding('golang.org/x/net', 'v0.10.0', 'GO-1', 'medium', '0.17.0'),
      finding('golang.org/x/net', 'v0.10.0', 'GO-2', 'critical', '0.23.0'),
      finding('golang.org/x/net', 'v0.9.0', 'GO-3', 'high', '0.9.1'),
    ])
    expect(net.vulnerabilities.map((item) => item.id)).toEqual(['GO-2', 'GO-1'])
    expect(net.worst).toBe('critical')
    expect(net.fixVersion).toBe('0.23.0')
    expect(other.worst).toBeNull()
  })
  it('skips suppressed findings', () => {
    expect(goModStatuses(requirements, [finding('golang.org/x/net', 'v0.10.0', 'GO-1', 'high', '0.11.0', true)])[0].worst).toBeNull()
  })
})

describe('goModVersionEdit', () => {
  const requirement = { line: 4, path: 'github.com/a/b', version: 'v1.0.0', indirect: true }
  it('replaces only the version token and adds the v prefix', () => {
    const line = '\tgithub.com/a/b v1.0.0 // indirect'
    const edit = goModVersionEdit(line, requirement, '1.2.3')!
    expect(line.slice(0, edit.startColumn - 1) + edit.text + line.slice(edit.endColumn - 1)).toBe('\tgithub.com/a/b v1.2.3 // indirect')
  })
  it('refuses a line that no longer holds the requirement', () => {
    expect(goModVersionEdit('\tgithub.com/a/b v1.1.0', requirement, '1.2.3')).toBeNull()
  })
  it('keeps an existing v', () => expect(goVersion('v2.0.0')).toBe('v2.0.0'))
})
