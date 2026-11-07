import {
  createPythonEnvironment,
  getPythonEnvironment,
  installPythonDependencies,
  subscribeGoIDEEvents,
  type GoIDEExecution,
} from '@/lib/code-studio-api'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { serverEntry, useIdeLanguageServersStore } from '@/stores/ideLanguageServers'
import { studioToast } from '@/stores/codeStudioToast'
import { pythonUnitOfManifest } from '@/lib/code-studio/pythonDependencyManifest'

const CREATE_TIMEOUT_MS = 5 * 60 * 1000
const INSTALL_TIMEOUT_MS = 15 * 60 * 1000

function openRunConsole(): void {
  useCodeStudioStore.getState().updateLayout({ bottomOpen: true })
  useCodeStudioLspStore.getState().showToolWindow('run')
}

/** Resolves when the execution finishes; false on a nonzero exit or timeout. */
function waitForExecution(sessionId: string, execution: GoIDEExecution, timeoutMs: number): Promise<boolean> {
  if (execution.finishedAt) return Promise.resolve(execution.exitCode === 0)
  return new Promise((resolve) => {
    let settled = false
    let unsubscribe = () => {}
    const finish = (succeeded: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsubscribe()
      resolve(succeeded)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    unsubscribe = subscribeGoIDEEvents((event) => {
      if (event.sessionId !== sessionId || event.type !== 'run.finished') return
      const payload = event.payload as { id?: string; exitCode?: number | null }
      if (payload.id === execution.id) finish(payload.exitCode === 0)
    })
  })
}

/**
 * Installs the dependencies of the Python unit that owns a requirements.txt/pyproject.toml.
 * Both commands are shown before they run; when no .venv exists the environment is created
 * first (explicitly), then pip installs into it. basedpyright is restarted afterwards so the
 * new packages resolve in the editor instead of leaving "Import could not be resolved".
 */
export async function installPythonDependenciesForManifest(sessionId: string, manifestPath: string): Promise<void> {
  const unit = pythonUnitOfManifest(manifestPath)
  try {
    let plan = await getPythonEnvironment(sessionId, unit)
    if (!plan.install.available) {
      if (!plan.create.available) {
        studioToast(plan.install.reason || plan.create.reason || 'No Python environment to install into', 'info')
        return
      }
      const createCommand = plan.create.command ?? 'python -m venv .venv'
      const installPreview = plan.install.command ?? 'pip install -r requirements.txt'
      if (!window.confirm(`No Python environment yet.\n\nCreate: ${createCommand}\nInstall: ${installPreview}\n\nCreate the environment and install the dependencies now?`)) return
      const creation = await createPythonEnvironment(sessionId, unit, plan.create.executable ?? '', true)
      openRunConsole()
      if (!(await waitForExecution(sessionId, creation, CREATE_TIMEOUT_MS))) {
        studioToast('The Python environment could not be created. See the Run console.', 'info')
        return
      }
      plan = await getPythonEnvironment(sessionId, unit)
      if (!plan.install.available) {
        studioToast(plan.install.reason || 'The environment does not contain a Python interpreter', 'info')
        return
      }
    }
    const command = plan.install.command ?? ''
    if (!window.confirm(`Install the dependencies of this Python unit?\n\n${command}\n\nThe command runs in the project environment; output appears in the Run console.`)) return
    studioToast('Installing Python dependencies…', 'info')
    const installation = await installPythonDependencies(sessionId, unit, true)
    openRunConsole()
    if (!(await waitForExecution(sessionId, installation, INSTALL_TIMEOUT_MS))) {
      studioToast('Python dependencies were not installed. See the Run console.', 'info')
      return
    }
    // basedpyright keeps its import cache per server process: restart it so the packages
    // just installed are visible to completion and diagnostics on the open files.
    const server = serverEntry(useIdeLanguageServersStore.getState(), sessionId, 'python')
    if (server.state === 'ready' || server.state === 'crashed') {
      await useIdeLanguageServersStore.getState().restart(sessionId, 'python').catch(() => undefined)
    }
    studioToast('Python dependencies installed and the language server refreshed.', 'success')
  } catch (reason) {
    studioToast(reason instanceof Error ? reason.message : String(reason), 'info')
  }
}
