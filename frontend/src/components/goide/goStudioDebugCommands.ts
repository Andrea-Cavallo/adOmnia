import { confirm } from '@/lib/confirmDialog'
import type { GoIDEDebugRequest, GoIDEDebugStepAction } from '@/lib/goide-debug-api'
import { activeDebugView, useGoIDEDebugStore } from '@/stores/goideDebug'
import { useGoIDELspStore } from '@/stores/goideLsp'
import type { GoStudioCommandContext, GoStudioCommandId } from './goStudioCommands'
import { activeGoStudioEditor } from './goStudioEditorRegistry'
import { runToCursorAt, toggleBreakpointAtCursor } from './goStudioDebugEditor'
import { useGoStudioBreakpointUi } from './goStudioBreakpoints'

type DebugState = GoStudioCommandContext['debugState']

const STEP_ACTIONS: Partial<Record<GoStudioCommandId, GoIDEDebugStepAction>> = {
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
  if (approved) await useGoIDEDebugStore.getState().installDelve(sessionId)
}

/**
 * Esegue i comandi del debugger. `configuredRequest` costruisce la richiesta per Debug (Shift+F9)
 * dalla configurazione Run attiva. Restituisce false se il comando non appartiene al debugger.
 */
export function runDebugCommand(id: GoStudioCommandId, sessionId: string | null, configuredRequest: () => GoIDEDebugRequest | null): boolean {
  if (id === 'view.debug') { useGoIDELspStore.getState().showToolWindow('debug'); return true }
  if (id === 'debug.toggleBreakpoint') { toggleBreakpointAtCursor(activeGoStudioEditor()); return true }
  if (id === 'debug.viewBreakpoints') { useGoStudioBreakpointUi.getState().setDialogOpen(true); return true }
  if (id === 'debug.runToCursor') { runToCursorAt(activeGoStudioEditor()); return true }
  if (!sessionId) return false
  const debug = useGoIDEDebugStore.getState()
  if (id === 'go.installDelve') { void confirmInstallDelve(sessionId); return true }
  if (id === 'debug.muteBreakpoints') {
    const files = Object.values(debug.breakpoints[sessionId] ?? {})
    void debug.setAllBreakpointsDisabled(sessionId, files.some((states) => states.some((state) => !state.disabled)))
    return true
  }
  if (id === 'debug.debug') {
    const request = configuredRequest()
    if (request) void debug.start(request)
    return true
  }
  const view = activeDebugView(debug, sessionId)
  if (id === 'debug.stop') { if (view) void debug.stop(view.info.id); return true }
  const action = STEP_ACTIONS[id]
  if (!action) return false
  if (view) void debug.step(view.info.id, action)
  return true
}
