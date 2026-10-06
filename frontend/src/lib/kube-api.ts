import { serverUrl, sidecarFetch } from '@/lib/useServerPort'

export interface KubePod {
  name: string
  namespace: string
  phase: string
  ready: string
  restarts: number
  age: string
  node: string
  containers: string[]
  labels: Record<string, string>
}

export interface KubeContexts {
  contexts: string[]
  current: string
  error: string
}

export interface KubeNamespaces {
  namespaces: string[]
  error: string
}

export interface KubePods {
  pods: KubePod[]
  error: string
}

export interface KubeDeployment {
  name: string
  ready: string
  upToDate: number
  available: number
  age: string
  images: string[]
  selector: Record<string, string>
}

export interface KubeServicePort {
  name: string
  port: number
  targetPort: string
  nodePort: number
  protocol: string
}

export interface KubeService {
  name: string
  type: string
  clusterIP: string
  external: string
  ports: KubeServicePort[]
  selector: Record<string, string>
  age: string
}

export interface KubeConfigMap {
  name: string
  data: Record<string, string>
  age: string
}

/** Secret metadata: key names and sizes only — the backend never sends values. */
export interface KubeSecret {
  name: string
  type: string
  keys: { name: string; bytes: number }[]
  age: string
}

export interface KubeResourceKinds {
  deployments: KubeDeployment
  services: KubeService
  configmaps: KubeConfigMap
  secrets: KubeSecret
}

export type KubeResourceKind = keyof KubeResourceKinds

export interface KubePodTarget {
  context: string
  namespace: string
  pod: string
  container: string
}

export interface KubeExecResult {
  output: string
  truncated: boolean
  error: string
}

export interface KubeForward {
  id: string
  context: string
  namespace: string
  target: string
  localPort: number
  remotePort: number
  running: boolean
  status: string
  startedAt: number
}

const NO_BACKEND = 'The local backend is not reachable.'

async function call(port: number | null, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const url = serverUrl(port, path)
  if (!url) throw new Error(NO_BACKEND)
  const response = await sidecarFetch(url, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return response.json() as Promise<Record<string, unknown>>
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : NO_BACKEND
}

/** The backend sends `{ name }` objects; the UI only needs the names. */
function names(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => (typeof item === 'string' ? item : String((item as { name?: string })?.name ?? ''))).filter(Boolean)
}

/** Whether kubectl is installed and on PATH. */
export async function kubeAvailable(port: number | null): Promise<boolean> {
  try {
    const result = await call(port, '/kube/tool')
    return result.kubectl === true
  } catch {
    return false
  }
}

export async function listContexts(port: number | null): Promise<KubeContexts> {
  try {
    const result = await call(port, '/kube/contexts')
    return { contexts: names(result.contexts), current: (result.current as string) ?? '', error: (result.error as string) ?? '' }
  } catch (error: unknown) {
    return { contexts: [], current: '', error: message(error) }
  }
}

export async function listNamespaces(port: number | null, context: string): Promise<KubeNamespaces> {
  try {
    const result = await call(port, `/kube/namespaces?context=${encodeURIComponent(context)}`)
    return { namespaces: names(result.namespaces), error: (result.error as string) ?? '' }
  } catch (error: unknown) {
    return { namespaces: [], error: message(error) }
  }
}

export async function listPods(port: number | null, context: string, namespace: string): Promise<KubePods> {
  try {
    const result = await call(port, `/kube/pods?context=${encodeURIComponent(context)}&namespace=${encodeURIComponent(namespace)}`)
    return { pods: (result.pods as KubePod[]) ?? [], error: (result.error as string) ?? '' }
  } catch (error: unknown) {
    return { pods: [], error: message(error) }
  }
}

export async function listResources<K extends KubeResourceKind>(
  port: number | null, context: string, namespace: string, kind: K,
): Promise<{ items: KubeResourceKinds[K][]; error: string }> {
  try {
    const query = `context=${encodeURIComponent(context)}&namespace=${encodeURIComponent(namespace)}&kind=${kind}`
    const result = await call(port, `/kube/resources?${query}`)
    return { items: (result.items as KubeResourceKinds[K][]) ?? [], error: (result.error as string) ?? '' }
  } catch (error: unknown) {
    return { items: [], error: message(error) }
  }
}

export async function execInPod(port: number | null, target: KubePodTarget, command: string): Promise<KubeExecResult> {
  try {
    const result = await call(port, '/kube/exec', { ...target, command })
    return { output: (result.output as string) ?? '', truncated: result.truncated === true, error: (result.error as string) ?? '' }
  } catch (error: unknown) {
    return { output: '', truncated: false, error: message(error) }
  }
}

/** Reads a container file; `data` is base64. */
export async function readPodFile(port: number | null, target: KubePodTarget, path: string): Promise<{ data: string; size: number; error: string }> {
  try {
    const result = await call(port, '/kube/file/read', { ...target, path })
    return { data: (result.data as string) ?? '', size: (result.size as number) ?? 0, error: (result.error as string) ?? '' }
  } catch (error: unknown) {
    return { data: '', size: 0, error: message(error) }
  }
}

/** Writes base64 `data` to a container path, replacing the file. */
export async function writePodFile(port: number | null, target: KubePodTarget, path: string, data: string): Promise<string> {
  try {
    const result = await call(port, '/kube/file/write', { ...target, path, data })
    return (result.error as string) ?? ''
  } catch (error: unknown) {
    return message(error)
  }
}

export async function listForwards(port: number | null): Promise<KubeForward[]> {
  try {
    const result = await call(port, '/kube/forwards')
    return (result.forwards as KubeForward[]) ?? []
  } catch {
    return []
  }
}

export async function startForward(
  port: number | null,
  request: { context: string; namespace: string; target: string; localPort: number; remotePort: number },
): Promise<string> {
  try {
    const result = await call(port, '/kube/forwards/start', request)
    return (result.error as string) ?? ''
  } catch (error: unknown) {
    return message(error)
  }
}

export async function stopForward(port: number | null, id: string): Promise<void> {
  try {
    await call(port, `/kube/forwards/stop?id=${encodeURIComponent(id)}`, {})
  } catch {
    // The forward list refresh shows whatever is still running.
  }
}
