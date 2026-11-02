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
  type Integration,
  type PlanStep,
  type PlanStepDraft,
  type ReviewComment,
  type ReviewCommentDraft,
  type Workspace,
  type WorkspaceComparison,
  type WorkspaceState,
} from '../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/ide/agenttask/models'

export type AgentTask = Task
export type AgentTaskDraft = Draft
export type AgentTaskAttempt = Attempt
export type AgentTaskEvent = Event
export type AgentTaskLimits = Limits
export type AgentTaskPlanEntry = PlanEntry
export type AgentTaskWorkspace = Workspace
export type AgentWorkspaceComparison = WorkspaceComparison
export type AgentReviewComment = ReviewComment
export type AgentPlanStep = PlanStep
export type AgentPlanStepDraft = PlanStepDraft
export type AgentReviewCommentDraft = ReviewCommentDraft
export type AgentWorkspaceIntegration = Integration
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
export const compareAgentTaskWorkspace = (id: string): Promise<AgentWorkspaceComparison> => AgentTasks.CompareWorkspace(id)
export const integrateAgentTaskWorkspace = (id: string, check: boolean): Promise<AgentWorkspaceIntegration> => AgentTasks.IntegrateWorkspace(id, check)
export const removeAgentTaskWorkspace = (id: string): Promise<AgentTask> => AgentTasks.RemoveWorkspace(id)
export const reconcileAgentTaskWorkspaces = (): Promise<AgentTask[]> => AgentTasks.ReconcileWorkspaces()

/** Verifications run by adOmnia; their results are Evidence, not agent claims. */
export const addAgentTaskVerification = (id: string, draft: AgentVerificationDraft): Promise<AgentTask> => AgentTasks.AddVerification(id, draft)
export const removeAgentTaskVerification = (id: string, verificationId: string): Promise<AgentTask> => AgentTasks.RemoveVerification(id, verificationId)
export const startAgentTaskVerifications = (id: string, verificationIds: string[]): Promise<AgentTask> => AgentTasks.StartVerifications(id, verificationIds)

/** Ask the agent to fix selected evidence; the same verifications are re-run afterwards. */
export const startAgentTaskCorrection = (id: string, evidenceIds: string[], note: string, commentIds: string[] = []): Promise<AgentTask> => AgentTasks.StartCorrection(id, evidenceIds, commentIds, note)
export const setAgentTaskPlan = (id: string, steps: AgentPlanStepDraft[]): Promise<AgentTask> => AgentTasks.SetPlan(id, steps)
export const approveAgentTaskPlan = (id: string): Promise<AgentTask> => AgentTasks.ApprovePlan(id)
export const agentTaskStepPrompt = (id: string, stepId: string): Promise<string> => AgentTasks.StepPrompt(id, stepId)
export const startAgentTaskStep = (id: string, stepId: string): Promise<AgentTask> => AgentTasks.StartStep(id, stepId)
export const previewAgentTaskStepCommit = (id: string, stepId: string) => AgentTasks.PreviewStepCommit(id, stepId)
export const commitAgentTaskStep = (id: string, stepId: string): Promise<AgentTask> => AgentTasks.CommitStep(id, stepId)
export const confirmAgentTaskStep = (id: string, stepId: string): Promise<AgentTask> => AgentTasks.ConfirmStep(id, stepId)
export const addAgentTaskComment = (id: string, draft: AgentReviewCommentDraft): Promise<AgentTask> => AgentTasks.AddComment(id, draft)
export const setAgentTaskCommentStatus = (id: string, commentId: string, resolved: boolean): Promise<AgentTask> => AgentTasks.SetCommentStatus(id, commentId, resolved)
export const removeAgentTaskComment = (id: string, commentId: string): Promise<AgentTask> => AgentTasks.RemoveComment(id, commentId)

export function subscribeAgentTaskChanges(handler: (task: AgentTask) => void): () => void {
  return Events.On('agenttask.changed', (event) => handler(Task.createFrom(event.data)))
}

// --- Acceptance scenarios (.adomnia/acceptance) ---
export type { Scenario as AcceptanceScenario, Criterion as AcceptanceCriterion, Check as AcceptanceCheck, LoadResult as AcceptanceLoadResult } from '../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/ide/acceptance/models'
export { Scenario as AcceptanceScenarioModel, Status as AcceptanceStatus } from '../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/ide/acceptance/models'
export const listAcceptanceScenarios = (root: string) => AgentTasks.ListScenarios(root)
export const saveAcceptanceScenario = (root: string, scenario: import('../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/ide/acceptance/models').Scenario) => AgentTasks.SaveScenario(root, scenario)
export const addScenarioToAgentTask = (id: string, scenarioId: string): Promise<AgentTask> => AgentTasks.AddScenarioToTask(id, scenarioId)
export const evidenceImage = (id: string, evidenceId: string): Promise<string> => AgentTasks.EvidenceImage(id, evidenceId)
export const draftAgentTaskPullRequest = (id: string) => AgentTasks.DraftPullRequest(id)
export const touchedAcceptanceScenarios = (id: string): Promise<string[]> => AgentTasks.TouchedScenarios(id)
