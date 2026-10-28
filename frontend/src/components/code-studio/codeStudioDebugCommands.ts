import { confirm } from '@/lib/confirmDialog'
import type { GoIDEDebugRequest, GoIDEDebugStepAction, GoIDEJavaDebugRequest, GoIDEPythonDebugRequest, GoIDERustDebugRequest, GoIDEWebDebugRequest } from '@/lib/code-studio-debug-api'
import { activeDebugView, useCodeStudioDebugStore } from '@/stores/codeStudioDebug'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import type { CodeStudioCommandContext, CodeStudioCommandId } from './codeStudioCommands'
import { activeCodeStudioEditor } from './codeStudioEditorRegistry'
import { runToCursorAt, toggleBreakpointAtCursor } from './codeStudioDebugEditor'
import { useCodeStudioBreakpointUi } from './codeStudioBreakpoints'

type DebugState = CodeStudioCommandContext['debugState']

const STEP_ACTIONS: Partial<Record<CodeStudioCommandId, GoIDEDebugStepAction>> = {
  'debug.resume': 'continue',
  'debug.pause': 'pause',
  'debug.stepOver': 'next',
  'debug.stepInto': 'stepIn',
  'debug.stepOut': 'stepOut',
}

/** Stato del debug mostrato nella sessione, ridotto a quello che serve ai comandi. */
export function selectDebugState(sessionId: string | null) {
  return (state: Parameters<typeof activeDebugView>[0]): DebugState => {
    const view = sessionId ? activeDebugView(state, sessionId) : null
    if (!view || view.info.state === 'terminated') return 'none'
    return view.info.state as DebugState
  }
}

async function confirmInstallDelve(sessionId: string): Promise<void> {
  const approved = await confirm({
    title: 'Install Delve?',
    message: "Command: go install github.com/go-delve/delve/cmd/dlv@latest\n\nDownloads the Go debugger through your Go proxy and installs it into adOmnia's local tools folder, using the Go SDK selected for this project. Output appears in the Run console.",
    confirmLabel: 'Install Delve',
  })
  if (approved) await useCodeStudioDebugStore.getState().installDelve(sessionId)
}

/**
 * Esegue i comandi del debugger. `configuredRequest` costruisce la richiesta per Debug (Shift+F9)
 * dalla configurazione Run attiva. Restituisce false se il comando non appartiene al debugger.
 */
export function runDebugCommand(id: CodeStudioCommandId, sessionId: string | null, configuredRequest: () => GoIDEDebugRequest | null, javaRequest: () => GoIDEJavaDebugRequest | null = () => null, pythonRequest: () => GoIDEPythonDebugRequest | null = () => null, rustRequest: () => GoIDERustDebugRequest | null = () => null, webRequest: () => GoIDEWebDebugRequest | null = () => null): boolean {
  if (id === 'view.debug') { useCodeStudioLspStore.getState().showToolWindow('debug'); return true }
  if (id === 'debug.toggleBreakpoint') { toggleBreakpointAtCursor(activeCodeStudioEditor()); return true }
  if (id === 'debug.viewBreakpoints') { useCodeStudioBreakpointUi.getState().setDialogOpen(true); return true }
  if (id === 'debug.runToCursor') { runToCursorAt(activeCodeStudioEditor()); return true }
  if (!sessionId) return false
  const debug = useCodeStudioDebugStore.getState()
  if (id === 'go.installDelve') { void confirmInstallDelve(sessionId); return true }
  if (id === 'debug.muteBreakpoints') {
    const files = Object.values(debug.breakpoints[sessionId] ?? {})
    void debug.setAllBreakpointsDisabled(sessionId, files.some((states) => states.some((state) => !state.disabled)))
    return true
  }
  if (id === 'debug.debug') {
    // Una configurazione Java o Python ha la precedenza: non passa da Delve.
    const java = javaRequest()
    if (java) { void debug.startJava(java); return true }
    const python = pythonRequest()
    if (python) { void debug.startPython(python); return true }
    const rust = rustRequest()
    if (rust) { void debug.startRust(rust); return true }
    const web = webRequest()
    if (web) { void debug.startWeb(web); return true }
    const request = configuredRequest()
    if (request) void debug.start(request)
    return true
  }
  const view = activeDebugView(debug, sessionId)
  if (id === 'debug.stop') { if (view) void debug.stop(view.info.id); return true }
  if (id === 'debug.restart') { if (view?.request || view?.javaRequest || view?.pythonRequest || view?.rustRequest || view?.webRequest) void debug.restart(view.info.id); return true }
  const action = STEP_ACTIONS[id]
  if (!action) return false
  if (view) void debug.step(view.info.id, action)
  return true
}
