import { ContextReceipt, Draft, Intent, type AgentTask } from '@/lib/agent-task-api'
import type { StudioContextSource } from '@/lib/code-studio/studioChatContext'

export interface AgentTaskPreview {
  message: string
  sources: StudioContextSource[]
  excludedPaths: string[]
  bytes: number
  truncated: boolean
  includesUnsaved: boolean
}

export function emptyAgentTaskDraft(root: string): Draft {
  return new Draft({
    root,
    intent: Intent.IntentImplementation,
    objective: '',
    criteria: [],
    paths: [],
    dependencies: [],
    agent: 'milk',
    limits: { timeoutMinutes: 30, maxContextBytes: 128 * 1024 },
  })
}

export function agentTaskDraft(task: AgentTask): Draft {
  return new Draft({
    root: task.root,
    unitId: task.unitId,
    intent: task.intent,
    objective: task.objective,
    criteria: task.criteria,
    paths: task.paths,
    dependencies: task.dependencies,
    agent: task.agent,
    limits: task.limits,
  })
}

export function agentTaskMessage(draft: Draft): string {
  const sections = [
    `Task intent: ${draft.intent}`,
    `Objective:\n${draft.objective.trim()}`,
  ]
  if (draft.criteria.length) sections.push(`Completion criteria:\n${draft.criteria.map((criterion) => `- ${criterion}`).join('\n')}`)
  if (draft.dependencies.length) sections.push(`Declared dependencies (context only, not attachments):\n${draft.dependencies.map((dependency) => `- ${dependency}`).join('\n')}`)
  if (draft.paths.length) sections.push(`Declared project paths (only file contents explicitly shown below were read):\n${draft.paths.map((path) => `- ${path}`).join('\n')}`)
  return sections.join('\n\n')
}

export function agentTaskReceipt(preview: AgentTaskPreview): ContextReceipt {
  return new ContextReceipt({
    bytes: preview.bytes,
    sources: preview.sources.filter((source) => !source.excluded).length,
    excluded: preview.excludedPaths.length,
    truncated: preview.truncated,
    includesUnsaved: preview.includesUnsaved,
  })
}
