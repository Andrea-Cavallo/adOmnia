import { describe, expect, it } from 'vitest'
import type { Snapshot } from '../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/resources/models'
import { resourcesToMarkdown } from './resourcesMarkdown'

const snapshot = (ram: number, at = '2026-10-19T10:00:00Z'): Snapshot => ({
  at, ram, cpu: 12.5, instances: 2, logicalCores: 8, rootPid: 1, cpuComplete: true, incomplete: false,
  budget: { target: 2 * 1048576 * 1024, recoveryTarget: 0, pressure: true, released: 0 },
  processes: [
    { pid: 1, createdAt: 1, name: 'adomnia', workspace: '', ram: 100 * 1048576, cpu: 5, cpuSeconds: 1, cpuIntervalSeconds: 1, parentPid: 0, attribution: 'application-root' },
    { pid: 2, createdAt: 2, name: 'gopls', workspace: 'C:\\a|b', ram: 300 * 1048576, cpu: null, cpuSeconds: 1, cpuIntervalSeconds: 1, parentPid: 1, attribution: 'managed-session', error: 'denied' },
  ],
} as Snapshot)

describe('resourcesToMarkdown', () => {
  it('lists the window, the budget and the per-process peaks', () => {
    const md = resourcesToMarkdown(snapshot(400 * 1048576))
    expect(md).toContain('(memory pressure)')
    expect(md).toContain('| gopls |')
    expect(md).toContain('C:\\\\a\\|b')
    expect(md).toContain('**insufficient for an average**')
    expect(md).not.toContain('## Samples')
  })

  it('adds the sample table and marks the silences it cannot fill', () => {
    const md = resourcesToMarkdown(snapshot(2, '2026-10-19T10:01:01Z'), [snapshot(1, '2026-10-19T10:00:00Z'), snapshot(1, '2026-10-19T10:00:01Z'), snapshot(2, '2026-10-19T10:01:01Z')])
    expect(md).toContain('## Samples')
    expect(md).toContain('2026-10-19T10:01:01.000Z')
    expect(md).toContain('not sampled')
  })
})
