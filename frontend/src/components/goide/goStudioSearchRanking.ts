/** Punteggio di corrispondenza: prefisso > parola > sottostringa > sottosequenza; null se non corrisponde. */
export function matchScore(query: string, text: string): number | null {
  const needle = query.trim().toLowerCase()
  if (!needle) return 0
  const haystack = text.toLowerCase()
  if (haystack.startsWith(needle)) return 100 - Math.min(40, haystack.length - needle.length)
  const index = haystack.indexOf(needle)
  if (index >= 0) return (/[\s./_-]/.test(haystack[index - 1] ?? '') ? 70 : 50) - Math.min(20, index)
  let cursor = 0
  for (const character of needle) {
    cursor = haystack.indexOf(character, cursor)
    if (cursor < 0) return null
    cursor += 1
  }
  return 20
}

export interface SearchCandidate<T> {
  item: T
  text: string
}

/** Filtra e ordina per punteggio (stabile a parità), fermandosi a limit risultati. */
export function rankCandidates<T>(query: string, candidates: SearchCandidate<T>[], limit: number): T[] {
  return candidates
    .map((candidate, index) => ({ candidate, index, score: matchScore(query, candidate.text) }))
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
