import { create } from 'zustand'

export interface PluginAction {
  id: string
  name: string
  description: string
  streaming: boolean
}

export interface PluginManifest {
  id: string
  name: string
  version: string
  author: string
  description: string
  homepage: string
  license: string
  minAppVersion: string
  permissions: string[]
  hooks: { event: string; handler: string }[]
  settings: PluginSetting[]
  entryPoint: string
  icon: string
  ui_slots?: string[]
  actions?: PluginAction[]
}

export interface PluginSetting {
  key: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'select'
  default: string
  options?: string[]
  description: string
}

export interface PluginInstance {
  manifest: PluginManifest
  enabled: boolean
  settings: Record<string, string>
  installDir: string
  installedAt: string
  error?: string
}

interface PluginsState {
  plugins: PluginInstance[]
  selectedPlugin: PluginInstance | null
  loading: boolean
  setPlugins: (plugins: PluginInstance[]) => void
  setSelectedPlugin: (p: PluginInstance | null) => void
  setLoading: (v: boolean) => void
}

export const usePluginsStore = create<PluginsState>((set) => ({
  plugins: [],
  selectedPlugin: null,
  loading: false,
  setPlugins: (plugins) => set({ plugins }),
  setSelectedPlugin: (p) => set({ selectedPlugin: p }),
  setLoading: (v) => set({ loading: v }),
}))
