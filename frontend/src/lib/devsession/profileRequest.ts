import type { LiveSession, RequestRun } from '@/lib/devsession-api'
import { sendRequest } from '@/lib/sendRequest'
import { useTabsStore } from '@/stores/tabs'
import { useEnvironmentsStore } from '@/stores/environments'
import { liveVars } from './liveRequest'
import { openLocationInCodeStudio } from './navigation'

export const PROFILE_SECONDS = 5

/**
 * Profiles the same request: a CPU profile from the service's /debug/pprof while the request is sent
 * again and again, then the profile opens in Performance Studio. Needs net/http/pprof in the service.
 * ponytail: sequential resends; a concurrency knob belongs to load testing, not here.
 */
export async function profileRequest(run: RequestRun, session: LiveSession, onProgress?: (text: string) => void): Promise<string> {
  const tab = useTabsStore.getState().tabs.find((item) => item.id === run.tabId)
  if (!tab) throw new Error('The request tab was closed.')
  if (!session.port) throw new Error('The service port is unknown: set it in the live bar first.')
  const [{ captureGoIDELiveProfile }, { focusArtifact }] = await Promise.all([import('@/lib/code-studio-api'), import('@/lib/code-studio/codeStudioRemote')])
  const vars = liveVars(useEnvironmentsStore.getState().getResolvedVars())
  const capturing = { settled: false }
  const capture = captureGoIDELiveProfile({ sessionId: session.goSessionId, url: `http://127.0.0.1:${session.port}`, kind: 'profile', seconds: PROFILE_SECONDS })
    .finally(() => { capturing.settled = true })
  let sent = 0
  const deadline = Date.now() + PROFILE_SECONDS * 1000
  while (!capturing.settled && Date.now() < deadline) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- requests are deliberately resent one after another while the profile is captured
    const response = await sendRequest(tab.request, vars)
    if (response.error && sent === 0) throw new Error(`The request failed: ${response.error.message}`)
    sent++
    onProgress?.(`Profiling… ${sent} request${sent === 1 ? '' : 's'}`)
  }
  const file = await capture
  focusArtifact('profile', file.relative)
  await openLocationInCodeStudio(session.goSessionId, null)
  const { useCodeStudioLspStore } = await import('@/stores/codeStudioLsp')
  useCodeStudioLspStore.getState().showToolWindow('profile')
  return `${sent} requests in ${PROFILE_SECONDS} s → ${file.relative}`
}
