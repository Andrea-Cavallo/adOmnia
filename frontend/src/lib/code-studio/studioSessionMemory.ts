/** Additive local preference: existing workspace/session files stay unchanged. */
export function studioSessionMemoryKey(workspaceId: string): string {
  return `adomnia.codestudio.activeSession.${workspaceId}`
}

export function rememberedStudioSession(sessions: readonly { id: string }[], workspaceId: string): string | null {
  try {
    const remembered = localStorage.getItem(studioSessionMemoryKey(workspaceId))
    if (sessions.some(session => session.id === remembered)) return remembered
  } catch { /* Storage unavailable: keep the existing first-project fallback. */ }
  return sessions[0]?.id ?? null
}
