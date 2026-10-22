import type { CodeStudioChatPane } from '@/stores/codeStudioAssistant'

/**
 * Hub AI di Code Studio: un solo bottone, tre provider (Copilot, milk, Claude Code).
 * Qui stanno i mapping puri tra lo stato dei provider e i pallini della UI;
 * i dati vivono negli store `copilot`, `milk` e `claudeCode`.
 */

export const AI_PROVIDERS: ReadonlyArray<{ id: CodeStudioChatPane; label: string }> = [
  { id: 'copilot', label: 'Copilot' },
  { id: 'milk', label: 'milk' },
  { id: 'claude', label: 'Claude Code' },
]

export function providerLabel(id: CodeStudioChatPane): string {
  return AI_PROVIDERS.find((provider) => provider.id === id)?.label ?? id
}

/** Verde ready, ambra in avvio/installazione, rosso bloccato, grigio non disponibile. */
export type AiProviderTone = 'ready' | 'busy' | 'error' | 'idle'

/**
 * Riduce gli `State` dei provider (Copilot, milk e Claude Code condividono la
 * semantica) a un tono. Sconosciuto o assente = grigio, mai "tutto ok".
 */
export function aiProviderTone(state: string | null | undefined): AiProviderTone {
  switch (state) {
    case 'ready':
      return 'ready'
    case 'starting':
    case 'installing':
    case 'outdated':
    case 'warning':
      return 'busy'
    case 'error':
    case 'unauthorized':
      return 'error'
    default:
      // disabled, not-installed, signed-out, $zero, stato non ancora caricato
      return 'idle'
  }
}

/** Pallino sul bottone AI unico della stripe: nessun badge finché il provider non è attivo. */
export function aiProviderBadge(tone: AiProviderTone): 'success' | 'warning' | 'danger' | null {
  return tone === 'ready' ? 'success' : tone === 'busy' ? 'warning' : tone === 'error' ? 'danger' : null
}

export const AI_PROVIDER_TONE_CLASS: Record<AiProviderTone, string> = {
  ready: 'bg-success',
  busy: 'bg-warning',
  error: 'bg-danger',
  idle: 'bg-text-4',
}

export const AI_PROVIDER_TONE_LABEL: Record<AiProviderTone, string> = {
  ready: 'Ready',
  busy: 'Starting',
  error: 'Not responding',
  idle: 'Not available',
}

/** Messaggio classificato di GS-3 (proxy, registry, certificati…) come tooltip del pallino. */
export function aiProviderTooltip(tone: AiProviderTone, message: string | null | undefined, label: string): string {
  const state = AI_PROVIDER_TONE_LABEL[tone]
  return message ? `${label} — ${state}: ${message}` : `${label} — ${state}`
}
