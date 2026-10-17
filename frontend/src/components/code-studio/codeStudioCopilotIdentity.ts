import type { CopilotProfile, CopilotSettings, CopilotStatus } from '@/lib/copilot-api'

/** Testo esatto quando il modello non è noto: Copilot lo sceglie lato server. */
export const COPILOT_MODEL_MANAGED = 'Model: managed by GitHub Copilot'

export interface CopilotChatIdentity {
  provider: 'GitHub Copilot' | 'GitHub Enterprise' | null
  host: string | null
  /** Login GitHub, solo se il Language Server lo ha riportato. */
  account: string | null
  /** Etichetta del modello pronta da mostrare: id reale o COPILOT_MODEL_MANAGED. */
  model: string
  /** Deployment GHE ricavato dall'host (Cloud/Server), mai il piano Copilot. */
  deployment: string | null
  /** true se il profilo viene dalle impostazioni e il server non lo ha ancora confermato. */
  configuredOnly: boolean
}

interface IdentityInput {
  status: CopilotStatus | null
  settings: CopilotSettings | null
  root: string | null
  /** Modello riportato dall'ultima risposta di chat del thread. */
  model?: string | null
}

function configuredProfile(settings: CopilotSettings | null, root: string | null): CopilotProfile | null {
  if (!settings?.profiles?.length) return null
  const byId = (id: string | undefined) => (id ? settings.profiles.find((profile) => profile.id === id) ?? null : null)
  return byId(root ? settings.workspaceProfiles?.[root] : undefined) ?? byId(settings.activeProfileId) ?? settings.profiles[0]
}

function isEnterprise(profile: CopilotProfile): boolean {
  if (profile.type) return profile.type !== 'github.com'
  return profile.host.toLowerCase() !== 'github.com'
}

function deploymentOf(profile: CopilotProfile): string | null {
  if (!isEnterprise(profile)) return null
  if (profile.type === 'ghe.com' || profile.host.toLowerCase().endsWith('.ghe.com')) return 'Enterprise Cloud'
  return 'Enterprise Server'
}

/** Formatta il modello: id reale se il backend lo ha riportato, altrimenti il testo "managed". */
export function copilotModelLabel(model: string | null | undefined): string {
  const id = model?.trim()
  if (!id) return COPILOT_MODEL_MANAGED
  return id === 'auto' ? 'Model: auto (selected by GitHub Copilot)' : `Model: ${id}`
}

/**
 * Provider, host, account e modello della chat Copilot. Solo valori noti al codice: il profilo
 * effettivo del server (status) ha la precedenza su quello configurato per il progetto.
 */
export function copilotChatIdentity({ status, settings, root, model }: IdentityInput): CopilotChatIdentity {
  // Da spento lo status porta il profilo di default, non quello del progetto: vale la configurazione.
  const running = status && status.state !== 'disabled' && status.profile?.host ? status.profile : null
  const profile = running ?? configuredProfile(settings, root)
  return {
    provider: profile ? (isEnterprise(profile) ? 'GitHub Enterprise' : 'GitHub Copilot') : null,
    host: profile?.host || null,
    account: status?.user?.trim() || null,
    model: copilotModelLabel(model),
    deployment: profile ? deploymentOf(profile) : null,
    configuredOnly: !running && !!profile,
  }
}
