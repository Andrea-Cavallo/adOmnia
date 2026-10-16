import { useEffect } from 'react'
import { scheduleStartupIdle } from '@/lib/startupIdle'
import { useGoIDEStore } from '@/stores/goide'
import { useGoIDELspStore } from '@/stores/goideLsp'

/** Settata da Go Studio al primo uso: chi non lo usa mai non paga nessun warm-up. */
export const GO_STUDIO_USED_KEY = 'adomnia.goStudio.used'

function usedBefore(): boolean {
  try { return localStorage.getItem(GO_STUDIO_USED_KEY) === '1' } catch { return false }
}

/**
 * Scalda gopls dell'ultimo progetto autorizzato mentre l'app sta ancora partendo, così
 * "Setting up workspace" è già finito quando si apre Go Studio. Non rende nulla.
 * gopls senza editor si sospende da solo (lsp_idle.go), quindi un warm-up inutile costa poco.
 */
export function GoStudioWarmup(): null {
  useEffect(() => {
    if (!usedBefore()) return undefined
    return scheduleStartupIdle(() => {
      void (async () => {
        const goide = useGoIDEStore.getState()
        if (!goide.initialized) await goide.initialize()
        const { activeSessionId, sessions } = useGoIDEStore.getState()
        const session = sessions.find((item) => item.id === activeSessionId)
        if (!session || session.project.authorization !== 'tooling-permitted') return
        if (!useGoIDEStore.getState().toolchains[session.id]) await useGoIDEStore.getState().detectToolchain()
        await useGoIDELspStore.getState().ensureStarted(session.id)
      })().catch(() => undefined)
    }, 4000)
  }, [])
  return null
}
