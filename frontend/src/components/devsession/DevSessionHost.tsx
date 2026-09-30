import { useEffect, useState } from 'react'
import { useAppStore, type RailItem } from '@/stores/app'
import { useDevSessionStore } from '@/stores/devSession'
import { liveSessions } from '@/stores/devSessionModel'
import { openSplitDebugView } from '@/lib/devsession/navigation'
import { ContextSwitcher } from './ContextSwitcher'
import { ServiceLogsDrawer } from './ServiceLogsDrawer'

/** Alt+Shift+1…5: move between the tools of one development flow (Go Studio keeps Alt+digit for its panes). */
export const TOOL_SHORTCUTS: Array<{ code: string; rail: RailItem; label: string }> = [
  { code: 'Digit1', rail: 'goide', label: 'Go Studio' },
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
      useAppStore.getState().setSplitView(false)
      useAppStore.getState().setActiveRail(target.rail)
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
    }
  }), [])

  // A split view without anything live to debug has no purpose.
  useEffect(() => useDevSessionStore.subscribe((state) => {
    if (useAppStore.getState().splitView && !liveSessions(state).some((s) => s.kind === 'debug')) useAppStore.getState().setSplitView(false)
  }), [])

  return (
    <>
      <ContextSwitcher onOpenLogs={setLogsSession} />
      {logsSession && <ServiceLogsDrawer sessionId={logsSession} onClose={() => setLogsSession(null)} />}
    </>
  )
}
