import type { PluginInstance } from '@/stores/plugins'

export interface Template {
  id: string
  name: string
  description: string
  category: string
  author: string
  version: string
  tags: string[]
  content: string
  icon: string
  createdAt: string
  updatedAt: string
}

export interface TemplateCategory {
  id: string
  name: string
  icon: string
  count: number
}

export interface SandboxStatus {
  pluginId: string
  memory: number
  maxMemory: number
  running: boolean
}

function getPluginManager() {
  return window.go?.main?.PluginManager
}

function getWasmRuntime() {
  return window.go?.main?.WasmRuntime
}

function getTemplateStore() {
  return window.go?.main?.TemplateStore
}

export async function getPlugins(): Promise<PluginInstance[]> {
  try {
    const mgr = getPluginManager()
    if (!mgr) return []
    return (await mgr.GetPlugins()) as PluginInstance[]
  } catch {
    return []
  }
}

export async function getPlugin(id: string): Promise<PluginInstance | null> {
  try {
    const mgr = getPluginManager()
    if (!mgr) return null
    return (await mgr.GetPlugin(id)) as PluginInstance
  } catch {
    return null
  }
}

export async function installPlugin(manifestJSON: string): Promise<PluginInstance | null> {
  try {
    const mgr = getPluginManager()
    if (!mgr) return null
    return (await mgr.InstallPlugin(manifestJSON)) as PluginInstance
  } catch {
    return null
  }
}

export async function uninstallPlugin(id: string): Promise<boolean> {
  try {
    const mgr = getPluginManager()
    if (!mgr) return false
    await mgr.UninstallPlugin(id)
    return true
  } catch {
    return false
  }
}

export async function enablePlugin(id: string): Promise<boolean> {
  try {
    const mgr = getPluginManager()
    if (!mgr) return false
    await mgr.EnablePlugin(id)
    return true
  } catch {
    return false
  }
}

export async function disablePlugin(id: string): Promise<boolean> {
  try {
    const mgr = getPluginManager()
    if (!mgr) return false
    await mgr.DisablePlugin(id)
    return true
  } catch {
    return false
  }
}

export async function getPluginSettings(id: string): Promise<Record<string, string>> {
  try {
    const mgr = getPluginManager()
    if (!mgr) return {}
    return await mgr.GetPluginSettings(id)
  } catch {
    return {}
  }
}

export async function setPluginSetting(id: string, key: string, value: string): Promise<boolean> {
  try {
    const mgr = getPluginManager()
    if (!mgr) return false
    await mgr.SetPluginSetting(id, key, value)
    return true
  } catch {
    return false
  }
}

export async function getRegisteredHooks(): Promise<Record<string, string[]>> {
  try {
    const mgr = getPluginManager()
    if (!mgr) return {}
    return await mgr.GetRegisteredHooks()
  } catch {
    return {}
  }
}

export async function getAvailableEvents(): Promise<string[]> {
  try {
    const mgr = getPluginManager()
    if (!mgr) return []
    return await mgr.GetAvailableEvents()
  } catch {
    return []
  }
}

export async function getHostFunctions(): Promise<string[]> {
  try {
    const rt = getWasmRuntime()
    if (!rt) return []
    return await rt.GetHostFunctions()
  } catch {
    return []
  }
}

export async function getSandboxStatus(pluginId: string): Promise<SandboxStatus | null> {
  try {
    const rt = getWasmRuntime()
    if (!rt) return null
    return await rt.GetSandboxStatus(pluginId)
  } catch {
    return null
  }
}

export async function getTemplates(): Promise<Template[]> {
  try {
    const store = getTemplateStore()
    if (!store) return []
    return (await store.GetTemplates()) as Template[]
  } catch {
    return []
  }
}

export async function getTemplatesByCategory(category: string): Promise<Template[]> {
  try {
    const store = getTemplateStore()
    if (!store) return []
    return (await store.GetTemplatesByCategory(category)) as Template[]
  } catch {
    return []
  }
}

export async function searchTemplates(query: string): Promise<Template[]> {
  try {
    const store = getTemplateStore()
    if (!store) return []
    return (await store.SearchTemplates(query)) as Template[]
  } catch {
    return []
  }
}

export async function getTemplate(id: string): Promise<Template | null> {
  try {
    const store = getTemplateStore()
    if (!store) return null
    return (await store.GetTemplate(id)) as Template
  } catch {
    return null
  }
}

export async function saveTemplate(t: Template): Promise<boolean> {
  try {
    const store = getTemplateStore()
    if (!store) return false
    await store.SaveTemplate(t)
    return true
  } catch {
    return false
  }
}

export async function deleteTemplate(id: string): Promise<boolean> {
  try {
    const store = getTemplateStore()
    if (!store) return false
    await store.DeleteTemplate(id)
    return true
  } catch {
    return false
  }
}

export async function exportTemplate(id: string): Promise<string> {
  try {
    const store = getTemplateStore()
    if (!store) return ''
    return await store.ExportTemplate(id)
  } catch {
    return ''
  }
}

export async function importTemplate(jsonStr: string): Promise<Template | null> {
  try {
    const store = getTemplateStore()
    if (!store) return null
    return (await store.ImportTemplate(jsonStr)) as Template
  } catch {
    return null
  }
}

export async function getCategories(): Promise<TemplateCategory[]> {
  try {
    const store = getTemplateStore()
    if (!store) return []
    return (await store.GetCategories()) as TemplateCategory[]
  } catch {
    return []
  }
}

export async function installTemplate(id: string): Promise<string> {
  try {
    const store = getTemplateStore()
    if (!store) return ''
    return await store.InstallTemplate(id)
  } catch {
    return ''
  }
}

export async function getBuiltinTemplates(): Promise<Template[]> {
  try {
    const store = getTemplateStore()
    if (!store) return []
    return (await store.GetBuiltinTemplates()) as Template[]
  } catch {
    return []
  }
}
