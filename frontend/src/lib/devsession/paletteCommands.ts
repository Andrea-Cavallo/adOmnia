import type { DebugAction } from '@/lib/devsession-api'
import { useAppStore } from '@/stores/app'
import { useDevSessionStore } from '@/stores/devSession'
import { primarySession } from '@/stores/devSessionModel'
import { openFrameInGoStudio, openRequestTab } from './navigation'

export interface DevSessionCommand {
  id: string
  title: string
  subtitle: string
  keywords: string
  run: () => void
}

type State = ReturnType<typeof useDevSessionStore.getState>

/** Command palette entries of the Live Development Session: navigation first, then debugger control. */
export function devSessionCommands(state: State): DevSessionCommand[] {
  const commands: DevSessionCommand[] = [
    {
      id: 'live:debug-request', title: 'Debug this request', subtitle: 'Run the Go service under Delve and send the active request',
      keywords: 'debug request delve breakpoint send service live', run: () => {
        useAppStore.getState().setActiveRail('collections')
        requestAnimationFrame(() => document.dispatchEvent(new CustomEvent('adomnia:debug-active-request', { detail: { handled: false } })))
      },
    },
    {
      id: 'live:handler', title: 'Go to handler', subtitle: 'Open the Go handler of the active request',
      keywords: 'handler code route go studio navigate', run: () => document.dispatchEvent(new CustomEvent('adomnia:go-to-handler')),
    },
  ]
  const session = primarySession(state, state.focusedSessionId)
  if (!session) return commands
  commands.push(
    { id: 'live:service', title: `Go to service ${session.service}`, subtitle: 'Service view: project, API, runtime, databases, Kafka, logs', keywords: 'service map view live runtime', run: () => document.dispatchEvent(new CustomEvent('adomnia:live-logs', { detail: { sessionId: session.id } })) },
    { id: 'live:logs', title: 'Go to logs', subtitle: `${session.service} output, tied to requests`, keywords: 'logs output stdout stderr service', run: () => document.dispatchEvent(new CustomEvent('adomnia:live-logs', { detail: { sessionId: session.id } })) },
  )
  let run = null
  for (let i = state.runOrder.length - 1; i >= 0 && !run; i--) {
    const candidate = state.runs[state.runOrder[i]]
    if (candidate?.sessionId === session.id && candidate.tabId) run = candidate
  }
  if (run) {
    commands.push({ id: 'live:request', title: 'Go to current request', subtitle: `${run.method} ${run.url}`, keywords: 'request api tab current live', run: () => openRequestTab(run.tabId) })
    if (session.kind === 'debug') {
      commands.push({ id: 'live:split', title: 'Open Split Debug View', subtitle: 'Go Studio and the API request side by side', keywords: 'split view debug side by side', run: () => state.openSplit(run.tabId ?? null) })
    }
  }
  if (session.kind !== 'debug') return commands
  if (session.pause) {
    commands.push({ id: 'live:breakpoint', title: 'Go to current breakpoint', subtitle: `${session.pause.relativePath || session.pause.file}:${session.pause.line}`, keywords: 'breakpoint paused code go studio', run: () => void openFrameInGoStudio(session) })
  }
  const step = (id: string, title: string, action: DebugAction, keys: string) => ({ id, title, subtitle: `${session.service} · ${keys}`, keywords: `debugger ${action} step`, run: () => void state.step(session.id, action) })
  if (session.state === 'paused') {
    commands.push(
      step('live:continue', 'Continue', 'continue', 'F9'),
      step('live:next', 'Step Over', 'next', 'F8'),
      step('live:in', 'Step Into', 'stepIn', 'F7'),
      step('live:out', 'Step Out', 'stepOut', 'Shift+F8'),
    )
  }
  commands.push({ id: 'live:stop', title: `Stop ${session.service}`, subtitle: 'Stop the debugged service', keywords: 'stop debugger terminate kill', run: () => void state.stop(session.id) })
  return commands
}
