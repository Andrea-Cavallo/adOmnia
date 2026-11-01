import { describe, expect, it } from 'vitest'
import type { AgentTask } from '@/lib/agent-task-api'
import { moveDraft, stepBlocker } from './agentPlan'

const task = (approved: boolean) => ({
  plan: {
    revision: 2,
    approvedRevision: approved ? 2 : 1,
    steps: [
      { id: 'a', title: 'A', status: 'completed' },
      { id: 'b', title: 'B', status: 'todo', dependsOn: ['a'] },
      { id: 'c', title: 'C', status: 'todo', dependsOn: ['b'] },
    ],
  },
} as unknown as AgentTask)

describe('agent plan helpers', () => {
  it('explains why a step cannot run', () => {
    const approved = task(true)
    const [a, b, c] = approved.plan!.steps
    expect(stepBlocker(task(false), b, false)).toMatch(/Approve/)
    expect(stepBlocker(approved, b, true)).toMatch(/running attempt/)
    expect(stepBlocker(approved, a, false)).toMatch(/completed/)
    expect(stepBlocker(approved, b, false)).toBe('')
    expect(stepBlocker(approved, c, false)).toBe('Waits for: B')
  })

  it('drops dependencies that would point forward after a move', () => {
    const moved = moveDraft([
      { id: 'a', title: 'A', dependsOn: [] },
      { id: 'b', title: 'B', dependsOn: ['a'] },
    ], 1, -1)
    expect(moved.map((draft) => [draft.id, draft.dependsOn])).toEqual([['b', []], ['a', []]])
  })
})
