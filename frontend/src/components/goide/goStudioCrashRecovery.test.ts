import { describe, expect, it } from 'vitest'
import { recoverySummary } from './goStudioCrashRecovery'

describe('recoverySummary', () => {
  it('counts added and removed lines from disk to the recovered buffer', () => {
    const summary = recoverySummary('package a\n\nfunc A() {}\n', 'package a\n\nfunc A() {}\nfunc B() {}\n')
    expect(summary.added).toBe(1)
    expect(summary.removed).toBe(0)
    expect(summary.lines).toEqual([{ kind: 'added', line: 4, text: 'func B() {}', hunkStart: true }])
  })

  it('shows a modified line as removed then added', () => {
    const summary = recoverySummary('x := 1\n', 'x := 2\n')
    expect(summary).toMatchObject({ added: 1, removed: 1 })
    expect(summary.lines.map((line) => line.kind)).toEqual(['removed', 'added'])
  })

  it('reports nothing when disk and recovered text match', () => {
    expect(recoverySummary('same\n', 'same\n')).toEqual({ added: 0, removed: 0, lines: [] })
  })
})
