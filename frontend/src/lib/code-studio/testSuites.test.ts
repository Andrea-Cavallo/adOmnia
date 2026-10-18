import { describe, expect, it } from 'vitest'
import type { GoIDETestRun } from '../code-studio-tests-api'
import { buildSuites, filterSuites, relativeTime, suiteStats } from './testSuites'
import type { TestTarget } from './testTargets'

const target = (workingDirectory: string, language = 'go'): TestTarget => ({ key: `${language}|${workingDirectory}`, label: `${workingDirectory || 'root'} · Go`, language, workingDirectory, packages: ['./...'] })

function run(partial: { workingDirectory: string; language?: string; status?: string; failed?: number; passed?: number; startedAt?: string; finishedAt?: string | null; diagnostics?: string; exitCode?: number }): GoIDETestRun {
  return {
    runId: Math.random().toString(36), sessionId: 's', command: '', status: partial.status ?? 'passed', exitCode: partial.exitCode ?? 0, diagnostics: partial.diagnostics,
    request: { sessionId: 's', language: partial.language, workingDirectory: partial.workingDirectory, packages: ['./...'] },
    summary: { passed: partial.passed ?? 3, failed: partial.failed ?? 0, skipped: 0, running: 0 },
    results: [], startedAt: partial.startedAt ?? '2026-10-18T10:00:00Z', finishedAt: partial.finishedAt === undefined ? '2026-10-18T10:00:02Z' : partial.finishedAt,
  } as unknown as GoIDETestRun
}

describe('buildSuites', () => {
  const targets = [target('shapes'), target('billing'), target('web', 'typescript')]

  it('joins each target with its latest run and marks the others as not run', () => {
    const newest = run({ workingDirectory: 'shapes', failed: 1, startedAt: '2026-10-18T11:00:00Z', finishedAt: '2026-10-18T11:00:05Z' })
    const older = run({ workingDirectory: 'shapes', startedAt: '2026-10-18T10:00:00Z' })
    const suites = buildSuites(targets, [newest, older])
    expect(suites.map((suite) => [suite.name, suite.status])).toEqual([['shapes', 'failed'], ['billing', 'notrun'], ['web', 'notrun']])
    expect(suites[0]).toMatchObject({ path: './shapes', total: 4, failed: 1, durationMs: 5000, languageLabel: 'Go' })
    expect(suites[2].languageLabel).toBe('JS/TS')
  })

  it('treats a build that failed without results as failed, and a running run as running', () => {
    const broken = run({ workingDirectory: 'shapes', passed: 0, diagnostics: 'build failed', exitCode: 2 })
    const running = run({ workingDirectory: 'billing', status: 'running', finishedAt: null, startedAt: '2026-10-18T10:00:00Z' })
    const suites = buildSuites(targets, [broken, running], Date.parse('2026-10-18T10:00:12Z'))
    expect(suites[0].status).toBe('failed')
    expect(suites[1]).toMatchObject({ status: 'running', durationMs: 12000 })
  })
})

describe('suiteStats and filterSuites', () => {
  const suites = buildSuites([target('a'), target('b'), target('c'), target('d')], [
    run({ workingDirectory: 'a' }),
    run({ workingDirectory: 'b', failed: 2, startedAt: '2026-10-18T10:05:00Z', finishedAt: '2026-10-18T10:05:09Z' }),
    run({ workingDirectory: 'c', status: 'running', finishedAt: null }),
  ])

  it('counts every state and reports the most recent finished run', () => {
    expect(suiteStats(suites)).toMatchObject({ total: 4, passed: 1, failed: 1, running: 1, queued: 0, notRun: 1, passedPercent: 25, lastRunDurationMs: 9000 })
  })

  it('filters by state and by text', () => {
    expect(filterSuites(suites, 'failed', '').map((suite) => suite.name)).toEqual(['b'])
    expect(filterSuites(suites, 'notrun', '').map((suite) => suite.name)).toEqual(['d'])
    expect(filterSuites(suites, 'all', ' C ').map((suite) => suite.name)).toEqual(['c'])
  })
})

describe('queued suites', () => {
  it('shows Run All waiting suites as queued, keeping their previous counts', () => {
    const suites = buildSuites([target('a'), target('b')], [run({ workingDirectory: 'a' })], Date.now(), new Set(['go|a', 'go|b']))
    expect(suites.map((suite) => suite.status)).toEqual(['queued', 'queued'])
    expect(suites[0].passed).toBe(3)
    expect(suiteStats(suites)).toMatchObject({ queued: 2, notRun: 0, queuedPercent: 100 })
  })
})

describe('relativeTime', () => {
  const now = Date.parse('2026-10-18T12:00:00Z')
  it('uses the coarsest unit that fits', () => {
    expect(relativeTime('2026-10-18T11:59:58Z', now)).toBe('now')
    expect(relativeTime('2026-10-18T11:59:10Z', now)).toBe('50s ago')
    expect(relativeTime('2026-10-18T11:57:00Z', now)).toBe('3m ago')
    expect(relativeTime('2026-10-18T09:00:00Z', now)).toBe('3h ago')
    expect(relativeTime('2026-10-16T12:00:00Z', now)).toBe('2d ago')
    expect(relativeTime(null, now)).toBe('')
  })
})
