import { showEntityNotice } from '@/lib/entities/notice'
import { showModule } from '@/lib/moduleRouting'
import { useAppStore } from '@/stores/app'
import { useTabsStore } from '@/stores/tabs'
import { useDevContextStore } from '@/stores/devcontext'
import type { DevSnapshot } from '@/lib/devcontext-api'
import { linkFromCandidate, linkFromRoute, findRouteInSnapshot, endpointCandidatesForHandler, endpointCandidatesForRequest } from './resolve'
import { useApiCodeLinkStore } from './linkStore'
import { enterSplit } from '@/lib/workspaceLayout'
import type { ApiCodeLink, EndpointCandidate } from './types'

export interface OpenRequestInCodeStudioInput {
  requestTabId: string
  method: string
  url: string
  vars?: Record<string, string>
}

export interface OpenHandlerInApiInput {
  sessionId: string
  file: string
  line: number
  routeId?: string
  /** Prepared from the buffer when the Developer Context has no entity for this line. */
  fallback?: { method: string; path: string; label?: string }
}

/** Keeps both modules mounted and shows them side by side without unmounting either. */
export function enterApiCodeSplit(): void {
  enterSplit()
}

/** Gives the keyboard to one side of the split, keeping both mounted. */
function focusSide(side: 'code' | 'api'): void {
  useAppStore.getState().setActiveRail(side === 'code' ? 'codestudio' : 'collections')
}

function offerCodeStudio(): void {
  showEntityNotice('No project is open in Code Studio, so there is no handler to show.', {
    label: 'Open Code Studio',
    run: () => showModule('codestudio'),
  })
}

async function codeStudioSessions(): Promise<{ id: string; label: string }[]> {
  const { useCodeStudioStore } = await import('@/stores/codeStudio')
  const studio = useCodeStudioStore.getState()
  if (!studio.initialized) await studio.initialize()
  return useCodeStudioStore.getState().sessions.map((session) => ({ id: session.id, label: session.project.name }))
}

async function preferredSessionForTab(tabId: string): Promise<string | undefined> {
  try {
    const { useDevSessionStore } = await import('@/stores/devSession')
    const state = useDevSessionStore.getState()
    const run = state.runs[state.runByTab[tabId]]
    return run ? state.sessions[run.sessionId]?.goSessionId : undefined
  } catch {
    return undefined
  }
}

async function ensureSnapshots(sessionIds: string[]): Promise<Record<string, DevSnapshot>> {
  await Promise.all(sessionIds.map((id) => useDevContextStore.getState().ensure(id)))
  const snapshots = useDevContextStore.getState().snapshots
  return Object.fromEntries(sessionIds.map((id) => [id, snapshots[id]]).filter((entry): entry is [string, DevSnapshot] => !!entry[1]))
}

async function revealCandidate(candidate: EndpointCandidate, origin: ApiCodeLink['origin'], requestTabId?: string): Promise<void> {
  enterApiCodeSplit()
  focusSide(origin === 'request' ? 'api' : 'code')
  useApiCodeLinkStore.getState().setLink(linkFromCandidate(candidate, origin, requestTabId))
  if (requestTabId) useTabsStore.getState().setActiveTab(requestTabId)
  if (!candidate.file) {
    showEntityNotice(`${candidate.method} ${candidate.path} was found, but its handler declaration is not known yet.`)
    return
  }
  const { useCodeStudioStore } = await import('@/stores/codeStudio')
  if (useCodeStudioStore.getState().activeSessionId !== candidate.sessionId) await useCodeStudioStore.getState().selectSession(candidate.sessionId)
  await useCodeStudioStore.getState().openLocation(candidate.file, candidate.line, 1)
}

function chooseCandidate(title: string, description: string, candidates: EndpointCandidate[], origin: ApiCodeLink['origin'], requestTabId?: string): void {
  useApiCodeLinkStore.getState().openChooser({
    title,
    description,
    choices: candidates.map((candidate) => ({
      id: `${candidate.sessionId}:${candidate.route.id}`,
      label: `${candidate.method} ${candidate.path}`,
      detail: `${candidate.handler || 'handler'} · ${candidate.file}:${candidate.line}`,
      project: candidate.projectName,
      run: () => revealCandidate(candidate, origin, requestTabId),
    })),
  })
}

/**
 * API → Code Studio: resolves the handler of a request in the open projects and
 * shows both sides. A request that matches endpoints in several projects asks
 * which one instead of guessing.
 */
export async function openRequestInCodeStudio(input: OpenRequestInCodeStudioInput): Promise<void> {
  try {
    const sessions = await codeStudioSessions()
    if (sessions.length === 0) return offerCodeStudio()
    const preferSessionId = await preferredSessionForTab(input.requestTabId)
    const vars = input.vars ?? {}
    // A request already tied to a live service is resolved in its project only:
    // another project exposing the same path must never steal the link.
    if (preferSessionId && sessions.some((session) => session.id === preferSessionId)) {
      const local = await ensureSnapshots([preferSessionId])
      const candidates = endpointCandidatesForRequest(local, input.method, input.url, vars, { sessionId: preferSessionId })
      if (candidates.length === 0) return showNoHandler(input)
      if (candidates.length === 1) return revealCandidate(candidates[0], 'request', input.requestTabId)
      return chooseCandidate('Several handlers serve this request', 'Only the selected project is linked; nothing is redirected across projects.', candidates, 'request', input.requestTabId)
    }
    const snapshots = await ensureSnapshots(sessions.map((session) => session.id))
    const candidates = endpointCandidatesForRequest(snapshots, input.method, input.url, vars)
    if (candidates.length === 0) return showNoHandler(input)
    if (candidates.length === 1) return revealCandidate(candidates[0], 'request', input.requestTabId)
    chooseCandidate('Several handlers serve this request', 'Only the selected project is linked; nothing is redirected across projects.', candidates, 'request', input.requestTabId)
  } catch (error) {
    showEntityNotice(`Open in Code Studio failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function showNoHandler(input: OpenRequestInCodeStudioInput): void {
  showEntityNotice(`No handler for ${input.method.toUpperCase()} ${input.url} in the projects open in Code Studio.`)
}

/**
 * Code Studio → API workspace: finds the endpoint of the handler at a source
 * location (declaration first, registration line second) and opens the request
 * that exercises it, or prepares a linked draft when none exists.
 */
export async function openHandlerInApiWorkspace(input: OpenHandlerInApiInput): Promise<void> {
  try {
    await useDevContextStore.getState().ensure(input.sessionId)
    const snapshots = useDevContextStore.getState().snapshots
    const snapshot = snapshots[input.sessionId]
    if (!snapshot) {
      showEntityNotice('The Developer Context of this project is not available yet. Try again in a moment.')
      return
    }
    if (input.routeId) {
      const route = findRouteInSnapshot(snapshot, input.routeId)
      if (route) return runHandlerCandidate(input.sessionId, routeEntityCandidate(snapshot, route))
    }
    const candidates = endpointCandidatesForHandler(snapshots, input.sessionId, input.file, input.line)
    if (candidates.length === 1) return runHandlerCandidate(input.sessionId, candidates[0])
    if (candidates.length > 1) {
      useApiCodeLinkStore.getState().openChooser({
        title: 'Several endpoints use this handler',
        description: 'Pick the request to open next to the code.',
        choices: candidates.map((candidate) => ({
          id: candidate.route.id,
          label: `${candidate.method} ${candidate.path}`,
          detail: `${candidate.handler} · ${candidate.file}:${candidate.line}`,
          project: candidate.projectName,
          run: () => runHandlerCandidate(input.sessionId, candidate),
        })),
      })
      return
    }
    if (input.fallback) return openDraft(input, input.fallback)
    showEntityNotice(`No HTTP endpoint is linked to ${input.file}:${input.line}.`)
  } catch (error) {
    showEntityNotice(`Open in API Workspace failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function routeEntityCandidate(snapshot: DevSnapshot, route: EndpointCandidate['route']): EndpointCandidate {
  const declared = !!route.attrs.declFile
  return {
    sessionId: snapshot.sessionId,
    projectName: snapshot.root.split(/[\\/]/).filter(Boolean).pop() ?? snapshot.sessionId,
    projectRoot: snapshot.root,
    route,
    method: (route.attrs.method ?? 'ANY').toUpperCase(),
    path: route.attrs.path ?? '/',
    file: declared ? route.attrs.declFile : route.attrs.handlerFile ?? route.sources[0]?.file ?? '',
    line: Number(declared ? route.attrs.declLine : route.attrs.handlerLine) || route.sources[0]?.line || 1,
    handler: route.attrs.declName || route.attrs.handler || route.label,
    score: 0,
  }
}

async function runHandlerCandidate(sessionId: string, candidate: EndpointCandidate): Promise<void> {
  const { runHandlerAction } = await import('@/lib/devsession/codeToApi')
  await runHandlerAction(sessionId, candidate.route, 'open')
}

async function openDraft(input: OpenHandlerInApiInput, fallback: NonNullable<OpenHandlerInApiInput['fallback']>): Promise<void> {
  const { openRouteDraft } = await import('@/lib/devsession/codeToApi')
  const route = {
    id: `draft:${input.file}:${input.line}`,
    kind: 'route' as const,
    label: fallback.label ?? `${fallback.method.toUpperCase()} ${fallback.path}`,
    attrs: { method: fallback.method.toUpperCase(), path: fallback.path },
    sources: [{ detector: 'buffer', file: input.file, line: input.line }],
    confidence: 'inferred' as const,
  }
  const tabId = await openRouteDraft(input.sessionId, route)
  enterApiCodeSplit()
  focusSide('api')
  useApiCodeLinkStore.getState().setLink({
    sessionId: input.sessionId,
    routeId: '',
    method: fallback.method.toUpperCase(),
    path: fallback.path,
    file: input.file,
    line: input.line,
    handler: fallback.label ?? '',
    requestTabId: tabId ?? undefined,
    origin: 'code',
    createdAt: Date.now(),
  })
  showEntityNotice('No endpoint was detected in the project: a prefilled draft request is ready. Save it to keep it.')
}

/** Shows an already-resolved route in the split (used by the live request strip). */
export async function showLinkedRoute(sessionId: string, route: EndpointCandidate['route'], requestTabId?: string): Promise<void> {
  const link = linkFromRoute(sessionId, route, requestTabId)
  enterApiCodeSplit()
  focusSide('api')
  useApiCodeLinkStore.getState().setLink(link)
  if (requestTabId) useTabsStore.getState().setActiveTab(requestTabId)
  if (!link.file) return
  const { useCodeStudioStore } = await import('@/stores/codeStudio')
  if (useCodeStudioStore.getState().activeSessionId !== sessionId) await useCodeStudioStore.getState().selectSession(sessionId)
  await useCodeStudioStore.getState().openLocation(link.file, link.line, 1)
}

/**
 * Keeps the selected relationship honest: a route removed by a rescan marks the
 * link stale (nothing is silently redirected), and a closed tab is unlinked.
 */
let syncDisposer: (() => void) | null = null

export function startApiCodeLinkSync(): () => void {
  if (syncDisposer) return syncDisposer
  let lastSnapshot = ''
  const offSnapshots = useDevContextStore.subscribe((state) => {
    const link = useApiCodeLinkStore.getState().link
    if (!link?.routeId) return
    const snapshot = state.snapshots[link.sessionId]
    if (!snapshot) return
    const marker = `${link.sessionId}:${snapshot.version}`
    if (marker === lastSnapshot) return
    lastSnapshot = marker
    useApiCodeLinkStore.getState().markStale(!findRouteInSnapshot(snapshot, link.routeId))
  })
  const offTabs = useTabsStore.subscribe((state) => {
    const link = useApiCodeLinkStore.getState().link
    if (!link?.requestTabId) return
    if (state.tabs.some((tab) => tab.id === link.requestTabId)) return
    useApiCodeLinkStore.getState().setLink({ ...link, requestTabId: undefined })
  })
  syncDisposer = () => {
    offSnapshots()
    offTabs()
    syncDisposer = null
  }
  return syncDisposer
}

/** Shows the split again from the current link, e.g. after closing it. */
export function restoreApiCodeSplit(): void {
  enterApiCodeSplit()
  if (useApiCodeLinkStore.getState().link) focusSide('code')
}
