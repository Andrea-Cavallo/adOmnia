import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SecurityFinding, SecurityScanReport } from '@/lib/securityIntel-api'

const api = vi.hoisted(() => ({
  previewSecurityUpgrade: vi.fn(),
  planSecurityUpgrade: vi.fn(),
  runSecurityUpgradeStep: vi.fn(),
  finishSecurityUpgrade: vi.fn(),
  putSecuritySuppression: vi.fn(),
  removeSecuritySuppression: vi.fn(),
}))
vi.mock('@/lib/securityIntel-api', () => api)

import { SecurityUpgradeFlow } from './SecurityUpgradeFlow'
import { SecurityFindingInspector } from './SecurityFindingInspector'

function finding(remediation: SecurityFinding['remediation']): SecurityFinding {
  return {
    id: 'Go:example.com/lib@1.2.3|CVE-2024-0001',
    advisory: {
      id: 'GO-2024-0001',
      aliases: ['CVE-2024-0001'],
      summary: 'memory corruption in the parser',
      severity: { cvss31Score: 9, baseSeverity: 'CRITICAL' },
    },
    component: {
      ecosystem: 'Go',
      name: 'example.com/lib',
      version: '1.2.3',
      origin: 'declared',
      exposure: 'runtime',
      manifest: '/work/lib.manifest',
      direct: true,
    },
    reachability: 'called',
    evidence: { confirmed: true, note: 'called by project code' },
    risk: {
      priority: 'P0',
      band: 'critical',
      score: 9,
      reasons: ['KEV finding'],
      signals: {
        cvssScore: 9,
        cvssClass: 'CRITICAL',
        epss: 0.4,
        kev: true,
        reachability: 'called',
        exposure: 'runtime',
        fixAvailable: true,
        direct: true,
      },
    },
    remediation,
  }
}

const report = { workspace: '/work', scannedAt: '2026-10-18T00:00:00Z', units: [], findings: [], summary: {} } as unknown as SecurityScanReport

const upgradeRemediation: SecurityFinding['remediation'] = {
  strategy: 'upgrade',
  currentVersion: '1.2.3',
  fixedVersion: '1.2.4',
  direct: true,
  compatibility: 'patch',
}

describe('safe remediation flow', () => {
  it('offers preview, checks and apply for an applicable fix', () => {
    const html = renderToStaticMarkup(
      <SecurityUpgradeFlow
        finding={finding(upgradeRemediation)}
        report={report}
        workspace="/work"
        scanOptions={{ allowProcesses: false }}
      />,
    )
    expect(html).toContain('example.com/lib')
    expect(html).toContain('value="1.2.4"')
    expect(html).toContain('Preview impact')
    // Il diff e i passi compaiono solo dopo aver preparato la modifica.
    expect(html).not.toContain('Manifest diff')
    expect(html).not.toContain('Apply change')
  })

  it('shows the blocked reason instead of a remediation flow that would fail', () => {
    const html = renderToStaticMarkup(
      <SecurityFindingInspector
        finding={finding({ ...upgradeRemediation, blocked: true, blockedReason: 'the version is managed by an imported BOM' })}
        report={report}
        workspace="/work"
        scanOptions={{}}
        onClose={() => {}}
      />,
    )
    expect(html).toContain('the version is managed by an imported BOM')
    expect(html).not.toContain('Preview impact')
  })
})
