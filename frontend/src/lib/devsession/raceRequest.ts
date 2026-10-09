import { stopLiveSession, waitLiveReady, type LiveSession, type RequestRun } from '@/lib/devsession-api'
import { confirm } from '@/lib/confirmDialog'
import { sendRequest } from '@/lib/sendRequest'
import { useDevSessionStore } from '@/stores/devSession'
import { useEnvironmentsStore } from '@/stores/environments'
import { useTabsStore } from '@/stores/tabs'
import { timeOf } from '@/stores/devSessionModel'
import { DebugRequestError, startGoCommand } from './debugRequest'
import { liveVars } from './liveRequest'
import { openLocationInGoStudio } from './navigation'

const START_TIMEOUT_MS = 180_000 // a -race build is slower
const READY_TIMEOUT_MS = 60_000
/** Races are reported when the second access happens; give background work a moment after the response. */
const SETTLE_MS = 1500

/** Number of race reports the service printed since a time. */
export function raceReports(lines: readonly { text: string; at: string }[], since: string): number {
  return lines.filter((line) => timeOf(line.at) >= timeOf(since) && line.text.includes('WARNING: DATA RACE')).length
}

function waitForRunSession(goSessionId: string, since: string): Promise<LiveSession> {
  return new Promise((resolve, reject) => {
    const pick = () => {
      const state = useDevSessionStore.getState()
      return state.order.map((id) => state.sessions[id]).find((s) => s && s.goSessionId === goSessionId && s.kind === 'run' && !s.endedAt && timeOf(s.startedAt) >= timeOf(since)) ?? null
    }
    const timer = window.setTimeout(() => { unsubscribe(); reject(new DebugRequestError('The service did not start with -race in time.')) }, START_TIMEOUT_MS)
    const unsubscribe = useDevSessionStore.subscribe(() => {
      const found = pick()
      if (found) { unsubscribe(); window.clearTimeout(timer); resolve(found) }
    })
    const found = pick()
    if (found) { unsubscribe(); window.clearTimeout(timer); resolve(found) }
  })
}

/**
 * Re-run with race detector: restart the service with -race (active run configuration of its project),
 * send the same request again and count the DATA RACE reports it printed.
 * ponytail: restarts the project's active configuration; a service started from another package keeps its own flags.
 */
export async function raceRequest(run: RequestRun, session: LiveSession): Promise<string> {
  const tab = useTabsStore.getState().tabs.find((item) => item.id === run.tabId)
  if (!tab) throw new Error('The request tab was closed.')
  const ok = await confirm({
    title: `Restart ${session.service} with the race detector?`,
    message: `${session.service} will be stopped and started again with -race, then this request is sent once more.`,
    confirmLabel: 'Restart with -race',
  })
  if (!ok) throw new DebugRequestError('Cancelled.')
  const since = new Date(Date.now() - 1000).toISOString()
  await stopLiveSession(session.id)
  await startGoCommand(session.goSessionId, 'run.runRace')
  const raced = await waitForRunSession(session.goSessionId, since)
  await waitLiveReady(raced.id, useDevSessionStore.getState().prefs.healthPaths[raced.service] ?? '', READY_TIMEOUT_MS)
  const sentAt = new Date().toISOString()
  const response = await sendRequest(tab.request, liveVars(useEnvironmentsStore.getState().getResolvedVars()))
  if (response.error) throw new Error(`The request failed under -race: ${response.error.message}`)
  await new Promise((resolve) => window.setTimeout(resolve, SETTLE_MS))
  const races = raceReports(useDevSessionStore.getState().logs[raced.id] ?? [], sentAt)
  if (races > 0) await openLocationInGoStudio(raced.goSessionId, null)
  return races ? `${races} data race${races === 1 ? '' : 's'} reported: see the Run console in Go Studio.` : `No data race on this request (HTTP ${response.status}).`
}
