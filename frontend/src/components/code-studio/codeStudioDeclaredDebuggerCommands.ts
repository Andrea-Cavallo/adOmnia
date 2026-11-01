import { confirm } from '@/lib/confirmDialog'
import { subscribeGoIDEEvents } from '@/lib/code-studio-api'
import { installDebugger, previewDebuggerInstall } from '@/lib/code-studio-debug-api'
import { beginToolInstall, endToolInstall } from '@/stores/codeStudioToolInstall'
import { studioToast } from '@/stores/codeStudioToast'
import type { CodeStudioCommandId } from './codeStudioCommands'

type DeclaredDebugger = { language: string; confirmLabel: string; done: string }

const DEBUGGERS = new Map<CodeStudioCommandId, DeclaredDebugger>([
  ['php.installDebugger', { language: 'php', confirmLabel: 'Install PHP debug adapter', done: 'PHP debug adapter installed. Debug is now available.' }],
  ['cpp.installDebugger', { language: 'cpp', confirmLabel: 'Install native debugger', done: 'Native debugger installed. Debug is now available.' }],
  ['dotnet.installDebugger', { language: 'csharp', confirmLabel: 'Install .NET debugger', done: '.NET debugger installed. Debug is now available.' }],
])

/** Installa il debugger di un linguaggio dichiarato: comando esatto nella conferma, output in console. */
async function installDeclaredDebugger(sessionId: string, target: DeclaredDebugger): Promise<void> {
  try {
    const plan = await previewDebuggerInstall(sessionId, target.language)
    const approved = await confirm({
      title: plan.title,
      message: `Command: ${plan.command}

${plan.note}`,
      confirmLabel: target.confirmLabel,
    })
    if (!approved) return
    const execution = await installDebugger(sessionId, target.language)
    beginToolInstall(sessionId, plan.task, plan.label)
    const stop = subscribeGoIDEEvents((event) => {
      const finished = event.type === 'run.finished' ? (event.payload as { id?: string; exitCode?: number | null; status?: string }) : null
      if (!finished || finished.id !== execution.id) return
      stop()
      const succeeded = finished.exitCode === 0 || finished.status === 'exited'
      endToolInstall(sessionId, plan.task, succeeded)
      if (succeeded) studioToast(target.done, 'success')
    })
  } catch (reason) {
    studioToast(reason instanceof Error ? reason.message : String(reason), 'info')
  }
}

/** Comandi dei linguaggi dichiarati. Restituisce false se il comando non appartiene a questo modulo. */
export function runDeclaredDebuggerCommand(id: CodeStudioCommandId, sessionId: string | null): boolean {
  const target = DEBUGGERS.get(id)
  if (!target) return false
  if (sessionId) void installDeclaredDebugger(sessionId, target)
  return true
}
