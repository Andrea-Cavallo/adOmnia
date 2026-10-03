import { describe, expect, it } from 'vitest'
import { profileHeatFrom, profileHeatLines } from './goStudioProfileHeat'
import type { GoIDEProfileReport } from '@/lib/goide-api'

const report = {
  name: 'cpu.pprof',
  sampleTypes: [{ name: 'samples', unit: 'count' }, { name: 'cpu', unit: 'nanoseconds' }],
  totals: [100, 1_000_000_000],
  lines: [
    { file: '/p/a.go', relative: 'pkg/a.go', line: 10, value: [50, 500_000_000] },
    { file: '/p/a.go', relative: 'pkg/a.go', line: 12, value: [1, 5_000_000] },
    { file: '/p/a.go', relative: 'pkg/a.go', line: 10, value: [10, 100_000_000] },
    { file: '/go/src/runtime/x.go', relative: '', line: 3, value: [30, 300_000_000] },
  ],
} as unknown as GoIDEProfileReport

describe('profile heat in the editor', () => {
  it('sums lines per file on the chosen sample type and ranks them against the hottest line', () => {
    const heat = profileHeatFrom(report, 1)
    const lines = profileHeatLines(heat, 'pkg\\a.go')
    expect(lines.map((line) => [line.line, line.level, line.inline])).toEqual([[10, 4, true], [12, 1, false]])
    expect(lines[0].label).toBe('600.00 ms · 60.0%')
  })

  it('shows nothing for files outside the project or without a profile', () => {
    expect(profileHeatLines(profileHeatFrom(report, 0), 'other.go')).toEqual([])
    expect(profileHeatLines(null, 'pkg/a.go')).toEqual([])
  })
})
