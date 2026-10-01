export function goStudioUnwrapExpression(expression: string): string {
  return `(${expression}).(interface{ Unwrap() error }).Unwrap()`
}

/**
 * Espressioni per un livello della catena, nell'ordine in cui provarle. Prima il campo di
 * *fmt.wrapError (fmt.Errorf con %w): è una lettura pura, e funziona anche quando il linker ha
 * eliminato Unwrap perché il programma non lo chiama mai. Poi Unwrap() per i tipi d'errore propri.
 */
export function goStudioUnwrapCandidates(expression: string): string[] {
  return [`(${expression}).(*fmt.wrapError).err`, goStudioUnwrapExpression(expression)]
}

/** Delve rende i nil in modi leggermente diversi a seconda del tipo dinamico. */
export function isNilGoStudioDebugValue(value: string): boolean {
  return /^<nil>$|^nil$/i.test(value.trim())
}
