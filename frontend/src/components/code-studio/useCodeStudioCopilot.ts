import { logBackgroundError } from '@/lib/code-studio/backgroundError'
import { useEffect } from 'react'
import { focusCopilotDocument, setCopilotWorkspace } from '@/lib/copilot-api'
import { useCopilotStore } from '@/stores/copilot'

/**
 * Collega Code Studio a Copilot: carica lo stato, comunica il progetto attivo (per scegliere
 * l'account GitHub legato a quel progetto) e il file a fuoco (per suggerimenti più pertinenti).
 */
export function useCodeStudioCopilot(projectRoot: string | null, activeDocumentId: string | null): void {
  useEffect(() => { void useCopilotStore.getState().ensure() }, [])

  useEffect(() => {
    if (projectRoot) void setCopilotWorkspace(projectRoot).catch(logBackgroundError('copilot context'))
  }, [projectRoot])

  useEffect(() => {
    if (activeDocumentId) void focusCopilotDocument(activeDocumentId).catch(logBackgroundError('copilot context'))
  }, [activeDocumentId])
}
