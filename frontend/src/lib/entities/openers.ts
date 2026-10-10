import { blankRequest } from '@/lib/types'
import { appendMockEndpoints, createMockEndpointFromRequest } from '@/lib/mockEndpointStore'
import { readDevContextFile } from '@/lib/devcontext-api'
import { useAppStore } from '@/stores/app'
import type { RailItem } from '@/stores/app'
import { useEnvironmentsStore } from '@/stores/environments'
import { useGoIDEStore } from '@/stores/goide'
import { showModule } from '@/lib/moduleRouting'
import { detachedPanelOfThisWindow } from '@/lib/panel-windows-api'
import { handoffToPanel } from './dispatch'
import { showEntityNotice } from './notice'
import { registerOpener } from './router'
import { httpMethodForRoute, mockPathForRoute, requestUrlForRoute, withBaseUrl } from './routeRequest'
import type { EntityRef } from './types'

const DB_TYPES = new Set(['postgres', 'mysql', 'mongodb', 'redis'])
const DEFAULT_GO_HTTP = 'http://localhost:8080'

/** `:50051` → `localhost:50051`: l'indirizzo di ascolto del server diventa quello da chiamare. */
export function grpcTargetAddress(listen: string | undefined): string {
  const address = (listen ?? '').trim()
  if (!address) return 'localhost:50051'
  if (address.startsWith(':')) return `localhost${address}`
  return address.replace(/^(0\.0\.0\.0|\[::\])(?=:)/, 'localhost')
}

/** URL ws:// per un endpoint WebSocket del codice: client → URL letterale, server → baseUrl dell'ambiente + path. */
export function websocketUrlFor(ref: EntityRef, baseUrl: string | undefined): string {
  if (ref.attrs.url) return ref.attrs.url
  const base = (baseUrl || DEFAULT_GO_HTTP).replace(/^http/, 'ws').replace(/\/+$/, '')
  return `${base}${ref.attrs.path ?? '/'}`
}
const CONTRACT_RAILS: Record<string, RailItem> = { oas: 'apidocs', proto: 'grpc', wsdl: 'soap' }

async function openInGo(file: string, line: number, sessionId?: string): Promise<void> {
  // From a module window, the code opens in the main window's Go Studio.
  if (detachedPanelOfThisWindow() !== null) return showModule('goide', { kind: 'open-location', file, line, sessionId })
  if (sessionId) {
    if (!useGoIDEStore.getState().sessions.some(session => session.id === sessionId)) throw new Error('The source project is no longer open')
    await useGoIDEStore.getState().selectSession(sessionId)
  }
  useAppStore.getState().setActiveRail('goide')
  await useGoIDEStore.getState().openLocation(file, line, 1)
}

function sendRoute(ref: EntityRef): void {
  const request = { ...blankRequest(httpMethodForRoute(ref.attrs.method ?? 'GET'), ref.label), url: requestUrlForRoute(ref.attrs.path ?? '/') }
  showModule('collections', { kind: 'open-request', request })
}

async function mockRoute(ref: EntityRef): Promise<void> {
  const request = { ...blankRequest(httpMethodForRoute(ref.attrs.method ?? 'GET'), ref.label), url: mockPathForRoute(ref.attrs.path ?? '/') }
  const endpoint = createMockEndpointFromRequest(request)
  if (!endpoint) throw new Error(`${request.method} cannot be mocked`)
  await appendMockEndpoints([endpoint])
  // The mock panel may be open in another window: tell it to reload its endpoints.
  showModule('mock', { kind: 'event', name: 'adomnia:mock-endpoints-updated' })
  showEntityNotice(`Mock endpoint ${request.method} ${request.url} added.`)
}

function proposeBaseUrl(ref: EntityRef): void {
  const envs = useEnvironmentsStore.getState()
  const env = envs.environments.find((e) => e.id === envs.activeEnvId)
  if (!env) {
    showEntityNotice('Select an environment first, then use this service as its baseUrl.')
    return
  }
  const url = `http://${ref.attrs.host ?? 'localhost'}:${ref.attrs.port}`
  showEntityNotice(`Set baseUrl to ${url} in "${env.name}"?`, {
    label: 'Set baseUrl',
    run: () => useEnvironmentsStore.getState().updateVariables(env.id, withBaseUrl(env.variables, url)),
  })
}

function showEnvVar(ref: EntityRef): void {
  const value = ref.attrs.value ?? '(not set in any .env file)'
  const where = ref.source ? ` — ${ref.source.file}:${ref.source.line}` : ''
  showEntityNotice(`${ref.label} = ${value}${where}`)
}

async function openContract(ref: EntityRef): Promise<void> {
  const rail = CONTRACT_RAILS[ref.attrs.type ?? '']
  if (!rail || !ref.sessionId) throw new Error('unsupported contract')
  const text = await readDevContextFile(ref.sessionId, ref.attrs.path ?? ref.label)
  handoffToPanel(rail, ref, 'open', { text, name: ref.label })
}

/** Registers the v1 openers once; returns a disposer (used by HMR and tests). */
export function registerDefaultOpeners(): () => void {
  const offs = [
    registerOpener('*', {
      intent: 'source', title: 'Open source in gO',
      available: (ref) => ref.kind !== 'symbol' && !!ref.source,
      run: (ref) => openInGo(ref.source!.file, ref.source!.line),
    }),
    registerOpener('symbol', { intent: 'open', title: 'Open in gO', isDefault: true, run: (ref) => openInGo(ref.source!.file, ref.source!.line, ref.sessionId) }),
    registerOpener('route', { intent: 'send', title: 'Send in API Client', isDefault: true, run: sendRoute }),
    registerOpener('route', {
      intent: 'handler', title: 'Go to handler',
      available: (ref) => !!ref.attrs.handlerFile,
      run: (ref) => openInGo(ref.attrs.handlerFile, Number(ref.attrs.handlerLine) || 1),
    }),
    registerOpener('route', { intent: 'mock', title: 'Add to Mock Server', run: mockRoute }),
    registerOpener('service', { intent: 'baseUrl', title: 'Use as baseUrl', isDefault: true, available: (ref) => !!ref.attrs.port, run: proposeBaseUrl }),
    registerOpener('datasource', {
      intent: 'connect', title: 'Connect', isDefault: true,
      run: (ref) => handoffToPanel(DB_TYPES.has(ref.attrs.type) ? 'database' : 'broker', ref, 'connect'),
    }),
    registerOpener('contract', { intent: 'open', title: 'Open', isDefault: true, available: (ref) => !!CONTRACT_RAILS[ref.attrs.type ?? ''], run: openContract }),
    registerOpener('envvar', { intent: 'show', title: 'Show value', isDefault: true, run: showEnvVar }),
    registerOpener('table', { intent: 'query', title: 'Query in Database', isDefault: true, run: (ref) => handoffToPanel('database', ref, 'query') }),
    registerOpener('topic', { intent: 'open', title: 'Open in Broker Studio', isDefault: true, run: (ref) => handoffToPanel('broker', ref, 'open') }),
    registerOpener('grpc', {
      intent: 'reflect', title: 'Call in gRPC client', isDefault: true,
      run: (ref) => handoffToPanel('grpc', ref, 'reflect', { address: grpcTargetAddress(ref.attrs.address) }),
    }),
    registerOpener('websocket', {
      intent: 'connect', title: 'Open in WebSocket client', isDefault: true,
      available: (ref) => !!ref.attrs.url || !!ref.attrs.path,
      run: (ref) => handoffToPanel('websocket', ref, 'connect', { url: websocketUrlFor(ref, useEnvironmentsStore.getState().getResolvedVars().baseUrl) }),
    }),
  ]
  return () => offs.forEach((off) => off())
}
