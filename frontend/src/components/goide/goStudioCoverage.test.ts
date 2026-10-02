import { describe, expect, it } from 'vitest'
import type { GoIDECoverageReport } from '@/lib/goide-tests-api'
import { coverageForDocument, coverageLineStates, functionsByCoverage, patchCoverage, untakenBranches } from './goStudioCoverage'

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

describe('function coverage', () => {
  it('lists functions from the least covered, skipping empty ones', () => {
    const fn = (name: string, line: number, statements: number, covered: number) => ({ name, line, statements, covered, percent: statements ? (covered * 100) / statements : 0 })
    const withFunctions = { ...report, files: [
      { ...report.files[0], relativePath: 'a.go', functions: [fn('Full', 1, 2, 2), fn('Half', 5, 4, 2), fn('Empty', 9, 0, 0)] },
      { ...report.files[0], relativePath: 'b.go', functions: [fn('Small', 1, 2, 1), fn('None', 4, 3, 0)] },
    ] } as unknown as GoIDECoverageReport
    expect(functionsByCoverage(withFunctions).map((item) => `${item.relativePath}:${item.name}`)).toEqual(['b.go:None', 'a.go:Half', 'b.go:Small', 'a.go:Full'])
  })
})

describe('patch coverage', () => {
  it('counts only statements in blocks that touch changed lines', () => {
    const statementBlock = (startLine: number, endLine: number, covered: boolean, statements: number) => ({ ...block(startLine, endLine, covered), statements })
    const withBlocks = { ...report, files: [
      { ...report.files[0], relativePath: 'a.go', blocks: [statementBlock(3, 5, true, 2), statementBlock(6, 8, false, 3), statementBlock(20, 22, false, 4)] },
      { ...report.files[0], relativePath: 'untouched.go', blocks: [statementBlock(1, 2, false, 5)] },
    ] } as unknown as GoIDECoverageReport
    const patch = patchCoverage(withBlocks, { 'a.go': [{ start: 4, end: 7 }], 'nocoverage.go': [{ start: 1, end: 9 }] })
    expect(patch).toEqual({ statements: 5, covered: 2, percent: 40, files: [{ relativePath: 'a.go', statements: 5, covered: 2, uncoveredLines: [6, 7] }] })
    expect(patchCoverage(withBlocks, {}).percent).toBe(0)
  })
})

describe('untaken branches', () => {
  it('lists branches never taken with readable labels', () => {
    const withBranches = { ...report, files: [
      { ...report.files[0], relativePath: 'b.go', branches: [{ line: 9, kind: 'default' }], branchesEvaluated: 3 },
      { ...report.files[0], relativePath: 'a.go', branches: [{ line: 6, kind: 'then' }, { line: 2, kind: 'else' }], branchesEvaluated: 4 },
    ] } as unknown as GoIDECoverageReport
    expect(untakenBranches(withBranches)).toEqual({ evaluated: 7, branches: [
      { relativePath: 'a.go', line: 2, label: 'else never taken' }, { relativePath: 'a.go', line: 6, label: 'if never true' }, { relativePath: 'b.go', line: 9, label: 'default never reached' },
    ] })
  })
})
