import { confirm } from '@/lib/confirmDialog'
import { subscribeGoIDEEvents } from '@/lib/code-studio-api'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { beginToolInstall, endToolInstall } from '@/stores/codeStudioToolInstall'
import { studioToast } from '@/stores/codeStudioToast'

const MODULE = 'github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest'
const TASK = 'tool:golangci-lint-rebuild'
const rebuilding = new Set<string>()

/**
 * golangci-lint compilato con un Go troppo vecchio: un solo consenso con il comando esatto, poi la ricompilazione con
 * l'SDK del progetto (output nella console Run, attività nella status bar) e, a fine installazione, il lint riparte da solo.
 */
export async function rebuildStaleLinter(sessionId: string, changedOnly: boolean): Promise<void> {
  if (rebuilding.has(sessionId)) return
  rebuilding.add(sessionId)
  try {
    const approved = await confirm({
      title: 'Rebuild golangci-lint?',
      message: `The installed golangci-lint was built with an older Go than this project uses, so it refuses to run.\n\nCommand: go install ${MODULE}\n\nIt is rebuilt with the Go SDK selected for this project into adOmnia's local tools folder, then the lint runs again on its own. Output appears in the Run console.`,
      confirmLabel: 'Rebuild and run lint',
    })
    if (!approved) return
    const lsp = useCodeStudioLspStore.getState()
    const execution = await lsp.installLinter(sessionId, 'golangci-lint')
    if (!execution) return
    beginToolInstall(sessionId, TASK, 'Rebuilding golangci-lint…')
    await new Promise<void>((resolve) => {
      const stop = subscribeGoIDEEvents((event) => {
        const finished = event.type === 'run.finished' ? (event.payload as { id?: string; exitCode?: number | null; status?: string }) : null
        if (!finished || finished.id !== execution.id) return
        stop()
        const succeeded = finished.exitCode === 0 || finished.status === 'exited'
        endToolInstall(sessionId, TASK, succeeded)
        if (succeeded) {
          studioToast('golangci-lint rebuilt. Running lint…', 'success')
          void useCodeStudioLspStore.getState().detectLinter(sessionId).then(() => useCodeStudioLspStore.getState().runLint(sessionId, changedOnly))
        }
        resolve()
      })
    })
  } finally {
    rebuilding.delete(sessionId)
  }
}
