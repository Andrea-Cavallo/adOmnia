import { create } from 'zustand'
import type { Environment, EnvVariable } from '@/lib/types'
import { uid, blankEnvVar } from '@/lib/types'
import { StorageGet, StoragePut } from '@/wailsjs/go/main/App'

const BUCKET = 'environments'
const KEY = 'all'

interface EnvironmentsState {
  environments: Environment[]
  activeEnvId: string | null
  loaded: boolean
  loadError: boolean
  load: () => Promise<void>
  save: () => Promise<void>
  setActiveEnv: (id: string | null) => void
  addEnvironment: (name: string) => Environment
  deleteEnvironment: (id: string) => void
  renameEnvironment: (id: string, name: string) => void
  updateVariables: (envId: string, variables: EnvVariable[]) => void
  getResolvedVars: () => Record<string, string>
}

export const useEnvironmentsStore = create<EnvironmentsState>((set, get) => ({
  environments: [],
  activeEnvId: null,
  loaded: false,
  loadError: false,

  load: async () => {
    try {
      const raw = await StorageGet(BUCKET, KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        set({
          environments: parsed.environments ?? [],
          activeEnvId: parsed.activeEnvId ?? null,
          loaded: true,
          loadError: false,
        })
      } else {
        set({ loaded: true, loadError: false })
      }
    } catch {
      set({ loaded: true, loadError: true })
    }
  },

  save: async () => {
    const s = get()
    if (!s.loaded || s.loadError) return
    const { environments, activeEnvId } = s
    try {
      await StoragePut(BUCKET, KEY, JSON.stringify({ environments, activeEnvId }))
    } catch (e) {
      console.error('Failed to save environments:', e)
    }
  },

  setActiveEnv: (id) => {
    set({ activeEnvId: id })
    get().save()
  },

  addEnvironment: (name) => {
    const env: Environment = {
      id: uid(),
      name,
      variables: [blankEnvVar()],
    }
    set((s) => ({ environments: [...s.environments, env] }))
    get().save()
    return env
  },

  deleteEnvironment: (id) => {
    set((s) => ({
      environments: s.environments.filter((e) => e.id !== id),
      activeEnvId: s.activeEnvId === id ? null : s.activeEnvId,
    }))
    get().save()
  },

  renameEnvironment: (id, name) => {
    set((s) => ({
      environments: s.environments.map((e) => (e.id === id ? { ...e, name } : e)),
    }))
    get().save()
  },

  updateVariables: (envId, variables) => {
    set((s) => ({
      environments: s.environments.map((e) => (e.id === envId ? { ...e, variables } : e)),
    }))
    get().save()
  },

  getResolvedVars: () => {
    const { environments, activeEnvId } = get()
    const env = environments.find((e) => e.id === activeEnvId)
    if (!env) return {}
    const vars: Record<string, string> = {}
    for (const v of env.variables) {
      if (v.enabled && v.key) vars[v.key] = v.value
    }
    return vars
  },
}))
