import { describe, expect, it } from 'vitest'
import type { AgentTask } from '@/lib/agent-task-api'
import { verificationCoverage } from './CodeStudioAgentTaskIntegration'

const task = (evidences: Array<{ verificationId: string; outcome: string; diffFingerprint: string }>) =>
  ({ verifications: [{ id: 'v1' }, { id: 'v2' }], evidences } as unknown as AgentTask)

describe('verificationCoverage', () => {
  it('counts only the latest passing evidence measured on the same content', () => {
    expect(verificationCoverage(task([
      { verificationId: 'v1', outcome: 'passed', diffFingerprint: 'fp' },
      { verificationId: 'v2', outcome: 'passed', diffFingerprint: 'old' },
    ]), 'fp')).toEqual({ passed: 1, total: 2 })
    expect(verificationCoverage(task([
      { verificationId: 'v1', outcome: 'passed', diffFingerprint: 'fp' },
      { verificationId: 'v1', outcome: 'failed', diffFingerprint: 'fp' },
    ]), 'fp')).toEqual({ passed: 0, total: 2 })
  })
})
