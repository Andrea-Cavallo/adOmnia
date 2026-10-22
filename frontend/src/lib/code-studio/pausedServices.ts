/** Services Low-Resource Mode can pause. The user picks which; the rest keeps running. */
export type PausableService = 'ai' | 'analyses' | 'completion' | 'navigation' | 'hover'

export const PAUSABLE_SERVICES: ReadonlyArray<{ id: PausableService; label: string; hint: string }> = [
  { id: 'ai', label: 'AI assistants', hint: 'Copilot, milk, Claude Code' },
  { id: 'analyses', label: 'Optional analyses', hint: 'staticcheck and vulnerability diagnostics' },
  { id: 'completion', label: 'Completion', hint: 'Suggestions and parameter hints' },
  { id: 'navigation', label: 'Navigation', hint: 'Go to definition, structure outline' },
  { id: 'hover', label: 'Hover documentation', hint: 'Type and doc popups' },
]

/** What Low-Resource Mode paused before it became configurable. */
export const DEFAULT_PAUSED: ReadonlyArray<PausableService> = ['ai', 'analyses']

const KEY = 'adomnia.codeStudio.lowResources.services.v1'
const KNOWN = new Set<string>(PAUSABLE_SERVICES.map((service) => service.id))

export function readPausedServices(): PausableService[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (Array.isArray(saved)) return saved.filter((id): id is PausableService => typeof id === 'string' && KNOWN.has(id))
  } catch { /* unreadable storage: the defaults apply */ }
  return [...DEFAULT_PAUSED]
}

export function writePausedServices(services: ReadonlyArray<PausableService>): void {
  try { localStorage.setItem(KEY, JSON.stringify(services)) } catch { /* the choice just does not survive a restart */ }
}

let suspended: ReadonlySet<PausableService> = new Set()

/** Providers read this synchronously: it is true only while Low-Resource Mode is on and the user chose the service. */
export function isServiceSuspended(service: PausableService): boolean {
  return suspended.has(service)
}

export function applySuspended(services: ReadonlyArray<PausableService>): void {
  suspended = new Set(services)
}
