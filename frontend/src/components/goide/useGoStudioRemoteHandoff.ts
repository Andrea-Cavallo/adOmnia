import { useEffect } from 'react'
import { captureGoIDELiveProfile, captureGoIDELiveTrace } from '@/lib/goide-api'
import { focusArtifact, GO_REMOTE_EVENT, type GoRemoteDetail } from '@/lib/goide/goStudioRemote'
import { useGoIDEStore } from '@/stores/goide'
import { useGoIDEDebugStore } from '@/stores/goideDebug'
import { useGoIDELspStore } from '@/stores/goideLsp'

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Esegue nel progetto attivo le richieste remote di altri moduli: collega Delve a un pod, cattura un
 * profilo o una trace da un servizio raggiunto con port forward. Il sorgente è quello del progetto aperto.
 */
export function useGoStudioRemoteHandoff(): void {
  useEffect(() => {
    const onRemote = (event: Event) => {
      const detail = (event as CustomEvent<GoRemoteDetail>).detail
      detail.handled = true
      const store = useGoIDEStore.getState()
      const session = store.sessions.find((item) => item.id === store.activeSessionId)
      if (!session) {
        useGoIDEStore.setState({ error: `Open the project that runs on ${detail.label} to ${detail.action} it: breakpoints and stacks map to its source.` })
        return
      }
      const lsp = useGoIDELspStore.getState()
      void (async () => {
        try {
          if (detail.action === 'debug') {
            lsp.showToolWindow('debug')
            await useGoIDEDebugStore.getState().start({ sessionId: session.id, mode: 'remote', address: detail.address, workingDirectory: '', target: '' })
            return
          }
          useGoIDELspStore.setState({ message: `Capturing ${detail.action === 'trace' ? 'an execution trace' : `a ${detail.kind} profile`} from ${detail.label}…` })
          const file = detail.action === 'trace'
            ? await captureGoIDELiveTrace({ sessionId: session.id, url: detail.url, seconds: detail.seconds })
            : await captureGoIDELiveProfile({ sessionId: session.id, url: detail.url, kind: detail.kind, seconds: detail.seconds })
          useGoIDELspStore.setState({ message: `Saved ${file.relative} from ${detail.label}.` })
          focusArtifact(detail.action, file.relative)
          lsp.showToolWindow(detail.action)
          void store.refreshProject()
        } catch (error) {
          useGoIDEStore.setState({ error: `${detail.label}: ${message(error)}` })
        }
      })()
    }
    document.addEventListener(GO_REMOTE_EVENT, onRemote)
    return () => document.removeEventListener(GO_REMOTE_EVENT, onRemote)
  }, [])
}
