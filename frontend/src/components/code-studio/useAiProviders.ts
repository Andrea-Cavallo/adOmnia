import { useCopilotStore } from '@/stores/copilot'
import { usePiAgentStore } from '@/stores/piAgent'
import { useMilkStore } from '@/stores/milk'
import { useClaudeCodeStore } from '@/stores/claudeCode'
import type { CodeStudioChatPane } from '@/stores/codeStudioAssistant'
import { aiProviderTone, type AiProviderTone } from './codeStudioAiHub'

export interface AiProviderState {
  tone: AiProviderTone
  /** Messaggio classificato (proxy, registry, certificati…): tooltip del pallino. */
  message: string | null
  /** Interruttore salvato nelle impostazioni del provider; null finché non è stato letto. */
  enabled: boolean | null
}

/** Accende o spegne un provider: salva l'impostazione e il backend ferma o avvia il processo. */
export const setAiProviderEnabled: Record<Exclude<CodeStudioChatPane, 'local'>, (enabled: boolean) => Promise<boolean>> = {
  copilot: (enabled) => useCopilotStore.getState().setEnabled(enabled),
  milk: (enabled) => useMilkStore.getState().setEnabled(enabled),
  claude: (enabled) => useClaudeCodeStore.getState().setEnabled(enabled),
  pi: enabled => usePiAgentStore.getState().setEnabled(enabled),
}

/** Stato dei tre provider AI, per i pallini della hub e del bottone unico della stripe. */
export function useAiProviders(): Record<CodeStudioChatPane, AiProviderState> {
  const copilot = useCopilotStore((state) => state.status)
  const milk = useMilkStore((state) => state.status)
  const claude = useClaudeCodeStore((state) => state.status)
  const copilotEnabled = useCopilotStore((state) => state.settings?.enabled)
  const milkEnabled = useMilkStore((state) => state.settings?.enabled)
  const claudeEnabled = useClaudeCodeStore((state) => state.settings?.enabled)
  const pi = usePiAgentStore(state => state.status)
  const piEnabled = usePiAgentStore(state => state.settings?.enabled)
  return {
    pi: { tone: aiProviderTone(pi?.state), message: pi?.message ?? null, enabled: piEnabled ?? null },
    local: { tone: 'idle', message: 'Local endpoint; connect or list models in the Local LLM tab.', enabled: true },
    copilot: { tone: aiProviderTone(copilot?.state), message: copilot?.message ?? null, enabled: copilotEnabled ?? null },
    milk: { tone: aiProviderTone(milk?.state), message: milk?.message ?? null, enabled: milkEnabled ?? null },
    claude: { tone: aiProviderTone(claude?.state), message: claude?.message ?? null, enabled: claudeEnabled ?? null },
  }
}

/**
 * Chiede lo stato e le impostazioni dei tre provider senza avviarli: serve a
 * riempire i pallini quando la hub viene aperta prima di qualunque chat.
 */
export function ensureAiProviders(): void {
  void useCopilotStore.getState().ensure()
  void usePiAgentStore.getState().ensure()
  void useMilkStore.getState().ensure()
  void useClaudeCodeStore.getState().ensure()
}
