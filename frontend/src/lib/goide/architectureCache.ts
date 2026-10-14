import { analyzeGoIDEArchitecture, type GoIDEArchitectureResult } from '@/lib/goide-api'
import { withGoIDETask } from '@/stores/goideTasks'

/** Ultima analisi dell'architettura per sessione gO: la condividono Explorer, Documentation, Live Session e le azioni AI. */
const lastResult = new Map<string, GoIDEArchitectureResult>()

export function cachedArchitecture(sessionId: string): GoIDEArchitectureResult | null {
  return lastResult.get(sessionId) ?? null
}

export function rememberArchitecture(sessionId: string, result: GoIDEArchitectureResult): void {
  lastResult.set(sessionId, result)
}

/** Analisi dell'architettura: riusa l'ultima della sessione, altrimenti la esegue (progetto autorizzato). */
export async function architectureFor(sessionId: string, fresh = false): Promise<GoIDEArchitectureResult> {
  const cached = cachedArchitecture(sessionId)
  if (cached && !fresh) return cached
  const next = await withGoIDETask(sessionId, 'architecture', 'Analyzing architecture', () => analyzeGoIDEArchitecture(sessionId))
  rememberArchitecture(sessionId, next)
  return next
}
