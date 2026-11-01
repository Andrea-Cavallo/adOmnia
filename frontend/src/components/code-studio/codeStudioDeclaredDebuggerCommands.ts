import { confirm } from '@/lib/confirmDialog'
import { subscribeGoIDEEvents } from '@/lib/code-studio-api'
import { installDebugger, previewDebuggerInstall } from '@/lib/code-studio-debug-api'
import { beginToolInstall, endToolInstall } from '@/stores/codeStudioToolInstall'
import { studioToast } from '@/stores/codeStudioToast'
import type { CodeStudioCommandId } from './codeStudioCommands'

/** Installa il debugger di un linguaggio dichiarato: comando esatto nella conferma, output in console. */
async function installDeclaredDebugger(sessionId: string, language: 'php' | 'cpp'): Promise<void> {
  const php = language === 'php'
  try {
    const plan = await previewDebuggerInstall(sessionId, language)
    const approved = await confirm({
      title: plan.title,
      message: `Command: ${plan.command}\n\n${plan.note}`,
      confirmLabel: php ? 'Install PHP debug adapter' : 'Install C/C++ debugger',
    })
    if (!approved) return
    const execution = await installDebugger(sessionId, language)
    beginToolInstall(sessionId, plan.task, plan.label)
    const stop = subscribeGoIDEEvents((event) => {
      const finished = event.type === 'run.finished' ? (event.payload as { id?: string; exitCode?: number | null; status?: string }) : null
      if (!finished || finished.id !== execution.id) return
      stop()
      const succeeded = finished.exitCode === 0 || finished.status === 'exited'
      endToolInstall(sessionId, plan.task, succeeded)
      if (succeeded) studioToast(php ? 'PHP debug adapter installed. Debug is now available.' : 'C/C++ debugger installed. Debug is now available.', 'success')
    })
  } catch (reason) {
    studioToast(reason instanceof Error ? reason.message : String(reason), 'info')
  }
}

/** Comandi dei linguaggi dichiarati. Restituisce false se il comando non appartiene a questo modulo. */
export function runDeclaredDebuggerCommand(id: CodeStudioCommandId, sessionId: string | null): boolean {
  if (id !== 'php.installDebugger' && id !== 'cpp.installDebugger') return false
  if (sessionId) void installDeclaredDebugger(sessionId, id === 'php.installDebugger' ? 'php' : 'cpp')
  return true
}
