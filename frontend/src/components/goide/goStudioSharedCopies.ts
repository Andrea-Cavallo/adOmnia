interface SharedCandidate {
  document: { id: string; sessionId: string; path: string; readOnly?: boolean }
  dirty: boolean
}

/** Copie dello stesso file aperte in altri progetti (progetti annidati come /repo e /repo/svc). */
export function copiesInOtherSessions<T extends SharedCandidate>(documents: T[], active: T): T[] {
  if (active.document.readOnly) return []
  return documents.filter((item) => item.document.sessionId !== active.document.sessionId && item.document.path === active.document.path)
}
