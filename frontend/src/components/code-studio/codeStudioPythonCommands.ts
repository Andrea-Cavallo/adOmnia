import { confirm } from '@/lib/confirmDialog'
import { getPythonInterpreters, installPythonTool, type GoIDEPythonInterpreter } from '@/lib/code-studio-api'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { studioToast } from '@/stores/codeStudioToast'
import type { CodeStudioCommandId } from './codeStudioCommands'
import { openPythonInterpreterDialog } from './CodeStudioPythonInterpreter'

/** Versione pinnata dello strumento di debug, la stessa che usa il backend. */
const DEBUGPY_PINNED = 'debugpy==1.8.22'

/** Interprete pronto per installare strumenti: la scelta esplicita del progetto, già verificata. */
async function readyInterpreter(sessionId: string): Promise<GoIDEPythonInterpreter | null> {
  const report = await getPythonInterpreters(sessionId)
  if (!report.probed || !report.selected) return null
  return report.installed.find((interpreter) => interpreter.path === report.selected) ?? null
}

/** Installa debugpy nell'interprete scelto; senza una scelta verificata prima serve il dialog. */
async function installDebugpy(sessionId: string): Promise<void> {
  let interpreter: GoIDEPythonInterpreter | null = null
  try {
    interpreter = await readyInterpreter(sessionId)
  } catch (reason) {
    studioToast(reason instanceof Error ? reason.message : String(reason), 'info')
    return
  }
  if (!interpreter) { openPythonInterpreterDialog(sessionId); return }
  if (interpreter.packages?.debugpy) { studioToast('debugpy is already installed in this interpreter', 'info'); return }
  const command = `${interpreter.path} -m pip install ${DEBUGPY_PINNED}`
  const approved = await confirm({
    title: 'Install debugpy?',
    message: `Command: ${command}\n\nInstalls the Python debugger into the selected interpreter with pip. Packages may run their install scripts. Output appears in the Run console.`,
    confirmLabel: 'Install debugpy',
  })
  if (!approved) return
  try {
    await installPythonTool(sessionId, interpreter.path, 'debugpy', true)
    useCodeStudioStore.getState().updateLayout({ bottomOpen: true })
    useCodeStudioLspStore.getState().showToolWindow('run')
  } catch (reason) {
    studioToast(reason instanceof Error ? reason.message : String(reason), 'info')
  }
}

/** Comandi del menu Python. Restituisce false se il comando non appartiene a questo linguaggio. */
export function runPythonCommand(id: CodeStudioCommandId, sessionId: string | null): boolean {
  if (!id.startsWith('python.')) return false
  if (!sessionId) return true
  switch (id) {
    case 'python.selectInterpreter': openPythonInterpreterDialog(sessionId); return true
    case 'python.installDebugpy': void installDebugpy(sessionId); return true
  }
  return true
}
