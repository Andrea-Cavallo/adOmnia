/**
 * Punteggio di corrispondenza: prefisso > parola > sottostringa > sottosequenza fuzzy; null se
 * non corrisponde. La sottosequenza pesa contiguità, inizi di parola e salti brevi: "ril" batte
 * "rnl" su "Run Linter".
 */
export function matchScore(query: string, text: string): number | null {
  const needle = query.trim().toLowerCase()
  if (!needle) return 0
  const haystack = text.toLowerCase()
  if (haystack.startsWith(needle)) return 100 - Math.min(40, haystack.length - needle.length)
  const index = haystack.indexOf(needle)
  if (index >= 0) return (/[\s./_-]/.test(haystack[index - 1] ?? '') ? 70 : 50) - Math.min(20, index)
  let cursor = 0
  let previous = -2
  let bonus = 0
  for (const character of needle) {
    const found = haystack.indexOf(character, cursor)
    if (found < 0) return null
    if (found === previous + 1) bonus += 3 // caratteri contigui
    if (found === 0 || /[\s./_-]/.test(haystack[found - 1] ?? '')) bonus += 4 // inizio parola
    bonus -= Math.min(3, found - cursor) // salti lunghi costano
    previous = found
    cursor = found + 1
  }
  return Math.max(1, 10 + Math.min(15, bonus))
}

export interface SearchCandidate<T> {
  item: T
  text: string
  /** Punteggio extra (es. uso recente): sommato a quello di corrispondenza, mai capovolge un non-match. */
  boost?: number
}

/** Punteggio per l'uso recente: decresce lungo la lista dei comandi eseguiti di recente. */
export function recencyBoost(recentIds: readonly string[], id: string): number {
  const index = recentIds.indexOf(id)
  return index < 0 ? 0 : Math.max(0, 30 - index * 4)
}

/** Filtra e ordina per punteggio (stabile a parità), fermandosi a limit risultati. */
export function rankCandidates<T>(query: string, candidates: SearchCandidate<T>[], limit: number): T[] {
  return candidates
    .map((candidate, index) => {
      const score = matchScore(query, candidate.text)
      return { candidate, index, score: score === null ? null : score + (candidate.boost ?? 0) }
    })
    .filter((entry): entry is { candidate: SearchCandidate<T>; index: number; score: number } => entry.score !== null)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map((entry) => entry.candidate.item)
}

const DOUBLE_SHIFT_WINDOW_MS = 350

/**
 * Riconosce il doppio Shift di Search Everywhere: due pressioni di Shift da solo entro la finestra,
 * senza altri tasti in mezzo. Restituisce il gestore da collegare a keydown.
 */
export function createDoubleShiftDetector(onTrigger: () => void, now: () => number = Date.now): (event: Pick<KeyboardEvent, 'key' | 'repeat' | 'ctrlKey' | 'metaKey' | 'altKey'>) => void {
  let lastShift = -Infinity
  return (event) => {
    if (event.key !== 'Shift' || event.repeat || event.ctrlKey || event.metaKey || event.altKey) {
      lastShift = -Infinity
      return
    }
    const time = now()
    if (time - lastShift <= DOUBLE_SHIFT_WINDOW_MS) {
      lastShift = -Infinity
      onTrigger()
      return
    }
    lastShift = time
  }
}
