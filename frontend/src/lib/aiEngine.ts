import * as AIEngine from '@/wailsjs/go/main/AIEngine'
import { resolveSecret } from '@/lib/vaultRefs'
import { useSettingsStore } from '@/stores/settings'
import { useEnvironmentsStore } from '@/stores/environments'
import { findAIWorkspaceCredential } from '@/lib/aiCredentials'

const ENVIRONMENT_CREDENTIAL_MISSING = 'AI environment credential is missing'

function configJSON(apiKey: string, credentialMode: 'auto' | 'vault' | 'environment', modelOverride?: string): string {
  const ai = useSettingsStore.getState().settings.ai
  const baseURL = ['amazon-bedrock', 'deepseek', 'ollama', 'huggingface', 'openai-compatible'].includes(ai.provider) ? ai.baseURL : ''
  return JSON.stringify({
    provider: ai.provider,
    model: modelOverride ?? ai.model,
    apiKey,
    baseURL,
    credentialMode,
    awsRegion: ai.awsRegion,
    awsProfile: ai.awsProfile,
  })
}

async function buildVaultConfig(modelOverride?: string): Promise<string> {
  const ai = useSettingsStore.getState().settings.ai
  return configJSON(await resolveSecret(ai.apiKey), 'vault', modelOverride)
}

/**
 * Build the first backend AI config from current settings. Automatic and
 * environment modes never resolve a vault: reference in the renderer.
 */
export async function buildAIConfig(modelOverride?: string): Promise<string> {
  const ai = useSettingsStore.getState().settings.ai
  if (ai.credentialMode === 'vault') return buildVaultConfig(modelOverride)
  const environmentState = useEnvironmentsStore.getState()
  const workspaceCredential = findAIWorkspaceCredential(ai.provider, environmentState.environments, environmentState.activeEnvId)
  const apiKey = workspaceCredential ? await resolveSecret(workspaceCredential.value) : ''
  return configJSON(apiKey, ai.credentialMode, modelOverride)
}

/**
 * Run an operation with environment credentials first. In automatic mode the
 * Vault is resolved only if the backend reports that no inherited key exists.
 */
export async function withAIConfig<T>(operation: (config: string) => Promise<T>, modelOverride?: string): Promise<T> {
  const ai = useSettingsStore.getState().settings.ai
  try {
    return await operation(await buildAIConfig(modelOverride))
  } catch (error) {
    if (ai.credentialMode !== 'auto' || !String(error).includes(ENVIRONMENT_CREDENTIAL_MISSING)) throw error
    return operation(await buildVaultConfig(modelOverride))
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
