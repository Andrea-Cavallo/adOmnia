/**
 * Per le chiamate best-effort (anteprime, sincronizzazioni): non bloccano l'utente ma lasciano una traccia
 * nella console dev invece di sparire in un `.catch(() => undefined)`.
 */
export function logBackgroundError(scope: string): (error: unknown) => void {
  return (error) => console.warn(`[go-studio] ${scope} failed:`, error instanceof Error ? error.message : error)
}
