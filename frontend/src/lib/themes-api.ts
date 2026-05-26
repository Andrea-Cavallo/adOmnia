import type { Theme } from '@/stores/themes'

declare global {
  interface WailsGoMain {
    ThemeManager: {
      GetThemes: () => Promise<Theme[]>
      GetTheme: (id: string) => Promise<Theme>
      SaveTheme: (theme: Theme) => Promise<void>
      DeleteTheme: (id: string) => Promise<void>
      ExportTheme: (id: string) => Promise<string>
      ImportTheme: (jsonStr: string) => Promise<Theme>
      GetActiveThemeID: () => Promise<string>
      SetActiveThemeID: (id: string) => Promise<void>
      GetBuiltinThemes: () => Promise<Theme[]>
      ValidateTheme: (theme: Theme) => Promise<ThemeValidationResult>
      CheckContrast: (theme: Theme) => Promise<ContrastResult[]>
      ScanSkinsDirectory: () => Promise<Theme[]>
      ScanProjectThemesDirectory: () => Promise<Theme[]>
      GetSkinsDirectory: () => Promise<string>
      SaveSkinToDirectory: (theme: Theme) => Promise<string>
      ImportSkinFromURL: (url: string) => Promise<Theme>
      StartWatching: () => Promise<void>
      StopWatching: () => Promise<void>
      IsWatching: () => Promise<boolean>
      GetChangedSkins: () => Promise<string[]>
      GetExtendedBuiltinThemes: () => Promise<Theme[]>
      GetTokenNamespace: () => Promise<Record<string, TokenDefinition[]>>
    }
    PluginManager: {
      GetPlugins: () => Promise<unknown[]>
      GetPlugin: (id: string) => Promise<unknown>
      InstallPlugin: (manifestJSON: string) => Promise<unknown>
      InstallPluginPackage: (manifestJSON: string, encodedFiles: Record<string, string>) => Promise<unknown>
      UninstallPlugin: (id: string) => Promise<void>
      EnablePlugin: (id: string) => Promise<void>
      DisablePlugin: (id: string) => Promise<void>
      GetPluginSettings: (id: string) => Promise<Record<string, string>>
      SetPluginSetting: (id: string, key: string, value: string) => Promise<void>
      GetRegisteredHooks: () => Promise<Record<string, string[]>>
      GetAvailableEvents: () => Promise<string[]>
    }
    WasmRuntime: {
      GetHostFunctions: () => Promise<string[]>
      GetSandboxStatus: (pluginId: string) => Promise<{ pluginId: string; memory: number; maxMemory: number; running: boolean }>
    }
    TemplateStore: {
      GetTemplates: () => Promise<unknown[]>
      GetTemplatesByCategory: (category: string) => Promise<unknown[]>
      SearchTemplates: (query: string) => Promise<unknown[]>
      GetTemplate: (id: string) => Promise<unknown>
      SaveTemplate: (t: unknown) => Promise<void>
      DeleteTemplate: (id: string) => Promise<void>
      ExportTemplate: (id: string) => Promise<string>
      ImportTemplate: (jsonStr: string) => Promise<unknown>
      GetCategories: () => Promise<unknown[]>
      InstallTemplate: (id: string) => Promise<string>
      GetBuiltinTemplates: () => Promise<unknown[]>
    }
  }
}

function getThemeManager() {
  return window.go?.main?.ThemeManager
}

export async function getThemes(): Promise<Theme[]> {
  try {
    const mgr = getThemeManager()
    if (!mgr) return []
    return await mgr.GetThemes()
  } catch {
    return []
  }
}

export async function saveTheme(theme: Theme): Promise<boolean> {
  try {
    const mgr = getThemeManager()
    if (!mgr) return false
    await mgr.SaveTheme(theme)
    return true
  } catch {
    return false
  }
}

export async function deleteTheme(id: string): Promise<boolean> {
  try {
    const mgr = getThemeManager()
    if (!mgr) return false
    await mgr.DeleteTheme(id)
    return true
  } catch {
    return false
  }
}

export async function exportTheme(id: string): Promise<string> {
  try {
    const mgr = getThemeManager()
    if (!mgr) return ''
    return await mgr.ExportTheme(id)
  } catch {
    return ''
  }
}

export async function importTheme(jsonStr: string): Promise<Theme | null> {
  try {
    const mgr = getThemeManager()
    if (!mgr) return null
    return await mgr.ImportTheme(jsonStr)
  } catch {
    return null
  }
}

export async function getActiveThemeId(): Promise<string> {
  try {
    const mgr = getThemeManager()
    if (!mgr) return ''
    return await mgr.GetActiveThemeID()
  } catch {
    return ''
  }
}

export async function setActiveThemeId(id: string): Promise<boolean> {
  try {
    const mgr = getThemeManager()
    if (!mgr) return false
    await mgr.SetActiveThemeID(id)
    return true
  } catch {
    return false
  }
}

export async function getBuiltinThemes(): Promise<Theme[]> {
  try {
    const mgr = getThemeManager()
    if (!mgr) return []
    return await mgr.GetBuiltinThemes()
  } catch {
    return []
  }
}

export interface ThemeValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export interface ContrastResult {
  pair: string
  ratio: number
  aaNormal: boolean
  aaLarge: boolean
  aaaNormal: boolean
  level: string
}

export interface TokenDefinition {
  key: string
  description: string
  required: boolean
  category: string
  default: string
}

export async function validateTheme(theme: Theme): Promise<ThemeValidationResult> {
  try {
    const mgr = getThemeManager()
    if (!mgr) return { valid: false, errors: ['No binding'], warnings: [] }
    return await mgr.ValidateTheme(theme)
  } catch {
    return { valid: false, errors: ['Validation failed'], warnings: [] }
  }
}

export async function checkContrast(theme: Theme): Promise<ContrastResult[]> {
  try {
    const mgr = getThemeManager()
    if (!mgr) return []
    return await mgr.CheckContrast(theme)
  } catch {
    return []
  }
}

export async function scanSkinsDirectory(): Promise<Theme[]> {
  try {
    const mgr = getThemeManager()
    if (!mgr) return []
    return await mgr.ScanSkinsDirectory()
  } catch {
    return []
  }
}

export async function scanProjectThemesDirectory(): Promise<Theme[]> {
  try {
    const mgr = getThemeManager()
    if (!mgr?.ScanProjectThemesDirectory) return []
    return await mgr.ScanProjectThemesDirectory()
  } catch {
    return []
  }
}

export async function getSkinsDirectory(): Promise<string> {
  try {
    const mgr = getThemeManager()
    if (!mgr) return ''
    return await mgr.GetSkinsDirectory()
  } catch {
    return ''
  }
}

export async function importSkinFromURL(url: string): Promise<Theme | null> {
  try {
    const mgr = getThemeManager()
    if (!mgr) return null
    return await mgr.ImportSkinFromURL(url)
  } catch {
    return null
  }
}

export async function startWatching(): Promise<void> {
  try {
    const mgr = getThemeManager()
    if (!mgr) return
    await mgr.StartWatching()
  } catch {}
}

export async function stopWatching(): Promise<void> {
  try {
    const mgr = getThemeManager()
    if (!mgr) return
    await mgr.StopWatching()
  } catch {}
}

export async function getChangedSkins(): Promise<string[]> {
  try {
    const mgr = getThemeManager()
    if (!mgr) return []
    return await mgr.GetChangedSkins()
  } catch {
    return []
  }
}

export async function getExtendedBuiltinThemes(): Promise<Theme[]> {
  try {
    const mgr = getThemeManager()
    if (!mgr) return []
    return await mgr.GetExtendedBuiltinThemes()
  } catch {
    return []
  }
}

export async function getTokenNamespace(): Promise<Record<string, TokenDefinition[]>> {
  try {
    const mgr = getThemeManager()
    if (!mgr) return {}
    return await mgr.GetTokenNamespace()
  } catch {
    return {}
  }
}
