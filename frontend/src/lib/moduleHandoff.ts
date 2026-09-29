// Passaggi di contesto fra moduli adOmnia: il modulo di origine scrive una richiesta
// in sessionStorage e attiva il rail di destinazione, che la legge una sola volta al montaggio.

export const DATABASE_PENDING_CONNECTION_KEY = 'adomnia.database.pendingConnection'
export const BROKER_PENDING_KEY = 'adomnia.broker.pending'
export const DOCKER_LAB_PENDING_KEY = 'adomnia.dockerlab.pending'

/** Preset del Docker Lab suggeriti da un altro modulo, con l'origine da mostrare all'utente. */
export interface DockerLabHandoff {
  presetIds: string[]
  source: string
}

export function handOff(key: string, value: unknown): void {
  sessionStorage.setItem(key, JSON.stringify(value))
}

/** Legge e consuma il suggerimento per il Docker Lab; null se assente o malformato. */
export function takeDockerLabHandoff(): DockerLabHandoff | null {
  const raw = sessionStorage.getItem(DOCKER_LAB_PENDING_KEY)
  if (!raw) return null
  sessionStorage.removeItem(DOCKER_LAB_PENDING_KEY)
  try {
    const parsed = JSON.parse(raw) as Partial<DockerLabHandoff>
    if (!Array.isArray(parsed.presetIds) || typeof parsed.source !== 'string') return null
    return { presetIds: parsed.presetIds.filter((id): id is string => typeof id === 'string'), source: parsed.source }
  } catch {
    return null
  }
}
