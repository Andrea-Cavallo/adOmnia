import { serverEntry, serverLanguageForEditor, useIdeLanguageServersStore } from '@/stores/ideLanguageServers'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import type { GoIDELanguageServerFeatures } from '@/lib/code-studio-lsp-api'

/** Legenda e capacità appartengono al server del documento, mai a un altro server della sessione. */
export function featuresForEditor(sessionId: string, editorLanguage: string): GoIDELanguageServerFeatures | null {
  const provided = serverLanguageForEditor(editorLanguage)
  const status = provided
    ? serverEntry(useIdeLanguageServersStore.getState(), sessionId, provided)
    : useCodeStudioLspStore.getState().status[sessionId]
  return status?.state === 'ready' ? status.features ?? null : null
}
