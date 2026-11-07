import type { DevEntity } from '@/lib/devcontext-api'
import { serviceNameFor } from '@/lib/devsession-api'
import { showEntityNotice } from '@/lib/entities/notice'
import type { RequestItem, TreeNode } from '@/lib/types'
import { useAppStore } from '@/stores/app'
import { useCollectionsStore } from '@/stores/collections'
import { useDevSessionStore } from '@/stores/devSession'
import { useEnvironmentsStore } from '@/stores/environments'
import { useTabsStore } from '@/stores/tabs'
import { linkFromRoute, requestMatchesRoute } from '@/lib/api-code-link/resolve'
import { requestForEndpoint } from '@/lib/api-code-link/endpointRequest'
import { useApiCodeLinkStore } from '@/lib/api-code-link/linkStore'
import { liveVars } from './liveRequest'
import { openRequestTab } from './navigation'
import { requestPath, routeMatches } from './routeMatch'

export type HandlerAction = 'open' | 'send' | 'debug' | 'last' | 'history'

/** `/users/{id}` → `{{service:users-service}}/users/{{id}}`. */
export function linkedUrlForRoute(service: string, path: string): string {
  return `{{service:${service}}}${path.replace(/\{([A-Za-z_]\w*)(?:\.\.\.)?\}/g, '{{$1}}')}`
}

function* requestsIn(nodes: TreeNode[]): Generator<RequestItem> {
  for (const node of nodes) {
    if (node.type === 'folder') yield* requestsIn(node.children)
    else yield node
  }
}

/** Opens the request that exercises a route: an open tab, a saved request, or a new linked one. */
export async function openLinkedRequest(goSessionId: string, route: DevEntity): Promise<string | null> {
  const vars = liveVars(useEnvironmentsStore.getState().getResolvedVars())
  const tabs = useTabsStore.getState()
  const open = tabs.tabs.find((tab) => !tab.tool && requestMatchesRoute(tab.request, route, vars))
  if (open) {
    tabs.setActiveTab(open.id)
    return open.id
  }
  for (const collection of useCollectionsStore.getState().collections) {
    for (const request of requestsIn(collection.children)) {
      if (requestMatchesRoute(request, route, vars)) {
        tabs.openTab(request, collection.id)
        return useTabsStore.getState().activeTabId
      }
    }
  }
  const service = await serviceNameFor(goSessionId).catch(() => '')
  const request = requestForEndpoint(route, service || 'Code Studio')
  if (service) request.url = linkedUrlForRoute(service, route.attrs.path ?? '/')
  useTabsStore.getState().openTab(request)
  return useTabsStore.getState().activeTabId
}

/** A request prepared from the current buffer when the project has no `route` entity for it. */
export async function openRouteDraft(goSessionId: string, route: DevEntity): Promise<string | null> {
  return openLinkedRequest(goSessionId, route)
}

/** Delivers a command to the API workspace once it is mounted and showing the tab. */
function dispatchToWorkspace(eventName: string): void {
  const deadline = performance.now() + 5000
  const attempt = () => {
    const detail = { handled: false }
    document.dispatchEvent(new CustomEvent(eventName, { detail }))
    if (!detail.handled && performance.now() < deadline) window.requestAnimationFrame(attempt)
  }
  window.requestAnimationFrame(attempt)
}

/** Code → API: the actions offered next to a handler declaration in Code Studio. */
export async function runHandlerAction(goSessionId: string, route: DevEntity, action: HandlerAction): Promise<void> {
  if (action === 'history') {
    useAppStore.getState().setActiveRail('history')
    return
  }
  if (action === 'last') {
    const state = useDevSessionStore.getState()
    for (let i = state.runOrder.length - 1; i >= 0; i--) {
      const run = state.runs[state.runOrder[i]]
      const path = run && requestPath(run.url)
      const method = (route.attrs.method ?? 'ANY').toUpperCase()
      if (run?.tabId && path && routeMatches(route.attrs.path ?? '', path) && (method === 'ANY' || run.method === method)) {
        openRequestTab(run.tabId)
        return
      }
    }
    showEntityNotice(`No response yet for ${route.label} in this session. Run it first.`)
    return
  }
  const tabId = await openLinkedRequest(goSessionId, route)
  if (!tabId) return
  // The code and the request stay visible together: the link is the source of truth
  // for which endpoint and handler the two panes are showing.
  const { enterApiCodeSplit } = await import('@/lib/api-code-link/actions')
  enterApiCodeSplit()
  useAppStore.getState().keepPanel('codestudio')
  useApiCodeLinkStore.getState().setLink(linkFromRoute(goSessionId, route, tabId))
  if (action === 'send') dispatchToWorkspace('adomnia:send-active-request')
  if (action === 'debug') dispatchToWorkspace('adomnia:debug-active-request')
}
