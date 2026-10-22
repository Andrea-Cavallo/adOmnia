import { confirm } from '@/lib/confirmDialog'
import { subscribeGoIDEEvents } from '@/lib/code-studio-api'
import { installRustDebugger, previewRustDebuggerInstall } from '@/lib/code-studio-debug-api'
import { beginToolInstall, endToolInstall } from '@/stores/codeStudioToolInstall'
import { studioToast } from '@/stores/codeStudioToast'
import type { CodeStudioCommandId } from './codeStudioCommands'
import { openRustToolchainDialog } from './CodeStudioRustToolchain'
import { openRustDependencyTree } from './CodeStudioRustTree'

const INSTALL_TASK = 'install-rust-debugger'

/** Installa CodeLLDB: comando esatto nella conferma, output nella console Run, attività in status bar. */
async function installDebugger(sessionId: string): Promise<void> {
  try {
    const plan = await previewRustDebuggerInstall(sessionId)
    const approved = await confirm({ title: plan.title, message: `Command: ${plan.command}\n\n${plan.note}`, confirmLabel: 'Install CodeLLDB' })
    if (!approved) return
    const execution = await installRustDebugger(sessionId)
    beginToolInstall(sessionId, INSTALL_TASK, plan.label)
    const stop = subscribeGoIDEEvents((event) => {
      const finished = event.type === 'run.finished' ? (event.payload as { id?: string; exitCode?: number | null; status?: string }) : null
      if (!finished || finished.id !== execution.id) return
      stop()
      const succeeded = finished.exitCode === 0 || finished.status === 'exited'
      endToolInstall(sessionId, INSTALL_TASK, succeeded)
      if (succeeded) studioToast('CodeLLDB installed. Debug is now available for Rust.', 'success')
    })
  } catch (reason) {
    studioToast(reason instanceof Error ? reason.message : String(reason), 'info')
  }
}

/** Comandi del menu Rust. Restituisce false se il comando non appartiene a questo linguaggio. */
export function runRustCommand(id: CodeStudioCommandId, sessionId: string | null): boolean {
  if (!id.startsWith('rust.')) return false
  if (sessionId && id === 'rust.installDebugger') void installDebugger(sessionId)
  if (sessionId && id === 'rust.selectToolchain') openRustToolchainDialog(sessionId)
  if (sessionId && id === 'rust.dependencyTree') openRustDependencyTree(sessionId)
  return true
}
