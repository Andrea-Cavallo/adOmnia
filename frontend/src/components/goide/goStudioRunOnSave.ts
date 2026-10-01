import { useGoIDEStore } from '@/stores/goide'

const RESTART_DELAY_MS = 300
const timers = new Map<string, number>()

/** Esecuzioni da riavviare: in corso, avviate da una configurazione con "Restart on save" attivo. */
export function runsToRestart(state: Pick<ReturnType<typeof useGoIDEStore.getState>, 'executions' | 'configByRun' | 'runConfigsBySession'>, sessionId: string): string[] {
  const configs = state.runConfigsBySession[sessionId] ?? []
  return state.executions
    .filter((execution) => execution.sessionId === sessionId && execution.status === 'running')
    .filter((execution) => configs.some((config) => config.id === state.configByRun[execution.id] && config.restartOnSave))
    .map((execution) => execution.id)
}

/**
 * Hot restart: dopo il salvataggio di un file Go riparte ogni esecuzione con "Restart on save".
 * Più salvataggi ravvicinati (Save All) producono un solo riavvio.
 */
export function restartRunsOnSave(sessionId: string, relativePath: string): void {
  if (!relativePath.toLowerCase().endsWith('.go')) return
  window.clearTimeout(timers.get(sessionId))
  timers.set(sessionId, window.setTimeout(() => {
    timers.delete(sessionId)
    const state = useGoIDEStore.getState()
    for (const runId of runsToRestart(state, sessionId)) void state.restartRun(runId)
  }, RESTART_DELAY_MS))
}
