import { Clipboard as WailsClipboard } from '@wailsio/runtime'
import { handoffToPanel } from '@/lib/entities/dispatch'
import { openEntity } from '@/lib/entities/router'
import type { EntityRef } from '@/lib/entities/types'
import { useEnvironmentsStore } from '@/stores/environments'
import type { GoIDEEditorDocument } from '@/stores/goide'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { openApiFromRoutes } from './goStudioDocsGen'
import { findHttpRoutes, routeCurl, type GoStudioHttpRoute } from './goStudioHttpRoutes'

/** Azioni inline su una route HTTP nel codice: mock, cURL, OpenAPI. */
export type RouteInlineAction = 'mock' | 'curl' | 'openapi'

export const ROUTE_INLINE_ACTIONS: Array<{ action: RouteInlineAction; title: string; tooltip: string }> = [
  { action: 'mock', title: 'Mock', tooltip: 'Add this route to the Mock Server' },
  { action: 'curl', title: 'Copy cURL', tooltip: 'Copy a curl command for this route (base URL from the environment or the code)' },
  { action: 'openapi', title: 'OpenAPI', tooltip: 'Open an OpenAPI description of this route in API Docs' },
]

function routeRef(route: GoStudioHttpRoute, document: GoIDEEditorDocument): EntityRef {
  const label = `${route.method} ${route.path}`
  return { kind: 'route', id: `route:${label}`, label, attrs: { method: route.method, path: route.path }, sessionId: document.document.sessionId, source: { file: document.document.relativePath, line: route.line } }
}

export async function runRouteInlineAction(document: GoIDEEditorDocument, line: number, action: RouteInlineAction): Promise<void> {
  const route = findHttpRoutes(document.buffer).find((item) => item.line === line)
  if (!route) return
  const notify = (message: string) => useGoIDELspStore.setState({ message })
  if (action === 'mock') {
    await openEntity(routeRef(route, document), 'mock')
    return
  }
  if (action === 'curl') {
    await WailsClipboard.SetText(routeCurl(route, document.buffer, useEnvironmentsStore.getState().getResolvedVars()))
    notify(`curl for ${route.method} ${route.path} copied.`)
    return
  }
  const spec = openApiFromRoutes([{ kind: 'http', name: `${route.anyMethod ? '' : `${route.method} `}${route.path}`.trim(), package: document.document.relativePath.split('/').slice(0, -1).join('/') || '.', site: { relativePath: document.document.relativePath, line: route.line, column: 1 } } as never], document.document.relativePath)
  handoffToPanel('apidocs', { ...routeRef(route, document), kind: 'contract', attrs: { type: 'oas', path: 'route.json' } }, 'open', { text: JSON.stringify(spec, null, 2), name: 'route.json' })
}
