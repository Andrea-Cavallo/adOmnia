import { describe, expect, it } from 'vitest'
import type { GoIDECoverageReport } from '@/lib/goide-tests-api'
import { coverageForDocument, coverageLineStates } from './goStudioCoverage'

const block = (startLine: number, endLine: number, covered: boolean) => ({ startLine, startColumn: 1, endLine, endColumn: 1, covered })
const report = {
  mode: 'set', statements: 3, covered: 2, percent: 66.7, packages: [], generatedAt: '',
  files: [{ importPath: 'x/a.go', relativePath: 'a.go', statements: 3, covered: 2, percent: 66.7, diskToken: 'tok', blocks: [block(3, 5, true), block(5, 6, false), block(8, 8, false)] }],
} as unknown as GoIDECoverageReport

describe('coverage overlay', () => {
  it('marks lines covered, uncovered or partial', () => {
    const states = coverageLineStates(report.files[0])
    expect([3, 4, 5, 6, 8].map((line) => states.get(line))).toEqual(['covered', 'covered', 'partial', 'uncovered', 'uncovered'])
    expect(states.has(7)).toBe(false)
  })

  it('applies only to the exact content that was measured', () => {
    expect(coverageForDocument(report, 'a.go', 'tok', false).state).toBe('current')
    expect(coverageForDocument(report, 'a.go', 'tok', true).state).toBe('stale')
    expect(coverageForDocument(report, 'a.go', 'other', false).state).toBe('stale')
    expect(coverageForDocument(report, 'b.go', 'tok', false).state).toBe('none')
    expect(coverageForDocument(null, 'a.go', 'tok', false).state).toBe('none')
  })
})
