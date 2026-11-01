import { useEffect } from 'react'
import { scheduleStartupIdle } from '@/lib/startupIdle'
import { projectHasGo } from '@/lib/code-studio/goProject'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'

/** Settata da Code Studio al primo uso: chi non lo usa mai non paga nessun warm-up. */
export const CODE_STUDIO_USED_KEY = 'adomnia.codeStudio.used'

function usedBefore(): boolean {
  try { return localStorage.getItem(CODE_STUDIO_USED_KEY) === '1' } catch { return false }
}

/**
 * Scalda gopls dell'ultimo progetto autorizzato mentre l'app sta ancora partendo, così
 * "Setting up workspace" è già finito quando si apre Code Studio. Non rende nulla.
 * gopls senza editor si sospende da solo (lsp_idle.go), quindi un warm-up inutile costa poco.
 */
export function CodeStudioWarmup(): null {
  useEffect(() => {
    if (!usedBefore()) return undefined
    return scheduleStartupIdle(() => {
      void (async () => {
        const codeStudio = useCodeStudioStore.getState()
        if (!codeStudio.initialized) await codeStudio.initialize()
        const { activeSessionId, sessions } = useCodeStudioStore.getState()
        const session = sessions.find((item) => item.id === activeSessionId)
        if (!session || session.project.authorization !== 'tooling-permitted') return
        // Stessa regola del pannello: un progetto senza unità Go (Python, Java, una cartella
        // qualsiasi) non scalda né l'SDK Go né gopls. Prima qui partivano comunque `go env` e
        // l'avvio del server: due processi e un conhost per un progetto che non li usa.
        if (!projectHasGo(session.project)) return
        if (!useCodeStudioStore.getState().toolchains[session.id]) await useCodeStudioStore.getState().detectToolchain()
        await useCodeStudioLspStore.getState().ensureStarted(session.id)
      })().catch(() => undefined)
    }, 4000)
  }, [])
  return null
}
