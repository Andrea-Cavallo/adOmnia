/**
 * Ways into a gRPC tab: the gRPC rail item, "New gRPC call", a gRPC service found in code, a .proto contract
 * opened from Code Studio (with the rpc to call and, from Debug, the address of the running service), and the old
 * gRPC panel's saved connection. They all end in the gRPC module, whose tab strip holds only gRPC calls.
 */
import { useAppStore } from '@/stores/app'
import { useTabsStore } from '@/stores/tabs'
import { useEnvironmentsStore } from '@/stores/environments'
import { useGrpcDescriptors } from '@/stores/grpcDescriptors'
import type { RequestItem } from '@/lib/types'
import { blankGrpcRequest, grpcMessage } from './grpcRequest'

/** Long enough for a call that stops on a breakpoint in the debugged handler. */
const DEBUG_CALL_TIMEOUT_MS = 300_000

function showGrpcModule() {
  if (useAppStore.getState().activeRail !== 'grpc') useAppStore.getState().setActiveRail('grpc')
}

export function openGrpcTab(request: RequestItem = blankGrpcRequest()): void {
  useTabsStore.getState().openTab(request)
  showGrpcModule()
}

/** Opens the request and loads its services (reflection or the .proto it carries) in the new tab. */
function openAndLoad(request: RequestItem): void {
  openGrpcTab(request)
  const tabId = useTabsStore.getState().activeTabId
  if (!tabId) return
  void useGrpcDescriptors.getState().load(tabId, request, useEnvironmentsStore.getState().getResolvedVars()).then((descriptors) => {
    // Code names a service by its Go registration (Greeter); the call needs the full name (helloworld.Greeter).
    const service = request.grpc?.service ?? ''
    if (!descriptors || !service || service.includes('.')) return
    const full = descriptors.services.find((item) => item.name.split('.').pop() === service)
    const tab = useTabsStore.getState().tabs.find((item) => item.id === tabId)
    if (full && tab?.request.grpc) useTabsStore.getState().updateRequest(tabId, { ...tab.request, grpc: { ...tab.request.grpc, service: full.name } })
  })
}

/** A gRPC service registered in code: a new call to the server's address, described by reflection. */
export function openGrpcService(address: string, service = ''): void {
  const request = blankGrpcRequest(service ? `${service.split('.').pop()}` : 'gRPC call', address)
  openAndLoad({ ...request, grpc: { ...request.grpc!, service } })
}

/**
 * The import root of a .proto, as protoc would need it: for `package demo.v1` in `/x/proto/demo/v1/echo.proto`
 * it is `/x/proto`. Without a matching layout, '' (the file's own folder is searched anyway).
 */
export function protoImportRoot(path: string, text: string): string {
  const pkg = /^\s*package\s+([\w.]+)\s*;/m.exec(text)?.[1]
  if (!pkg) return ''
  const separator = path.includes('\\') ? '\\' : '/'
  const folder = path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')))
  const suffix = pkg.split('.').join(separator)
  return folder.endsWith(`${separator}${suffix}`) ? folder.slice(0, folder.length - suffix.length - 1) : ''
}

/**
 * A .proto opened from code: a call described by that file (its path when known, so later edits apply; its
 * text otherwise), with the rpc selected; from Debug, pointed at the running service with a long deadline.
 */
export function openGrpcContract(payload: { text?: string; name?: string; path?: string; importPath?: string; service?: string; method?: string; address?: string }): void {
  const name = payload.name || 'contract.proto'
  const importRoot = payload.importPath || (payload.path && payload.text ? protoImportRoot(payload.path, payload.text) : '')
  const base = blankGrpcRequest(payload.method ? `${payload.method}` : name.replace(/\.proto$/, ''), payload.address ?? '')
  const grpc = {
    ...base.grpc!,
    source: 'proto' as const,
    protoFiles: payload.path ? [payload.path] : [],
    importPaths: importRoot ? [importRoot] : [],
    inlineProtos: payload.path || !payload.text ? undefined : { [name]: payload.text },
    service: payload.service ?? '',
    method: payload.method ?? '',
    timeoutMs: payload.address ? DEBUG_CALL_TIMEOUT_MS : 0,
  }
  openAndLoad({ ...base, bodies: [grpcMessage('Message 1', '{}')], grpc })
}

// ---- the panel before gRPC moved into the workspace

const LEGACY_CONNECTIONS_KEY = 'adomnia.grpc.connections'
const MIGRATED_KEY = 'adomnia.grpc.migratedToWorkspace'

interface LegacyConnection { name?: string; address?: string; useTls?: boolean; caCertPath?: string; clientCertPath?: string; clientKeyPath?: string }

/** The old panel's saved connections become gRPC calls, once; the old key stays in place. */
export function legacyGrpcRequests(storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): RequestItem[] {
  try {
    if (storage.getItem(MIGRATED_KEY)) return []
    storage.setItem(MIGRATED_KEY, '1')
    const saved: unknown = JSON.parse(storage.getItem(LEGACY_CONNECTIONS_KEY) ?? '[]')
    if (!Array.isArray(saved)) return []
    return (saved as LegacyConnection[]).filter((connection) => connection.address).map((connection) => {
      const request = blankGrpcRequest(connection.name || connection.address, connection.address)
      return { ...request, grpc: { ...request.grpc!, tls: !!connection.useTls, caCertPath: connection.caCertPath ?? '', clientCertPath: connection.clientCertPath ?? '', clientKeyPath: connection.clientKeyPath ?? '' } }
    })
  } catch {
    return []
  }
}

/** Called when the module opens with no call of its own. */
export function migrateLegacyGrpcTabs(): void {
  const requests = legacyGrpcRequests()
  requests.forEach((request) => useTabsStore.getState().openTab(request))
}
