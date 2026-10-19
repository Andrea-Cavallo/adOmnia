import type { Environment } from '@/lib/types'
import { findAIWorkspaceCredential, providerCredentialKeys, type AIWorkspaceCredential } from '@/lib/aiCredentials'
import type { AIProvider, AppSettings } from '@/stores/settings'

export const PROVIDER_LABELS: Record<AIProvider, string> = {
  anthropic: 'Anthropic · Claude',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  deepseek: 'DeepSeek',
  huggingface: 'Hugging Face',
  'openai-compatible': 'OpenAI-compatible',
  ollama: 'Ollama',
  'amazon-bedrock': 'Amazon Bedrock',
}

export interface StrixAgentOption {
  provider: AIProvider
  credential: AIWorkspaceCredential
  /** Modello suggerito: quello delle impostazioni se il provider coincide, altrimenti il primo del catalogo già verificato. */
  suggestedModel: string
}

/** Gli agenti che Strix può usare con le chiavi trovate negli Environments (una per provider, la più specifica). */
export function strixAgentOptions(environments: Environment[], activeEnvId: string | null, ai: AppSettings['ai']): StrixAgentOption[] {
  const providers = (Object.keys(PROVIDER_LABELS) as AIProvider[]).filter((provider) => providerCredentialKeys(provider).length > 0)
  return providers.flatMap((provider) => {
    const credential = findAIWorkspaceCredential(provider, environments, activeEnvId)
    // La chiave generica (ADOMNIA_AI_API_KEY) vale per qualunque provider: è già il default "Settings → AI", non un agente a sé.
    // OPENAI_API_KEY serve anche l'endpoint compatibile: lo si elenca una volta, come OpenAI.
    if (!credential || credential.key === 'ADOMNIA_AI_API_KEY') return []
    if (provider === 'openai-compatible' && credential.key === 'OPENAI_API_KEY') return []
    const suggestedModel = ai.provider === provider ? ai.model : ai.modelCatalogs?.[provider]?.models[0]?.id ?? ''
    return [{ provider, credential, suggestedModel }]
  })
}
