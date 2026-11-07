import { confirm } from '@/lib/confirmDialog'
import { subscribeGoIDEEvents } from '@/lib/code-studio-api'
import { beginToolInstall, endToolInstall } from '@/stores/codeStudioToolInstall'
import { studioToast } from '@/stores/codeStudioToast'

interface InstallPlanPreview { title: string; command: string; note: string; task: string; label: string }

export interface VisibleInstall {
  preview: () => Promise<InstallPlanPreview>
  install: () => Promise<{ id: string }>
  confirmLabel: string
  done: string
}

/**
 * Installs a tool the visible way: the exact command in the confirmation, the output in the Run console, a
 * task in the status bar until the process ends (codeStudioToolInstall). Never silent.
 */
export async function runVisibleInstall(sessionId: string, target: VisibleInstall): Promise<void> {
  try {
    const plan = await target.preview()
    const approved = await confirm({ title: plan.title, message: `Command: ${plan.command}\n\n${plan.note}`, confirmLabel: target.confirmLabel })
    if (!approved) return
    const execution = await target.install()
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
