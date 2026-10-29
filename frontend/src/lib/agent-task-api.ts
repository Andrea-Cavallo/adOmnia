import { Events } from '@wailsio/runtime'
import * as AgentTasks from '../../bindings/github.com/Andrea-Cavallo/adOmnia/agenttasks'
import {
  ContextReceipt,
  Draft,
  Intent,
  Status,
  Task,
  type Attempt,
  type Event,
  type Limits,
  type PlanEntry,
} from '../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/ide/agenttask/models'

export type AgentTask = Task
export type AgentTaskDraft = Draft
export type AgentTaskAttempt = Attempt
export type AgentTaskEvent = Event
export type AgentTaskLimits = Limits
export type AgentTaskPlanEntry = PlanEntry
export { ContextReceipt, Draft, Intent, Status, Task }

export const listAgentTasks = (root: string): Promise<AgentTask[]> => AgentTasks.List(root)
export const createAgentTask = (draft: AgentTaskDraft): Promise<AgentTask> => AgentTasks.Create(draft)
export const updateAgentTask = (id: string, draft: AgentTaskDraft): Promise<AgentTask> => AgentTasks.Update(id, draft)
export const startAgentTask = (id: string, message: string, receipt: ContextReceipt): Promise<AgentTask> => AgentTasks.Start(id, message, receipt)
export const stopAgentTask = (id: string): Promise<AgentTask> => AgentTasks.Stop(id)
export const exportAgentTask = (id: string): Promise<string> => AgentTasks.Export(id)

export function subscribeAgentTaskChanges(handler: (task: AgentTask) => void): () => void {
  return Events.On('agenttask.changed', (event) => handler(Task.createFrom(event.data)))
}
