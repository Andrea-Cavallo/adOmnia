import type { DevEntity, DevSnapshot } from '@/lib/devcontext-api'

export interface CatalogSource {
  sessionId: string
  projectName: string
  root: string
  snapshot?: DevSnapshot
}

export interface CatalogEndpoint {
  id: string
  sessionId: string
  projectName: string
  group: string
  route: DevEntity
  method: string
  path: string
  handler: string
  file: string
  line: number
}

function shortenedGroup(value: string): string {
  const parts = value.split(/[\\/]/).filter(Boolean)
  return parts.length === 0 ? value : parts[parts.length - 1]
}

/** Controller/package label: Java uses the class, Go/Python the containing folder. */
export function endpointGroup(route: DevEntity): string {
  const declared = route.attrs.declName ?? ''
  const dot = declared.indexOf('.')
  if (dot > 0) return declared.slice(0, dot)
  const file = route.attrs.declFile ?? route.sources?.[0]?.file ?? ''
  const dir = file.split('/').slice(0, -1).join('/')
  return shortenedGroup(dir || 'Endpoints')
}

/** Endpoints of the open projects, without duplicates and in a stable order. */
export function endpointCatalog(sources: CatalogSource[]): CatalogEndpoint[] {
  const items: CatalogEndpoint[] = []
  const seen = new Set<string>()
  for (const source of sources) {
    for (const route of source.snapshot?.entities ?? []) {
      if (route.kind !== 'route') continue
      const key = `${source.sessionId}:${route.id}`
      if (seen.has(key)) continue
      seen.add(key)
      const declared = !!route.attrs.declFile
      items.push({
        id: key,
        sessionId: source.sessionId,
        projectName: source.projectName,
        group: endpointGroup(route),
        route,
        method: (route.attrs.method ?? 'ANY').toUpperCase(),
        path: route.attrs.path ?? '/',
        handler: route.attrs.declName || route.attrs.handler || route.label,
        file: declared ? route.attrs.declFile : route.attrs.handlerFile ?? route.sources?.[0]?.file ?? '',
        line: Number(declared ? route.attrs.declLine : route.attrs.handlerLine) || route.sources?.[0]?.line || 1,
      })
    }
  }
  return items.sort((a, b) => a.projectName.localeCompare(b.projectName) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
}

export interface CatalogGroup {
  projectName: string
  groups: Array<{ name: string; items: CatalogEndpoint[] }>
}

/** Project → controller/package → endpoints. */
export function groupCatalog(items: CatalogEndpoint[]): CatalogGroup[] {
  const byProject = new Map<string, Map<string, CatalogEndpoint[]>>()
  for (const item of items) {
    const groups = byProject.get(item.projectName) ?? new Map<string, CatalogEndpoint[]>()
    const entries = groups.get(item.group) ?? []
    entries.push(item)
    groups.set(item.group, entries)
    byProject.set(item.projectName, groups)
  }
  return [...byProject.entries()].map(([projectName, groups]) => ({
    projectName,
    groups: [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, entries]) => ({ name, items: entries })),
  })).sort((a, b) => a.projectName.localeCompare(b.projectName))
}

/** Case-insensitive filter over method, path, handler, group and project; all words must match. */
export function filterCatalog(items: CatalogEndpoint[], query: string): CatalogEndpoint[] {
  const needles = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (needles.length === 0) return items
  return items.filter((item) => {
    const haystack = [item.method, item.path, item.handler, item.group, item.projectName].join(' ').toLowerCase()
    return needles.every((needle) => haystack.includes(needle))
  })
}
