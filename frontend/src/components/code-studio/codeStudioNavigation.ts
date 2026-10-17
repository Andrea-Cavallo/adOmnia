import { useCodeStudioStore } from '@/stores/codeStudio'
import type { GoIDEEditorLocation } from '@/lib/code-studio-lsp-api'

/**
 * Una posizione dell'editor con la sessione in cui aprirla: un sorgente può vivere in un progetto
 * diverso da quello attivo, come una dipendenza locale importata tra i progetti di adOmnia.
 */
export interface StudioLocation extends GoIDEEditorLocation {
  targetSessionId?: string
}

/** Apre la posizione nel progetto o, per SDK Go, module cache e replace locali, in sola lettura. */
export function navigateToLocation(location: StudioLocation): void {
  const open = () => {
    const store = useCodeStudioStore.getState()
    const { startLine, startColumn } = location.range
    if (location.external || !location.relativePath) void store.openExternalLocation(location.path, startLine, startColumn)
    else void store.openLocation(location.relativePath, startLine, startColumn)
  }
  const sessionId = location.targetSessionId
  if (sessionId && sessionId !== useCodeStudioStore.getState().activeSessionId) {
    void useCodeStudioStore.getState().selectSession(sessionId).then(open)
    return
  }
  open()
}
