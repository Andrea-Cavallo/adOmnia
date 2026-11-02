import type { AgentPlanStep, AgentPlanStepDraft, AgentTask } from '@/lib/agent-task-api'

/** Editable copy of the current plan (execution state is not part of a draft). */
export function draftsFromTask(task: AgentTask): AgentPlanStepDraft[] {
  return (task.plan?.steps ?? []).map((step) => ({
    id: step.id,
    title: step.title,
    goal: step.goal ?? '',
    dependsOn: [...(step.dependsOn ?? [])],
    expectedFiles: [...(step.expectedFiles ?? [])],
    verificationIds: [...(step.verificationIds ?? [])],
  }))
}

export function planApproved(task: AgentTask): boolean {
  const plan = task.plan
  return !!plan && plan.revision > 0 && plan.approvedRevision === plan.revision
}

/** Why a step cannot run now, or '' when it can. Mirrors the backend checks for the button state. */
export function stepBlocker(task: AgentTask, step: AgentPlanStep, active: boolean): string {
  if (active) return 'Wait for the running attempt to finish'
  if (!planApproved(task)) return 'Approve the current plan first'
  if (step.status === 'completed') return 'This step is completed'
  if (step.status === 'running') return 'This step is running'
  const steps = task.plan?.steps ?? []
  const waiting = (step.dependsOn ?? []).filter((id) => steps.find((other) => other.id === id)?.status !== 'completed')
  if (waiting.length) return `Waits for: ${waiting.map((id) => steps.find((other) => other.id === id)?.title ?? id).join(', ')}`
  return ''
}

/** Moves a draft up or down; dependencies on later steps are dropped, as the backend refuses them. */
export function moveDraft(drafts: AgentPlanStepDraft[], index: number, delta: -1 | 1): AgentPlanStepDraft[] {
  const target = index + delta
  if (target < 0 || target >= drafts.length) return drafts
  const next = [...drafts]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next.map((draft, position) => ({
    ...draft,
    dependsOn: (draft.dependsOn ?? []).filter((id) => next.slice(0, position).some((earlier) => earlier.id === id)),
  }))
}
