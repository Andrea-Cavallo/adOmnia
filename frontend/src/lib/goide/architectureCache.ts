import type { GoIDEArchitectureResult } from '@/lib/goide-api'

/** Ultima analisi dell'architettura per sessione gO: la condividono Explorer, Documentation e Live Session. */
const lastResult = new Map<string, GoIDEArchitectureResult>()

export function cachedArchitecture(sessionId: string): GoIDEArchitectureResult | null {
  return lastResult.get(sessionId) ?? null
}

export function rememberArchitecture(sessionId: string, result: GoIDEArchitectureResult): void {
  lastResult.set(sessionId, result)
}
