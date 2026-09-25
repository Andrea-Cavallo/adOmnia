import * as AIEngine from '@/wailsjs/go/main/AIEngine'
import { resolveSecret } from '@/lib/vaultRefs'
import { useSettingsStore } from '@/stores/settings'

const ENVIRONMENT_CREDENTIAL_MISSING = 'AI environment credential is missing'

function configJSON(apiKey: string, credentialMode: 'auto' | 'vault' | 'environment'): string {
  const ai = useSettingsStore.getState().settings.ai
  const baseURL = ['amazon-bedrock', 'ollama', 'huggingface', 'openai-compatible'].includes(ai.provider) ? ai.baseURL : ''
  return JSON.stringify({
    provider: ai.provider,
    model: ai.model,
    apiKey,
    baseURL,
    credentialMode,
    awsRegion: ai.awsRegion,
    awsProfile: ai.awsProfile,
  })
}

async function buildVaultConfig(): Promise<string> {
  const ai = useSettingsStore.getState().settings.ai
  return configJSON(await resolveSecret(ai.apiKey), 'vault')
}

/**
 * Build the first backend AI config from current settings. Automatic and
 * environment modes never resolve a vault: reference in the renderer.
 */
export async function buildAIConfig(): Promise<string> {
  const ai = useSettingsStore.getState().settings.ai
  if (ai.credentialMode === 'vault') return buildVaultConfig()
  return configJSON('', ai.credentialMode)
}

/**
 * Run an operation with environment credentials first. In automatic mode the
 * Vault is resolved only if the backend reports that no inherited key exists.
 */
export async function withAIConfig<T>(operation: (config: string) => Promise<T>): Promise<T> {
  const ai = useSettingsStore.getState().settings.ai
  try {
    return await operation(await buildAIConfig())
  } catch (error) {
    if (ai.credentialMode !== 'auto' || !String(error).includes(ENVIRONMENT_CREDENTIAL_MISSING)) throw error
    return operation(await buildVaultConfig())
  }
}

export async function ensureAIConfigured(): Promise<void> {
  await withAIConfig((config) => AIEngine.Configure(config))
}

/** Restore a user-enabled local agent gateway after application startup. */
export async function restoreAIGateway(): Promise<void> {
  const ai = useSettingsStore.getState().settings.ai
  if (!ai.enabled || !ai.gatewayEnabled) return
  await withAIConfig((config) => AIEngine.StartGateway(config, ai.gatewayPort))
}
