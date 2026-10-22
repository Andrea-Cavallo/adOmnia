import { useCopilotStore } from '@/stores/copilot'
import { useMilkStore } from '@/stores/milk'
import { useClaudeCodeStore } from '@/stores/claudeCode'
import type { CodeStudioChatPane } from '@/stores/codeStudioAssistant'
import { aiProviderTone, type AiProviderTone } from './codeStudioAiHub'

export interface AiProviderState {
  tone: AiProviderTone
  /** Messaggio classificato (proxy, registry, certificati…): tooltip del pallino. */
  message: string | null
}

/** Stato dei tre provider AI, per i pallini della hub e del bottone unico della stripe. */
export function useAiProviders(): Record<CodeStudioChatPane, AiProviderState> {
  const copilot = useCopilotStore((state) => state.status)
  const milk = useMilkStore((state) => state.status)
  const claude = useClaudeCodeStore((state) => state.status)
  return {
    copilot: { tone: aiProviderTone(copilot?.state), message: copilot?.message ?? null },
    milk: { tone: aiProviderTone(milk?.state), message: milk?.message ?? null },
    claude: { tone: aiProviderTone(claude?.state), message: claude?.message ?? null },
  }
}

/**
 * Chiede lo stato e le impostazioni dei tre provider senza avviarli: serve a
 * riempire i pallini quando la hub viene aperta prima di qualunque chat.
 */
export function ensureAiProviders(): void {
  void useCopilotStore.getState().ensure()
  void useMilkStore.getState().ensure()
  void useClaudeCodeStore.getState().ensure()
}
