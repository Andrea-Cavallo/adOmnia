import { useEffect, useState } from 'react'
import { useAppStore, type RailItem } from '@/stores/app'
import { useDevSessionStore } from '@/stores/devSession'
import { liveSessions } from '@/stores/devSessionModel'
import { openFrameInCodeStudio, openSplitDebugView } from '@/lib/devsession/navigation'
import { isAuxiliaryPane, isInSplit, placeAuxiliary } from '@/lib/workspaceLayout'
import { useTabsStore } from '@/stores/tabs'
import { ContextSwitcher } from './ContextSwitcher'
import { ServiceLogsDrawer } from './ServiceLogsDrawer'

/** Alt+Shift+1…5: move between the tools of one development flow (Code Studio keeps Alt+digit for its panes). */
export const TOOL_SHORTCUTS: Array<{ code: string; rail: RailItem; label: string }> = [
  { code: 'Digit1', rail: 'codestudio', label: 'Code Studio' },
  { code: 'Digit2', rail: 'collections', label: 'API Workspace' },
  { code: 'Digit3', rail: 'database', label: 'Database' },
  { code: 'Digit4', rail: 'broker', label: 'Kafka / Broker Studio' },
  { code: 'Digit5', rail: 'loginspector', label: 'Logs' },
]

/**
 * Global glue of the Live Development Session: tool shortcuts, the context
 * switcher, the service logs drawer and the automatic Split Debug View when
 * a request sent from the API workspace stops at a breakpoint.
 */
/**
 * Synchronize: a new breakpoint hit while the split is open brings its request tab and its paused
 * frame forward in the panes already on screen, without opening anything else.
 */
function followBreakpoint(tabId: string, session: Parameters<typeof openFrameInCodeStudio>[0] | null): void {
  const tabs = useTabsStore.getState()
  if (tabs.tabs.some((tab) => tab.id === tabId) && tabs.activeTabId !== tabId) tabs.setActiveTab(tabId)
  if (session) void openFrameInCodeStudio(session, null, { switchRail: false })
}

export function DevSessionHost() {
  const [logsSession, setLogsSession] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return
      const target = TOOL_SHORTCUTS.find((item) => item.code === event.code)
      if (!target) return
      event.preventDefault()
      if (target.rail === 'loginspector') {
        const live = liveSessions(useDevSessionStore.getState())
        if (live.length) return setLogsSession(live[live.length - 1].id)
      }
      const app = useAppStore.getState()
      // Inside the split a shortcut moves the keyboard to its pane, or adds Database/Broker/Logs
      // as the third pane: it never throws away the screen the developer built.
      if (isInSplit(target.rail, app.splitView, app.splitAuxiliary)) return app.setActiveRail(target.rail)
      if (app.splitView && isAuxiliaryPane(target.rail) && placeAuxiliary(target.rail)) return
      app.setSplitView(false)
      app.setActiveRail(target.rail)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const onLogs = (event: Event) => setLogsSession((event as CustomEvent<{ sessionId: string }>).detail?.sessionId ?? null)
    document.addEventListener('adomnia:live-logs', onLogs)
    return () => document.removeEventListener('adomnia:live-logs', onLogs)
  }, [])

  // Open the split view when a request from the API workspace stops at a breakpoint.
  useEffect(() => useDevSessionStore.subscribe((state, previous) => {
    if (state.splitTabId && state.splitTabId !== previous.splitTabId) {
      const run = Object.values(state.runs).filter((r) => r.tabId === state.splitTabId).slice(-1)[0]
      void openSplitDebugView(state.splitTabId, run ? state.sessions[run.sessionId] ?? null : null)
      useDevSessionStore.setState({ splitTabId: null })
      return
    }
    if (!state.prefs.autoSplitView) return
    for (const id of state.runOrder.slice(-5)) {
      const run = state.runs[id]
      const before = previous.runs[id]
      if (!run?.tabId || run.hits.length <= (before?.hits.length ?? 0)) continue
      const app = useAppStore.getState()
      if (app.activeRail === 'collections' && !app.splitView) void openSplitDebugView(run.tabId, state.sessions[run.sessionId] ?? null)
      else if (app.splitView) followBreakpoint(run.tabId, state.sessions[run.sessionId] ?? null)
    }
  }), [])

  // The Split Debug View closes when its debugger ends; a split opened for other reasons stays.
  useEffect(() => useDevSessionStore.subscribe((state, previous) => {
    const debugging = (model: typeof state) => liveSessions(model).some((s) => s.kind === 'debug')
    if (useAppStore.getState().splitView && debugging(previous) && !debugging(state)) useAppStore.getState().setSplitView(false)
  }), [])

  return (
    <>
      <ContextSwitcher onOpenLogs={setLogsSession} />
      {logsSession && <ServiceLogsDrawer sessionId={logsSession} onClose={() => setLogsSession(null)} />}
    </>
  )
}
