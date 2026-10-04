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

const NO_BACKEND = 'The local backend is not reachable.'

async function get(port: number | null, path: string): Promise<Record<string, unknown>> {
  const url = serverUrl(port, path)
  if (!url) throw new Error(NO_BACKEND)
  const response = await sidecarFetch(url)
  return response.json() as Promise<Record<string, unknown>>
}

/** Whether kubectl is installed and on PATH. */
export async function kubeAvailable(port: number | null): Promise<boolean> {
  try {
    const result = await get(port, '/kube/tool')
    return result.kubectl === true
  } catch {
    return false
  }
}

export async function listContexts(port: number | null): Promise<KubeContexts> {
  try {
    const result = await get(port, '/kube/contexts')
    return {
      contexts: (result.contexts as string[]) ?? [],
      current: (result.current as string) ?? '',
      error: (result.error as string) ?? '',
    }
  } catch (error: unknown) {
    return { contexts: [], current: '', error: error instanceof Error ? error.message : NO_BACKEND }
  }
}

export async function listNamespaces(port: number | null, context: string): Promise<KubeNamespaces> {
  try {
    const result = await get(port, `/kube/namespaces?context=${encodeURIComponent(context)}`)
    return {
      namespaces: (result.namespaces as string[]) ?? [],
      error: (result.error as string) ?? '',
    }
  } catch (error: unknown) {
    return { namespaces: [], error: error instanceof Error ? error.message : NO_BACKEND }
  }
}

export async function listPods(port: number | null, context: string, namespace: string): Promise<KubePods> {
  try {
    const result = await get(port, `/kube/pods?context=${encodeURIComponent(context)}&namespace=${encodeURIComponent(namespace)}`)
    return {
      pods: (result.pods as KubePod[]) ?? [],
      error: (result.error as string) ?? '',
    }
  } catch (error: unknown) {
    return { pods: [], error: error instanceof Error ? error.message : NO_BACKEND }
  }
}
