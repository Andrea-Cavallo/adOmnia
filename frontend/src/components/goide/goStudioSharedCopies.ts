interface SharedCandidate {
  document: { id: string; sessionId: string; path: string; readOnly?: boolean }
  dirty: boolean
}

/** La sola chiave che serve per trovare le copie: percorso, sessione e stato read-only. */
export interface SharedKey {
  path: string
  sessionId: string
  readOnly?: boolean
}

/** Copie dello stesso file aperte in altri progetti (progetti annidati come /repo e /repo/svc). */
export function copiesInOtherSessions<T extends SharedCandidate>(documents: T[], active: T): T[] {
  return copiesForKey(documents, active.document)
}

/**
 * Come `copiesInOtherSessions`, ma prende solo la chiave del documento attivo: il risultato
 * si può memoizzare senza dipendere dall'identità dell'oggetto documento (cambia a ogni
 * battuta, la chiave no).
 */
export function copiesForKey<T extends SharedCandidate>(documents: T[], active: SharedKey): T[] {
  if (active.readOnly) return []
  return documents.filter((item) => item.document.sessionId !== active.sessionId && item.document.path === active.path)
}
