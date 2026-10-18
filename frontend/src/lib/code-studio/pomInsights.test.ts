import { describe, expect, it } from 'vitest'
import type { PomDependency, VersionInfo } from '../../../bindings/adomnia/internal/languages/java/models'
import type { SecurityFinding } from '../securityIntel-api'
import { compareVersions, dependencyStatuses, projectRootOf, updateEdit, versionRequest } from './pomInsights'

const jackson = { groupId: 'com.fasterxml.jackson.core', artifactId: 'jackson-databind', version: '${jackson.version}', section: 'dependencies', resolved: '2.15.0', property: 'jackson.version', line: 14, startColumn: 16, endColumn: 34, propertyLine: 8, propertyStartColumn: 22, propertyEndColumn: 28 } as PomDependency
const web = { groupId: 'org.springframework.boot', artifactId: 'spring-boot-starter-web', version: '', section: 'dependencies', resolved: '', line: 19, startColumn: 19, endColumn: 42 } as PomDependency
const literal = { groupId: 'a', artifactId: 'b', version: '1.0', section: 'dependencies', resolved: '1.0', line: 3, startColumn: 14, endColumn: 17 } as PomDependency

function finding(name: string, version: string, id: string, band: string, fixed: string): SecurityFinding {
  return { id, advisory: { id, summary: 'x', severity: {} }, component: { name, version }, risk: { band }, remediation: { fixedVersion: fixed } } as unknown as SecurityFinding
}

describe('updateEdit', () => {
  it('writes into the property when the version is ${…}, into <version> otherwise', () => {
    expect(updateEdit(jackson, '2.16.0')).toEqual({ line: 8, startColumn: 22, endColumn: 28, text: '2.16.0' })
    expect(updateEdit(literal, '1.1')).toEqual({ line: 3, startColumn: 14, endColumn: 17, text: '1.1' })
  })
  it('refuses a version managed outside this file', () => {
    expect(updateEdit(web, '3.0.0')).toBeNull()
  })
})

describe('dependencyStatuses', () => {
  it('attaches CVEs of the resolved version, worst first, and the highest fix', () => {
    const findings = [
      finding('com.fasterxml.jackson.core:jackson-databind', '2.15.0', 'CVE-2', 'medium', '2.15.1'),
      finding('com.fasterxml.jackson.core:jackson-databind', '2.15.0', 'CVE-1', 'critical', '2.15.4'),
      finding('com.fasterxml.jackson.core:jackson-databind', '2.9.0', 'CVE-OLD', 'high', '2.9.9'),
    ]
    const versions: VersionInfo[] = [{ key: 'com.fasterxml.jackson.core:jackson-databind', current: '2.15.0', latest: '2.17.0', sameMajor: '2.17.0', newer: true }]
    const [status] = dependencyStatuses([jackson], versions, findings)
    expect(status.vulnerabilities.map((item) => item.id)).toEqual(['CVE-1', 'CVE-2'])
    expect(status.worst).toBe('critical')
    expect(status.fixVersion).toBe('2.15.4')
    expect(status.version?.latest).toBe('2.17.0')
  })
  it('ignores suppressed findings', () => {
    const suppressed = { ...finding('a:b', '1.0', 'CVE-S', 'high', '1.1'), ignored: { reason: 'accepted' } } as SecurityFinding
    expect(dependencyStatuses([literal], [], [suppressed])[0].worst).toBeNull()
  })
})

describe('helpers', () => {
  it('compares versions numerically per component', () => {
    expect(compareVersions('2.10.0', '2.9.9')).toBeGreaterThan(0)
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
  })
  it('asks Maven Central only for versions written in this pom', () => {
    expect(versionRequest([jackson, web, literal])).toEqual({ 'com.fasterxml.jackson.core:jackson-databind': '2.15.0', 'a:b': '1.0' })
  })
  it('derives the project root from absolute and relative paths', () => {
    expect(projectRootOf('C:\\work\\app\\billing\\pom.xml', 'billing/pom.xml')).toBe('C:/work/app')
  })
})
