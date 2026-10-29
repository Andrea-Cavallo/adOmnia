import type { CodeStudioChatPane } from '@/stores/codeStudioAssistant'

/** Agente di sviluppo che può eseguire l'audit come Agent Task (runtime registrati in agenttask_bindings.go). */
export type AuditTaskAgent = 'pi' | 'claude' | 'milk'

export interface AuditAgentOption {
  pane: CodeStudioChatPane
  label: string
  /** null quando la chat non è un agente di sviluppo: il motivo è in `unsupported`. */
  agent: AuditTaskAgent | null
  unsupported?: string
  /** Limite dichiarato per la skill, che vuole sottoagenti indipendenti per verificare i risultati. */
  note?: string
}

export const AUDIT_AGENT_OPTIONS: AuditAgentOption[] = [
  { pane: 'pi', label: 'Pi', agent: 'pi', note: 'Pi has no built-in sub-agents: the skill cannot give every finding a fresh, independent verifier, so expect more needs_validation records.' },
  { pane: 'claude', label: 'Claude Code', agent: 'claude' },
  { pane: 'milk', label: 'milk', agent: 'milk' },
  { pane: 'copilot', label: 'Copilot', agent: null, unsupported: 'Copilot chat cannot read files or run tasks on its own' },
  { pane: 'local', label: 'Local LLM', agent: null, unsupported: 'a local chat model is not a coding agent' },
]

export const auditAgentOption = (pane: CodeStudioChatPane): AuditAgentOption =>
  AUDIT_AGENT_OPTIONS.find((option) => option.pane === pane) ?? AUDIT_AGENT_OPTIONS[0]

const TIMEOUT_MINUTES = { quick: 60, standard: 150, deep: 240 } as const

/** Un audit dura molto più di un task normale; 240 è il massimo che il backend accetta. */
export const auditTimeoutMinutes = (profile: keyof typeof TIMEOUT_MINUTES): number => TIMEOUT_MINUTES[profile]
