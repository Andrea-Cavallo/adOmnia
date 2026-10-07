import { useEffect } from 'react'

/**
 * Richieste che arrivano a Go Studio da altri moduli (es. Kubernetes Studio) per agganciarsi a un
 * servizio remoto già raggiunto con un port forward su 127.0.0.1. Sono dati semplici: viaggiano anche
 * fra finestre con routeToModule('goide', { kind: 'dispatch', … }).
 */
export const GO_REMOTE_EVENT = 'adomnia:go-remote'

export type GoRemoteRequest =
  | { action: 'debug'; address: string; label: string }
  | { action: 'profile'; url: string; kind: string; seconds?: number; label: string }
  | { action: 'trace'; url: string; seconds?: number; label: string }

export type GoRemoteDetail = GoRemoteRequest & { handled?: boolean }

type ArtifactView = 'profile' | 'trace'

let pending: { view: ArtifactView; path: string } | null = null
const listeners = new Set<() => void>()

/** Chiede al pannello Profile o Trace di mostrare il file appena catturato (anche se non è ancora montato). */
export function focusArtifact(view: ArtifactView, path: string): void {
  pending = { view, path }
  listeners.forEach((listener) => listener())
}

/** Il pannello riceve il file da mostrare una sola volta, al montaggio o quando arriva. */
export function useFocusedArtifact(view: ArtifactView, onPath: (path: string) => void): void {
  useEffect(() => {
    const take = () => {
      if (pending?.view !== view) return
      const { path } = pending
      pending = null
      onPath(path)
    }
    take()
    listeners.add(take)
    return () => { listeners.delete(take) }
  }, [view, onPath])
}
