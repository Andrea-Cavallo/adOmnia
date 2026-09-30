import { useEffect } from 'react'
import { focusCopilotDocument, setCopilotWorkspace } from '@/lib/copilot-api'
import { useCopilotStore } from '@/stores/copilot'

/**
 * Collega Go Studio a Copilot: carica lo stato, comunica il progetto attivo (per scegliere
 * l'account GitHub legato a quel progetto) e il file a fuoco (per suggerimenti più pertinenti).
 */
export function useGoStudioCopilot(projectRoot: string | null, activeDocumentId: string | null): void {
  useEffect(() => { void useCopilotStore.getState().ensure() }, [])

  useEffect(() => {
    if (projectRoot) void setCopilotWorkspace(projectRoot).catch(() => undefined)
  }, [projectRoot])

  useEffect(() => {
    if (activeDocumentId) void focusCopilotDocument(activeDocumentId).catch(() => undefined)
  }, [activeDocumentId])
}
