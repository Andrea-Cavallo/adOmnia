import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { useCodeStudioTasksStore } from '@/stores/codeStudioTasks'

/** Id del task nella status bar per l'installazione dei language server web. */
export const WEB_TOOLS_TASK = 'install-web-language-servers'

/**
 * Un'installazione di tool parte in background: senza segnali l'utente non sa che sta girando né dove
 * guardare. Apre la console Run (dove arriva l'output) e mostra un'attività in corso nella status bar.
 */
export function beginToolInstall(sessionId: string, id: string, label: string): void {
  useCodeStudioTasksStore.getState().begin(sessionId, { id, label })
  useCodeStudioLspStore.getState().showToolWindow('run')
}

/** Chiude l'attività; un fallimento riporta in primo piano la console con l'errore. */
export function endToolInstall(sessionId: string, id: string, succeeded: boolean): void {
  useCodeStudioTasksStore.getState().finish(sessionId, id, succeeded ? 'completed' : 'failed')
  if (!succeeded) useCodeStudioLspStore.getState().showToolWindow('run')
}

export function showInstallOutput(): void {
  useCodeStudioLspStore.getState().showToolWindow('run')
}
