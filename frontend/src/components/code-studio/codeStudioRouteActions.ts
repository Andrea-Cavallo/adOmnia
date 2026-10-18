import { Clipboard as WailsClipboard } from '@wailsio/runtime'
import { handoffToPanel } from '@/lib/entities/dispatch'
import { openEntity } from '@/lib/entities/router'
import type { EntityRef } from '@/lib/entities/types'
import { useEnvironmentsStore } from '@/stores/environments'
import type { GoIDEEditorDocument } from '@/stores/codeStudio'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { openApiFromRoutes } from './codeStudioDocsGen'
import { generateCode } from '@/lib/codegen'
import type { DevEntity } from '@/lib/devcontext-api'
import { springStateOf } from '@/stores/codeStudioSpring'
import { findHttpRoutes, requestFromRoute, routeCurl, type CodeStudioHttpRoute } from './codeStudioHttpRoutes'

/** Azioni inline su una route HTTP nel codice: mock, cURL, OpenAPI. */
export type RouteInlineAction = 'mock' | 'curl' | 'openapi'

export const ROUTE_INLINE_ACTIONS: Array<{ action: RouteInlineAction; title: string; tooltip: string }> = [
  { action: 'mock', title: 'Mock', tooltip: 'Add this route to the Mock Server' },
  { action: 'curl', title: 'Copy cURL', tooltip: 'Copy a curl command for this route (base URL from the environment or the code)' },
  { action: 'openapi', title: 'OpenAPI', tooltip: 'Open an OpenAPI description of this route in API Docs' },
]

function routeRef(route: CodeStudioHttpRoute, document: GoIDEEditorDocument): EntityRef {
  const label = `${route.method} ${route.path}`
  return { kind: 'route', id: `route:${label}`, label, attrs: { method: route.method, path: route.path }, sessionId: document.document.sessionId, source: { file: document.document.relativePath, line: route.line } }
}

export async function runRouteInlineAction(document: GoIDEEditorDocument, line: number, action: RouteInlineAction): Promise<void> {
  const route = findHttpRoutes(document.buffer).find((item) => item.line === line)
  if (!route) return
  const notify = (message: string) => useCodeStudioLspStore.setState({ message })
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

/** Spring: `{{baseUrl}}` dell'ambiente se c'è, altrimenti `server.port` dell'applicazione, altrimenti 8080. */
function springBaseUrl(sessionId: string, variables: Record<string, string>): string {
  if (variables.baseUrl) return variables.baseUrl.replace(/\/+$/, '')
  return `http://localhost:${springStateOf(sessionId).index?.serverPort || '8080'}`
}

/**
 * Mock, cURL e OpenAPI su una route già rilevata dal Developer Context (Spring, ma vale per ogni linguaggio
 * che produce entità `route`): stesse azioni delle route Go, senza rileggere il buffer con regex.
 */
export async function runRouteEntityAction(sessionId: string, entity: DevEntity, action: RouteInlineAction): Promise<void> {
  const method = (entity.attrs.method ?? 'GET').toUpperCase()
  const anyMethod = method === 'ANY'
  const line = Number(entity.attrs.declLine) || 1
  const file = entity.attrs.declFile ?? entity.sources?.[0]?.file ?? ''
  const route: CodeStudioHttpRoute = { line, method: anyMethod ? 'GET' : (method as CodeStudioHttpRoute['method']), path: entity.attrs.path ?? '/', anyMethod }
  const ref: EntityRef = { kind: 'route', id: entity.id, label: entity.label, attrs: { method, path: route.path }, sessionId, source: { file, line } }
  const notify = (message: string) => useCodeStudioLspStore.setState({ message })
  if (action === 'mock') {
    await openEntity(ref, 'mock')
    return
  }
  if (action === 'curl') {
    const baseUrl = springBaseUrl(sessionId, useEnvironmentsStore.getState().getResolvedVars())
    await WailsClipboard.SetText(generateCode(requestFromRoute(route, baseUrl, 'Code Studio'), 'curl'))
    notify(`curl for ${route.method} ${route.path} copied.`)
    return
  }
  const spec = openApiFromRoutes([{ kind: 'http', name: `${anyMethod ? '' : `${route.method} `}${route.path}`.trim(), package: file.split('/').slice(0, -1).join('/') || '.', site: { relativePath: file, line, column: 1 } } as never], file)
  handoffToPanel('apidocs', { ...ref, kind: 'contract', attrs: { type: 'oas', path: 'route.json' } }, 'open', { text: JSON.stringify(spec, null, 2), name: 'route.json' })
}
