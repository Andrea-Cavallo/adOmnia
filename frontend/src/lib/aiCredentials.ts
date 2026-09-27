import type { Environment } from '@/lib/types'
import type { AIProvider } from '@/stores/settings'

const PROVIDER_CREDENTIAL_KEYS: Record<AIProvider, string[]> = {
  anthropic: ['ANTHROPIC_API_KEY', 'ADOMNIA_AI_API_KEY'],
  'amazon-bedrock': [],
  openai: ['OPENAI_API_KEY', 'ADOMNIA_AI_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'ADOMNIA_AI_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY', 'ADOMNIA_AI_API_KEY'],
  huggingface: ['HUGGINGFACE_API_KEY', 'HF_TOKEN', 'ADOMNIA_AI_API_KEY'],
  ollama: [],
  'openai-compatible': ['OPENAI_COMPATIBLE_API_KEY', 'OPENAI_API_KEY', 'ADOMNIA_AI_API_KEY'],
}

export interface AIWorkspaceCredential {
  key: string
  value: string
  environmentName: string
}

export function providerCredentialKeys(provider: AIProvider): string[] {
  return PROVIDER_CREDENTIAL_KEYS[provider]
}

/** Find only an exact, provider-specific key. The active Environment wins;
 * imported .env/env.yaml environments and other saved environments are the
 * fallback. Unrelated variables are never inspected or forwarded. */
export function findAIWorkspaceCredential(
  provider: AIProvider,
  environments: Environment[],
  activeEnvId: string | null,
): AIWorkspaceCredential | null {
  const keys = new Set(providerCredentialKeys(provider))
  if (keys.size === 0) return null
  const ordered = [
    ...environments.filter((environment) => environment.id === activeEnvId),
    ...environments.filter((environment) => environment.id !== activeEnvId),
  ]
  for (const environment of ordered) {
    for (const variable of environment.variables) {
      if (!variable.enabled || !keys.has(variable.key.trim()) || !variable.value.trim()) continue
      return { key: variable.key.trim(), value: variable.value, environmentName: environment.name }
    }
  }
  return null
}
