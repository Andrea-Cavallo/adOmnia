import { activeGoIDEDocument, type GoIDEState } from '@/stores/codeStudio'

/** Select primitives so typing does not render the panel unless document status changes. */
export function selectDocumentSummary(state: GoIDEState) {
  const active = activeGoIDEDocument(state)
  let documentCount = 0
  let sessionDirty = false
  for (const item of state.documents) {
    if (item.document.sessionId !== state.activeSessionId) continue
    documentCount++
    sessionDirty = sessionDirty || item.dirty
  }
  return {
    activeId: active?.document.id ?? null,
    activePath: active?.document.relativePath ?? null,
    activeLanguage: active?.document.language ?? null,
    activeReadOnly: !!active?.document.readOnly,
    activeLineEnding: active ? (active.buffer.includes('\r\n') ? 'CRLF' as const : 'LF' as const) : null,
    activeDirty: !!active?.dirty,
    documentCount,
    sessionDirty,
  }
}
