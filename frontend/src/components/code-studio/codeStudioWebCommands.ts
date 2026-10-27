import { confirm } from '@/lib/confirmDialog'
import { subscribeGoIDEEvents } from '@/lib/code-studio-api'
import { installWebDebugger, previewWebDebuggerInstall } from '@/lib/code-studio-debug-api'
import { beginToolInstall, endToolInstall } from '@/stores/codeStudioToolInstall'
import { studioToast } from '@/stores/codeStudioToast'
import type { CodeStudioCommandId } from './codeStudioCommands'

const INSTALL_TASK = 'install-web-debugger'

/** Installa js-debug: comando esatto nella conferma, output nella console Run, attività in status bar. */
async function installDebugger(sessionId: string): Promise<void> {
  try {
    const plan = await previewWebDebuggerInstall(sessionId)
    const approved = await confirm({ title: plan.title, message: `Command: ${plan.command}\n\n${plan.note}`, confirmLabel: 'Install js-debug' })
    if (!approved) return
    const execution = await installWebDebugger(sessionId)
    beginToolInstall(sessionId, INSTALL_TASK, plan.label)
    const stop = subscribeGoIDEEvents((event) => {
      const finished = event.type === 'run.finished' ? (event.payload as { id?: string; exitCode?: number | null; status?: string }) : null
      if (!finished || finished.id !== execution.id) return
      stop()
      const succeeded = finished.exitCode === 0 || finished.status === 'exited'
      endToolInstall(sessionId, INSTALL_TASK, succeeded)
      if (succeeded) studioToast('js-debug installed. Debug is now available for JavaScript and TypeScript.', 'success')
    })
  } catch (reason) {
    studioToast(reason instanceof Error ? reason.message : String(reason), 'info')
  }
}

/** Comandi del menu Tools per il web. Restituisce false se il comando non appartiene a questo linguaggio. */
export function runWebCommand(id: CodeStudioCommandId, sessionId: string | null): boolean {
  if (id !== 'web.installDebugger') return false
  if (sessionId) void installDebugger(sessionId)
  return true
}
