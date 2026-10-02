import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GoIDEDiagnosticsReport } from '@/lib/goide-lsp-api'
import { debtTrend, loadLintSamples, qualityBreakdown, recordLintSample } from './goStudioQualityHistory'

const values = new Map<string, string>()
beforeEach(() => {
  values.clear()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) })
})

describe('quality history', () => {
  it('records samples per project without duplicating repeated lint-on-save runs', () => {
    recordLintSample('/repo', { at: '2026-10-01T10:00:00Z', linter: 'staticcheck', issues: 12, baselined: 0 })
    recordLintSample('/repo', { at: '2026-10-01T10:05:00Z', linter: 'staticcheck', issues: 12, baselined: 0 })
    const samples = recordLintSample('/repo', { at: '2026-10-02T10:00:00Z', linter: 'staticcheck', issues: 3, baselined: 7 })
    expect(samples).toHaveLength(2)
    expect(loadLintSamples('/other')).toEqual([])
    expect(debtTrend(samples)).toEqual({ current: 10, first: 12, delta: -2, direction: 'better' })
    expect(debtTrend([])).toBeNull()
  })

  it('ranks linters and files by findings', () => {
    const report = (relativePath: string, ...items: [string, string][]) => ({ uri: relativePath, path: relativePath, relativePath, diagnostics: items.map(([source, code]) => ({ source, code })) }) as unknown as GoIDEDiagnosticsReport
    const breakdown = qualityBreakdown([report('a.go', ['staticcheck', 'SA4006'], ['staticcheck', 'SA4006']), report('b.go', ['errcheck', '']), report('c.go')])
    expect(breakdown.bySource).toEqual([{ name: 'staticcheck SA4006', count: 2 }, { name: 'errcheck', count: 1 }])
    expect(breakdown.byFile).toEqual([{ relativePath: 'a.go', count: 2 }, { relativePath: 'b.go', count: 1 }])
  })
})
