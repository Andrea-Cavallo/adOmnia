import type { DevEntity } from '@/lib/devcontext-api'
import { serviceNameFor } from '@/lib/devsession-api'
import { showEntityNotice } from '@/lib/entities/notice'
import { httpMethodForRoute } from '@/lib/entities/routeRequest'
import { substVars } from '@/lib/substVars'
import { blankRequest, type RequestItem, type TreeNode } from '@/lib/types'
import { useAppStore } from '@/stores/app'
import { useCollectionsStore } from '@/stores/collections'
import { useDevSessionStore } from '@/stores/devSession'
import { useEnvironmentsStore } from '@/stores/environments'
import { useTabsStore } from '@/stores/tabs'
import { liveVars } from './liveRequest'
import { openRequestTab } from './navigation'
import { requestPath, routeMatches } from './routeMatch'

export type HandlerAction = 'open' | 'send' | 'debug' | 'last' | 'history'

/** `/users/{id}` → `{{service:users-service}}/users/{{id}}`. */
export function linkedUrlForRoute(service: string, path: string): string {
  return `{{service:${service}}}${path.replace(/\{([A-Za-z_]\w*)(?:\.\.\.)?\}/g, '{{$1}}')}`
}

function requestMatchesRoute(request: RequestItem, route: DevEntity, vars: Record<string, string>): boolean {
  const method = (route.attrs.method ?? 'ANY').toUpperCase()
  if (method !== 'ANY' && request.method !== method) return false
  const resolved = substVars(request.url, vars)
  const path = requestPath(resolved) ?? requestPath(resolved.replace(/^\{\{[^}]+\}\}/, ''))
  return !!path && routeMatches(route.attrs.path ?? '', path)
}

function* requestsIn(nodes: TreeNode[]): Generator<RequestItem> {
  for (const node of nodes) {
    if (node.type === 'folder') yield* requestsIn(node.children)
    else yield node
  }
}

/** Opens the request that exercises a route: an open tab, a saved request, or a new linked one. */
async function openLinkedRequest(goSessionId: string, route: DevEntity): Promise<string | null> {
  const vars = liveVars(useEnvironmentsStore.getState().getResolvedVars())
  const tabs = useTabsStore.getState()
  useAppStore.getState().setActiveRail('collections')
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
  const method = httpMethodForRoute(route.attrs.method === 'ANY' ? 'GET' : route.attrs.method ?? 'GET')
  const request = { ...blankRequest(method, route.attrs.declName || route.label), url: service ? linkedUrlForRoute(service, route.attrs.path ?? '/') : `{{baseUrl}}${route.attrs.path ?? '/'}` }
  useTabsStore.getState().openTab(request)
  return useTabsStore.getState().activeTabId
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

/** Code → API: the actions offered next to a handler declaration in Go Studio. */
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
  if (action === 'send') dispatchToWorkspace('adomnia:send-active-request')
  if (action === 'debug') dispatchToWorkspace('adomnia:debug-active-request')
}
