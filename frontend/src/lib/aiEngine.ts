import * as AIEngine from '@/wailsjs/go/main/AIEngine'
import { resolveSecret } from '@/lib/vaultRefs'
import { useSettingsStore } from '@/stores/settings'

/**
 * Build the backend AI config from current settings, resolving a
 * vault:-referenced API key to plaintext only in-memory at call time.
 * Keys are camelCase to match the Go `ai.Config` struct tags.
 */
export async function buildAIConfig(): Promise<string> {
  const ai = useSettingsStore.getState().settings.ai
  const apiKey = await resolveSecret(ai.apiKey)
  const baseURL = ['ollama', 'huggingface', 'openai-compatible'].includes(ai.provider) ? ai.baseURL : ''
  return JSON.stringify({
    provider: ai.provider,
    model: ai.model,
    apiKey,
    baseURL,
  })
}

/**
 * Configure the backend AI engine from current settings. Throws if the Vault
 * is locked and the key is a vault: reference, so callers can surface a clear
 * "unlock the Vault" message.
 */
export async function ensureAIConfigured(): Promise<void> {
  await AIEngine.Configure(await buildAIConfig())
}
