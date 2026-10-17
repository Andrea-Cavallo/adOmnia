/**
 * Memoria della history delle risposte: budget **per peso**, non per numero di elementi.
 * "Ultime N risposte" non protegge la memoria — N body da 50 MB sono gigabyte — quindi ogni
 * cache di risposte si tratta per byte: peso stimato, dedup del doppione base64 sui testuali,
 * ricerca su estratto. I body grandi completi appartengono a un file locale con anteprima in
 * memoria (segue; il budget qui sopra limita già il peggio).
 */

/** Peso di una risposta in byte approssimativi (i caratteri contano 1: largo è meglio di poco). */
export interface WeightedResponse {
  body?: string
  bodyBase64?: string
  headers?: Record<string, string>
  size?: number
}

/** Ogni voce ha id, timestamp, intestazioni e metadati fissi: non lavoriamo su un body solo. */
const ENTRY_OVERHEAD_BYTES = 512

export function responseWeight(response: WeightedResponse | null | undefined): number {
  if (!response) return 0
  const headers = Object.entries(response.headers ?? {})
    .reduce((total, [key, value]) => total + key.length + String(value).length, 0)
  return ENTRY_OVERHEAD_BYTES + (response.body?.length ?? 0) + (response.bodyBase64?.length ?? 0) + headers
}

export interface HistoryBudget {
  maxEntries: number
  maxBytes: number
}

/**
 * Taglia la history (più recente prima) finché vale **entrambi** i budget: esce sempre l'elemento
 * più vecchio, per numero o per peso. Il più recente resta anche se da solo supera il budget:
 * una risposta enorme vale più della sua assenza, e il limite serve a non accumularne di uguali.
 */
export function trimHistoryByWeight<T>(entries: readonly T[], budget: HistoryBudget, weightOf: (entry: T) => number): T[] {
  if (budget.maxEntries <= 0) return []
  const kept = [...entries]
  let total = kept.reduce((sum, entry) => sum + weightOf(entry), 0)
  while (kept.length > 1 && (kept.length > budget.maxEntries || total > budget.maxBytes)) {
    total -= weightOf(kept[kept.length - 1])
    kept.pop()
  }
  return kept
}

/** La ricerca nella history legge solo un estratto per voce: mai concatenare body da megabyte. */
export const HISTORY_SEARCH_EXCERPT_CHARS = 32_768

/**
 * Vero se il body rappresenta già fedelmente il contenuto (testo): in quel caso la copia
 * `bodyBase64` è un doppione perfetto e non serve tenerla. Tipi binari (immagini, pdf, zip…) o
 * sconosciuti la conservano: per loro il base64 è l'unica forma fedele.
 */
export function isTextualResponse(contentType: string, body: string): boolean {
  const type = contentType.toLowerCase()
  if (/(json|text\/|xml|javascript|ecmascript|csv|html|x-www-form-urlencoded|yaml|graphql|svg)/.test(type)) return true
  if (!type.trim()) return !body.includes('\u0000') && !body.includes('\uFFFD')
  return false
}

/** Toglie il doppione base64 dalle risposte testuali (nuove e storiche). */
export function dropRedundantBodyBase64<T extends { body?: string; bodyBase64?: string; contentType?: string }>(response: T): T {
  if (response.bodyBase64 && isTextualResponse(response.contentType ?? '', response.body ?? '')) {
    const { bodyBase64: _dropped, ...rest } = response
    return rest as T
  }
  return response
}
