import { describe, expect, it } from 'vitest'
import type { GoIDEVulnReport } from '@/lib/goide-api'
import { countByLevel, frameLabel, frameLocation, upgradePreview, vulnLevel, vulnReportToMarkdown } from './goStudioVulns'

const report = {
  modulePath: 'example.com/shop', moduleDirectory: '/home/andrea/shop', scannedAt: '2026-10-03T10:00:00Z',
  scannerVersion: 'v1.1.4', databaseUpdated: '2026-09-30T18:00:00Z', goVersion: 'go1.26.5',
  findings: [
    {
      id: 'GO-2026-0001', aliases: ['CVE-2026-1111'], summary: 'DoS in HTTP/2 | frames', details: 'Crafted frames\nexhaust memory.', url: 'https://pkg.go.dev/vuln/GO-2026-0001',
      module: 'golang.org/x/net', foundVersion: 'v0.25.0', fixedVersion: 'v0.30.0', goModVersion: 'v0.25.0', level: 'called',
      symbols: ['Framer.ReadFrame'], dependencyPath: ['example.com/shop', 'github.com/acme/web', 'golang.org/x/net'], cvss: ['CVSS:3.1/AV:N/AC:L'],
      callPaths: [[
        { function: 'Serve', package: 'example.com/shop/api', relative: 'api/handler.go', file: '/home/andrea/shop/api/handler.go', line: 41, inProject: true },
        { function: 'ReadFrame', receiver: '*Framer', package: 'golang.org/x/net/http2', file: '/home/andrea/go/pkg/mod/golang.org/x/net@v0.25.0/http2/frame.go', line: 502, inProject: false },
      ]],
    },
    { id: 'GO-2026-0002', summary: 'Path traversal', url: 'https://pkg.go.dev/vuln/GO-2026-0002', module: 'github.com/acme/archive', foundVersion: 'v1.4.0', fixedVersion: 'v1.4.2', level: 'imported' },
    { id: 'GO-2026-0003', summary: 'net/http header smuggling', url: 'https://pkg.go.dev/vuln/GO-2026-0003', module: 'stdlib', foundVersion: 'v1.26.4', fixedVersion: 'v1.26.5', level: 'called' },
    { id: 'GO-2026-0004', summary: 'Weak default', url: 'https://pkg.go.dev/vuln/GO-2026-0004', module: 'github.com/acme/token', foundVersion: 'v0.9.0', level: 'required' },
  ],
} as unknown as GoIDEVulnReport

describe('vulnerability helpers', () => {
  it('maps reachability to priority', () => {
    expect(vulnLevel({ level: 'called' }).priority).toBe('High')
    expect(vulnLevel({ level: 'imported' }).priority).toBe('Medium')
    expect(vulnLevel({ level: 'whatever' }).priority).toBe('Low')
    expect(countByLevel(report.findings)).toEqual({ called: 2, imported: 1, required: 1 })
  })

  it('previews the upgrade without touching anything', () => {
    expect(upgradePreview(report.findings[0])).toMatchObject({ command: 'go get golang.org/x/net@v0.30.0', goModBefore: 'require golang.org/x/net v0.25.0', goModAfter: 'require golang.org/x/net v0.30.0' })
    expect(upgradePreview(report.findings[1])?.goModBefore).toBeNull()
    expect(upgradePreview(report.findings[1])?.goModAfter).toBe('require github.com/acme/archive v1.4.2 // indirect')
    expect(upgradePreview(report.findings[2])?.command).toBe('Upgrade Go to go1.26.5 or later')
    expect(upgradePreview(report.findings[3])).toBeNull()
  })

  it('labels frames and never exposes absolute paths', () => {
    const [entry, vulnerable] = report.findings[0].callPaths![0]
    expect(frameLabel(entry)).toBe('api.Serve')
    expect(frameLabel(vulnerable)).toBe('Framer.ReadFrame')
    expect(frameLocation(entry)).toBe('api/handler.go:41')
    expect(frameLocation(vulnerable)).toBe('frame.go:502')
  })
})

describe('vulnReportToMarkdown', () => {
  const markdown = vulnReportToMarkdown(report)

  it('explains, summarises and details every finding', () => {
    for (const text of ['# Go vulnerability report: example.com/shop', '## How to read this', '## Summary', '### GO-2026-0001: DoS in HTTP/2', '## Notes for the assistant']) {
      expect(markdown).toContain(text)
    }
    expect(markdown).toContain('| GO-2026-0001 | High (called) | golang.org/x/net | v0.25.0 | v0.30.0 | DoS in HTTP/2 \\| frames |')
    expect(markdown).toContain('| GO-2026-0004 | Low (required only) | github.com/acme/token | v0.9.0 | no fix yet | Weak default |')
    expect(markdown).toContain('1. `api.Serve` (api/handler.go:41) → `Framer.ReadFrame` (frame.go:502)')
    expect(markdown).toContain('Dependency path: example.com/shop → github.com/acme/web → golang.org/x/net')
    expect(markdown).toContain('> Crafted frames\n> exhaust memory.')
    expect(markdown).not.toContain('/home/andrea')
  })

  it('reports a clean scan', () => {
    expect(vulnReportToMarkdown({ ...report, findings: [] })).toContain('No known vulnerabilities affect this module.')
  })
})
