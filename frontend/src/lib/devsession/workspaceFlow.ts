import { getDevContext, type DevEntity } from '@/lib/devcontext-api'
import { serviceNameFor, type LiveSession } from '@/lib/devsession-api'
import { showEntityNotice } from '@/lib/entities/notice'
import { httpMethodForRoute } from '@/lib/entities/routeRequest'
import { routeToModule, showModule } from '@/lib/moduleRouting'
import { blankRequest, uid, type Collection } from '@/lib/types'
import { useCollectionsStore } from '@/stores/collections'
import { useDevSessionStore } from '@/stores/devSession'
import { linkedUrlForRoute } from './codeToApi'
import { streamSessionToLogInspector } from './logInspectorSource'

/** Live services (run or debug, not ended) started from one Go Studio project. */
export function workspaceServices(sessions: Record<string, LiveSession>, goSessionId: string): LiveSession[] {
  return Object.values(sessions)
    .filter((session) => session.goSessionId === goSessionId && !session.endedAt)
    .sort((left, right) => left.service.localeCompare(right.service))
}

/** One request per detected route, linked to the live service through `{{service:NAME}}`. */
export function serviceApiCollection(service: string, routes: readonly DevEntity[]): Collection {
  const seen = new Set<string>()
  const children = []
  for (const route of routes) {
    if (route.kind !== 'route') continue
    const method = httpMethodForRoute(route.attrs.method === 'ANY' ? 'GET' : route.attrs.method ?? 'GET')
    const path = route.attrs.path ?? '/'
    const key = `${method} ${path}`
    if (seen.has(key)) continue
    seen.add(key)
    children.push({ ...blankRequest(method, route.attrs.declName || `${method} ${path}`), url: linkedUrlForRoute(service, path) })
  }
  children.sort((left, right) => left.url.localeCompare(right.url) || left.method.localeCompare(right.method))
  return { id: uid(), name: `${service} API`, children }
}

/** Open API: the service's routes as a collection in the API Workspace (created once, then reused). */
export async function openWorkspaceApi(goSessionId: string): Promise<void> {
  const [service, snapshot] = await Promise.all([serviceNameFor(goSessionId), getDevContext(goSessionId)])
  const collection = serviceApiCollection(service, snapshot.entities)
  if (collection.children.length === 0) {
    showEntityNotice(`No HTTP route detected in ${service}: create requests in the API Workspace with {{service:${service}}} as base URL.`, { label: 'Open API Workspace', run: () => showModule('collections') })
    return
  }
  // ponytail: an existing "<service> API" collection is reused as is; new routes need Open API after renaming or deleting it.
  if (useCollectionsStore.getState().collections.some((item) => item.name === collection.name)) {
    showModule('collections')
    return
  }
  routeToModule('collections', { kind: 'import-collections', collections: [collection] }, { reveal: true })
  showEntityNotice(`${collection.name}: ${collection.children.length} request${collection.children.length === 1 ? '' : 's'} linked to the running service.`)
}

/** Open logs: every live service of the project streams into the Log Inspector. */
export function openWorkspaceLogs(goSessionId: string): boolean {
  const services = workspaceServices(useDevSessionStore.getState().sessions, goSessionId)
  for (const session of services) streamSessionToLogInspector(session.id, session.service)
  if (services.length > 0) showModule('loginspector')
  return services.length > 0
}
