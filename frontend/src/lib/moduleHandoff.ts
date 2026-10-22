// Passaggi di contesto fra moduli adOmnia: il modulo di origine scrive una richiesta
// in sessionStorage e attiva il rail di destinazione, che la legge una sola volta al montaggio.

export const DATABASE_PENDING_CONNECTION_KEY = 'adomnia.database.pendingConnection'
export const DATABASE_PENDING_QUERY_KEY = 'adomnia.database.pendingQuery'
export const BROKER_PENDING_KEY = 'adomnia.broker.pending'
export const DOCKER_LAB_PENDING_KEY = 'adomnia.dockerlab.pending'
export const OPENAPI_PENDING_URL_KEY = 'adomnia.apidocs.pendingUrl'

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

/** Legge e consuma la query SQL inviata al Database da un altro modulo; null se assente. */
export function takeDatabaseQueryHandoff(): string | null {
  const raw = sessionStorage.getItem(DATABASE_PENDING_QUERY_KEY)
  if (!raw) return null
  sessionStorage.removeItem(DATABASE_PENDING_QUERY_KEY)
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'string' && parsed.trim() ? parsed.trim() : null
  } catch {
    return null
  }
}

/** Passa all'API Docs l'URL di un servizio locale appena avviato (indirizzo base, non il percorso della spec). */
export function handOffOpenApiURL(url: string): void {
  handOff(OPENAPI_PENDING_URL_KEY, url)
}

/**
 * Legge e consuma l'URL consegnato da Code Studio; null se assente o malformato. Il documento
 * OpenAPI non viene scaricato qui: l'API Docs mostra l'URL e l'utente conferma il fetch.
 */
export function takeOpenApiURLHandoff(): string | null {
  const raw = sessionStorage.getItem(OPENAPI_PENDING_URL_KEY)
  if (!raw) return null
  sessionStorage.removeItem(OPENAPI_PENDING_URL_KEY)
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'string' || !parsed.trim()) return null
    return parsed.trim()
  } catch {
    return null
  }
}
