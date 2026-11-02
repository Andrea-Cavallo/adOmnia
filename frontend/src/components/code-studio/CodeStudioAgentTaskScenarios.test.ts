import { describe, expect, it } from 'vitest'
import type { AgentTask } from '@/lib/agent-task-api'
import { scenarioOutcome } from './CodeStudioAgentTaskScenarios'

const task = (evidences: Array<{ verificationId: string; outcome: string }>) => ({
  verifications: [{ id: 'v1', scenarioId: 's' }, { id: 'v2', scenarioId: 's' }, { id: 'v3' }],
  evidences,
} as unknown as AgentTask)

describe('scenarioOutcome', () => {
  it('summarizes the latest evidence of every linked criterion', () => {
    expect(scenarioOutcome(task([]), 'other')).toBe('')
    expect(scenarioOutcome(task([{ verificationId: 'v1', outcome: 'passed' }]), 's')).toBe('not_run')
    expect(scenarioOutcome(task([{ verificationId: 'v1', outcome: 'passed' }, { verificationId: 'v2', outcome: 'passed' }]), 's')).toBe('passed')
    expect(scenarioOutcome(task([{ verificationId: 'v1', outcome: 'passed' }, { verificationId: 'v2', outcome: 'failed' }]), 's')).toBe('failed')
  })
})
