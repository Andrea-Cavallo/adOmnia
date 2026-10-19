import { describe, expect, it } from 'vitest'
import type { Snapshot } from '../../bindings/adomnia/internal/resources/models'
import { resourcesToMarkdown } from './resourcesMarkdown'

const snapshot = (ram: number, at = '2026-10-19T10:00:00Z'): Snapshot => ({
  at, ram, cpu: 12.5, instances: 2,
  budget: { target: 2 * 1048576 * 1024, recoveryTarget: 0, pressure: true, released: 0 },
  processes: [
    { pid: 1, name: 'adomnia', workspace: '', ram: 100 * 1048576, cpu: 5 },
    { pid: 2, name: 'gopls', workspace: 'C:\\a|b', ram: 300 * 1048576, cpu: null, error: 'denied' },
  ],
}) as Snapshot

describe('resourcesToMarkdown', () => {
  it('lists totals, budget and processes by RAM', () => {
    const md = resourcesToMarkdown(snapshot(400 * 1048576))
    expect(md).toContain('- **RAM:** 400.0 MB')
    expect(md).toContain('(memory pressure)')
    expect(md.indexOf('gopls')).toBeLessThan(md.indexOf('adomnia |'))
    expect(md).toContain('C:\\a\\|b')
    expect(md).not.toContain('Last ')
  })

  it('adds the sample history when there is a trend', () => {
    const md = resourcesToMarkdown(snapshot(2), [snapshot(1, 't1'), snapshot(2, 't2')])
    expect(md).toContain('## Last 2 samples')
    expect(md).toContain('| t2 |')
  })
})
