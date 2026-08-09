import type { PluginInstance } from '@/stores/plugins'
import * as PluginManagerBindings from '../../bindings/adomnia/pluginmanager'
import * as WasmRuntimeBindings from '../../bindings/adomnia/wasmruntime'
import * as TemplateStoreBindings from '../../bindings/adomnia/templatestore'
import * as AppBindings from '../../bindings/adomnia/app'

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

export interface PluginExecResult {
  success: boolean
  data?: unknown
  error?: string
  memUsed: number
  timeMs: number
}

function getPluginManager(): WailsGoMain['PluginManager'] {
// The generated bindings type Go maps as `string | undefined` and carry
// extra fields the UI does not model; the runtime shapes match. Narrow
// once here rather than loosening every consumer.
  return PluginManagerBindings as unknown as WailsGoMain['PluginManager']
}

function getWasmRuntime(): WailsGoMain['WasmRuntime'] {
  return WasmRuntimeBindings as unknown as WailsGoMain['WasmRuntime']
}

function getTemplateStore(): WailsGoMain['TemplateStore'] {
  return TemplateStoreBindings as unknown as WailsGoMain['TemplateStore']
}

export async function getPlugins(): Promise<PluginInstance[]> {
  const mgr = getPluginManager()
  if (!mgr) throw new Error("Plugin Manager disponibile solo nell'applicazione desktop.")
  return (await mgr.GetPlugins()) as PluginInstance[]
}

export async function installPlugin(manifestJSON: string): Promise<PluginInstance> {
  const mgr = getPluginManager()
  if (!mgr) throw new Error("Plugin Manager disponibile solo nell'applicazione desktop.")
  return (await mgr.InstallPlugin(manifestJSON)) as PluginInstance
}

export async function installPluginPackage(manifestJSON: string, encodedFiles: Record<string, string>): Promise<PluginInstance> {
  const mgr = getPluginManager()
  if (!mgr) throw new Error("Plugin Manager disponibile solo nell'applicazione desktop.")
  return (await mgr.InstallPluginPackage(manifestJSON, encodedFiles)) as PluginInstance
}

export async function installPluginDirectory(sourceDir: string): Promise<PluginInstance> {
  const mgr = getPluginManager()
  if (!mgr) throw new Error("Plugin Manager disponibile solo nell'applicazione desktop.")
  return (await mgr.InstallPluginDirectory(sourceDir)) as PluginInstance
}

export async function selectPluginDirectory(): Promise<string> {
  const app = AppBindings
  if (!app) throw new Error("Selettore cartelle disponibile solo nell'applicazione desktop.")
  return app.SelectFolder('Seleziona cartella plugin')
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

export async function executePlugin(pluginId: string, functionName: string, args: Record<string, unknown>): Promise<PluginExecResult> {
  const runtime = getWasmRuntime()
  if (!runtime) throw new Error("Plugin runtime disponibile solo nell'applicazione desktop.")
  const result = await runtime.Execute({ pluginId, function: functionName, args }) as PluginExecResult
  if (!result.success) throw new Error(result.error || 'Plugin execution failed.')
  return result
}

export async function executePluginAction(pluginId: string, actionId: string, args: Record<string, unknown> = {}): Promise<PluginExecResult> {
  const manager = getPluginManager()
  if (!manager) throw new Error("Plugin Manager disponibile solo nell'applicazione desktop.")
  const result = await manager.ExecuteAction(pluginId, actionId, args) as PluginExecResult
  if (!result.success) throw new Error(result.error || 'Plugin action failed.')
  return result
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
