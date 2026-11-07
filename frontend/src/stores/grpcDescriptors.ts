/**
 * The services and schemas a gRPC tab is working with, loaded from server reflection, .proto files or a
 * protoset. Kept per tab: two tabs can talk to two versions of the same API.
 */
import { create } from 'zustand'
import { loadDescriptors, reflectServices } from '@/lib/grpc/grpcApi'
import { callMetadata, descriptorSource, grpcSettings, grpcTarget } from '@/lib/grpc/grpcRequest'
import type { GrpcDescriptors } from '@/lib/grpc/grpcSchema'
import type { RequestItem } from '@/lib/types'

export interface GrpcDescriptorState {
  descriptors: GrpcDescriptors | null
  loading: boolean
  error: string
  /** What was loaded: reflection of an address, or the files. Shown next to the services. */
  origin: string
}

const IDLE: GrpcDescriptorState = { descriptors: null, loading: false, error: '', origin: '' }

interface GrpcDescriptorStore {
  byTab: Record<string, GrpcDescriptorState>
  load: (tabId: string, request: RequestItem, vars: Record<string, string>) => Promise<GrpcDescriptors | null>
  forget: (tabId: string) => void
}

function originOf(request: RequestItem, vars: Record<string, string>): string {
  const settings = grpcSettings(request)
  if (settings.source === 'protoset') return settings.protosetPath.split(/[\\/]/).pop() || 'protoset'
  if (settings.source === 'proto') {
    const names = [...settings.protoFiles.map((path) => path.split(/[\\/]/).pop() ?? path), ...Object.keys(settings.inlineProtos ?? {})]
    return names.length === 1 ? names[0] : `${names.length} .proto files`
  }
  return `reflection · ${grpcTarget(request, vars).address}`
}

export const useGrpcDescriptors = create<GrpcDescriptorStore>((set) => {
  const patch = (tabId: string, change: Partial<GrpcDescriptorState>) => set((state) => ({ byTab: { ...state.byTab, [tabId]: { ...(state.byTab[tabId] ?? IDLE), ...change } } }))
  return {
    byTab: {},
    load: async (tabId, request, vars) => {
      const settings = grpcSettings(request)
      patch(tabId, { loading: true, error: '' })
      try {
        const descriptors = settings.source === 'reflection'
          ? await reflectServices(grpcTarget(request, vars), callMetadata(request, vars))
          : await loadDescriptors(descriptorSource(settings))
        const clean = { ...descriptors, services: descriptors.services ?? [] }
        patch(tabId, { descriptors: clean, loading: false, origin: originOf(request, vars) })
        return clean
      } catch (error) {
        patch(tabId, { loading: false, error: error instanceof Error ? error.message : String(error) })
        return null
      }
    },
    forget: (tabId) => set((state) => {
      const { [tabId]: _gone, ...rest } = state.byTab
      return { byTab: rest }
    }),
  }
})

export const grpcDescriptorsOf = (tabId: string): GrpcDescriptorState => useGrpcDescriptors.getState().byTab[tabId] ?? IDLE
