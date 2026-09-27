import type { AppSettings } from '@/stores/settings'

/** Checking availability must not import the assistant or provider runtime. */
export function isAICompanionAvailable(ai: Pick<AppSettings['ai'], 'enabled' | 'model' | 'provider' | 'connectionVerifiedAt' | 'connectionProvider' | 'connectionModel'>): boolean {
  return ai.enabled
    && Boolean(ai.model.trim())
    && Boolean(ai.connectionVerifiedAt)
    && ai.connectionProvider === ai.provider
    && ai.connectionModel === ai.model
}
