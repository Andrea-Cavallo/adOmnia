import { useMemo } from 'react'
import { create } from 'zustand'
import type { Environment, EnvVariable } from '@/lib/types'
import { uid, blankEnvVar } from '@/lib/types'
import { StorageGet, StoragePut } from '@/wailsjs/go/main/App'
import { debouncedSave } from '@/lib/storeSave'
import { decodePersistedJSON } from '@/lib/persistedJson'

const BUCKET = 'environments'
const KEY = 'all'

interface EnvironmentsState {
  environments: Environment[]
  activeEnvId: string | null
  loaded: boolean
  loadError: boolean
  load: (rawOverride?: unknown) => Promise<void>
  save: () => void
  setActiveEnv: (id: string | null) => void
  addEnvironment: (name: string) => Environment
  deleteEnvironment: (id: string) => void
  renameEnvironment: (id: string, name: string) => void
  setEnvironmentPrivate: (id: string, value: boolean) => void
  updateVariables: (envId: string, variables: EnvVariable[]) => void
  /** Replaces the whole list (matrix edits, imports); the active id is kept when it still exists. */
  setEnvironments: (environments: Environment[]) => void
  getResolvedVars: () => Record<string, string>
}

export const useEnvironmentsStore = create<EnvironmentsState>((set, get) => ({
  environments: [],
  activeEnvId: null,
  loaded: false,
  loadError: false,

  load: async (rawOverride) => {
    try {
      const raw = rawOverride ?? await StorageGet(BUCKET, KEY)
      if (raw) {
        const parsed = decodePersistedJSON<{ environments?: Environment[]; activeEnvId?: string | null }>(raw)
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

  save: () => {
    const s = get()
    if (!s.loaded || s.loadError) return
    const { environments, activeEnvId } = s
    debouncedSave('environments', () => StoragePut(BUCKET, KEY, JSON.stringify({ environments, activeEnvId })))
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

  setEnvironmentPrivate: (id, value) => {
    set((s) => ({
      environments: s.environments.map((e) => (e.id === id ? { ...e, private: value } : e)),
    }))
    get().save()
  },

  updateVariables: (envId, variables) => {
    set((s) => ({
      environments: s.environments.map((e) => (e.id === envId ? { ...e, variables } : e)),
    }))
    get().save()
  },

  setEnvironments: (environments) => {
    set((s) => ({ environments, activeEnvId: environments.some((e) => e.id === s.activeEnvId) ? s.activeEnvId : null }))
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

/** Active environment variables that re-render the caller when the environment or its values change. */
export function useResolvedVars(): Record<string, string> {
  const environments = useEnvironmentsStore((s) => s.environments)
  const activeEnvId = useEnvironmentsStore((s) => s.activeEnvId)
  return useMemo(() => useEnvironmentsStore.getState().getResolvedVars(), [environments, activeEnvId])
}
