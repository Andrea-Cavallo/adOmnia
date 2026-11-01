import { Events } from '@wailsio/runtime'
import * as AgentTasks from '../../bindings/github.com/Andrea-Cavallo/adOmnia/agenttasks'
import {
  ContextReceipt,
  Draft,
  EvidenceOutcome,
  Intent,
  Status,
  Task,
  VerificationKind,
  type Attempt,
  type Event,
  type Evidence,
  type Limits,
  type Observation,
  type PlanEntry,
  type Verification,
  type VerificationDraft,
  type VerificationHeader,
  type Workspace,
  type WorkspaceState,
} from '../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/ide/agenttask/models'

export type AgentTask = Task
export type AgentTaskDraft = Draft
export type AgentTaskAttempt = Attempt
export type AgentTaskEvent = Event
export type AgentTaskLimits = Limits
export type AgentTaskPlanEntry = PlanEntry
export type AgentTaskWorkspace = Workspace
export type AgentVerification = Verification
export type AgentVerificationDraft = VerificationDraft
export type AgentVerificationHeader = VerificationHeader
export type AgentEvidence = Evidence
export type AgentEvidenceObservation = Observation
export {
  ContextReceipt,
  Draft,
  EvidenceOutcome,
  Intent,
  Status,
  Task,
  VerificationKind,
  WorkspaceState,
}

export const listAgentTasks = (root: string): Promise<AgentTask[]> => AgentTasks.List(root)
export const createAgentTask = (draft: AgentTaskDraft): Promise<AgentTask> => AgentTasks.Create(draft)
export const updateAgentTask = (id: string, draft: AgentTaskDraft): Promise<AgentTask> => AgentTasks.Update(id, draft)
export const startAgentTask = (id: string, message: string, receipt: ContextReceipt): Promise<AgentTask> => AgentTasks.Start(id, message, receipt)
export const stopAgentTask = (id: string): Promise<AgentTask> => AgentTasks.Stop(id)
export const exportAgentTask = (id: string): Promise<string> => AgentTasks.Export(id)

/** Isolated workspace: the agent works in a Git worktree, never in the project's working tree. */
export const createAgentTaskWorkspace = (id: string, baseRef: string, includeLocalChanges = false): Promise<AgentTask> => AgentTasks.CreateWorkspace(id, baseRef, includeLocalChanges)
export const removeAgentTaskWorkspace = (id: string): Promise<AgentTask> => AgentTasks.RemoveWorkspace(id)
export const reconcileAgentTaskWorkspaces = (): Promise<AgentTask[]> => AgentTasks.ReconcileWorkspaces()

/** Verifications run by adOmnia; their results are Evidence, not agent claims. */
export const addAgentTaskVerification = (id: string, draft: AgentVerificationDraft): Promise<AgentTask> => AgentTasks.AddVerification(id, draft)
export const removeAgentTaskVerification = (id: string, verificationId: string): Promise<AgentTask> => AgentTasks.RemoveVerification(id, verificationId)
export const startAgentTaskVerifications = (id: string, verificationIds: string[]): Promise<AgentTask> => AgentTasks.StartVerifications(id, verificationIds)

/** Ask the agent to fix selected evidence; the same verifications are re-run afterwards. */
export const startAgentTaskCorrection = (id: string, evidenceIds: string[], note: string): Promise<AgentTask> => AgentTasks.StartCorrection(id, evidenceIds, note)

export function subscribeAgentTaskChanges(handler: (task: AgentTask) => void): () => void {
  return Events.On('agenttask.changed', (event) => handler(Task.createFrom(event.data)))
}
