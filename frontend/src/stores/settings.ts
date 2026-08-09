import { create } from 'zustand'
import { LoadSettings, SaveSettings } from '../wailsjs/go/main/App'
import { debouncedSave, setAutoSaveDelay } from '@/lib/storeSave'
import { DEFAULT_UI_FONT_ID, type UIFontId } from '@/lib/uiFonts'

export interface AppSettings {
  version: number
  general: {
    confirmBeforeClosingDirtyTabs: boolean
    restoreTabsOnStartup: boolean
    showWelcomeOnEmptyWorkspace: boolean
    defaultStartupRail: string
    autoSaveIntervalMs: number
    backupWorkspaceOnStartup: boolean
    maxConcurrentRequests: number
  }
  appearance: {
    theme: 'dark' | 'light'
    windowChrome: 'app' | 'app-xwayland' | 'system'
    themeId: string
    density: 'compact' | 'comfortable' | 'spacious'
    uiFont: UIFontId
    fontSize: 'small' | 'medium' | 'large'
    monoFontSize: 'small' | 'medium' | 'large'
    language: 'en' | 'it'
    sidebarWidth: number
    showRailIconsOnly: boolean
    accentColorPreset: string
    sidebarCollapsed: boolean
  }
  requests: {
    defaultTimeoutMs: number
    followRedirects: boolean
    saveResponsesToHistory: boolean
    maxResponseHistoryPerTab: number
    defaultHttpMethod: string
    skipCertVerify: boolean
    clientCertPem: string
    clientCertPassphrase: string
    sendCookiesAutomatically: boolean
    preserveCookiesBetweenTabs: boolean
    encodeUrlAutomatically: boolean
    trimWhitespaceInHeaders: boolean
    maxRedirects: number
    stripAuthOnRedirect: boolean
    autoValidateSchema: boolean
  }
  proxy: {
    defaultProxyPort: number
    maxTrafficEntries: number
    reqBodyLimitKB: number
    respBodyLimitKB: number
    upstreamProxy: string
    noProxyHosts: string
    enableHttps: boolean
  }
  mock: {
    defaultMockPort: number
    defaultResponseDelayMs: number
    mockServerPassword: string
    corsHeadersAuto: boolean
    logHitsToFile: boolean
  }
  vault: {
    autoLockTimeoutMin: number
    lockVaultOnMinimize: boolean
    showVaultInAutocomplete: boolean
  }
  editor: {
    tabSize: 2 | 4 | 8
    softTabs: boolean
    wordWrap: boolean
    lineNumbers: boolean
    autoCloseBrackets: boolean
    formatResponseAuto: boolean
    responseMaxRenderSizeKB: number
  }
  ai: {
    provider: 'anthropic' | 'openai' | 'gemini' | 'ollama' | 'huggingface' | 'openai-compatible'
    model: string
    apiKey: string
    baseURL: string
    enabled: boolean
    /** `environment` keeps AI credentials machine-local and bypasses Vault resolution. */
    credentialMode: 'vault' | 'environment'
  }
  features: {
    pluginsEnabled: boolean
    dailyScenariosEnabled: boolean
    showAdvancedFeatures: boolean
    showLabFeatures: boolean
  }
  markdown: {
    templatesFolder: string
  }
}

function mergeBlock<T extends Record<string, unknown>>(defaults: T, saved: Partial<T> | undefined): T {
  const merged = { ...defaults, ...(saved ?? {}) }
  for (const key of Object.keys(defaults)) {
    const k = key as keyof T
    if (Array.isArray(defaults[k]) && !Array.isArray(merged[k])) {
      ;(merged as Record<string, unknown>)[key] = defaults[k]
    }
  }
  return merged
}

const RETIRED_AI_MODELS: Partial<Record<AppSettings['ai']['provider'], Record<string, string>>> = {
  openai: {
    'gpt-5.5': 'gpt-5.6-sol',
    'gpt-5.5-pro': 'gpt-5.6-sol',
    'gpt-5.4': 'gpt-5.6-terra',
    'gpt-5.4-mini': 'gpt-5.6-terra',
    'gpt-5.4-nano': 'gpt-5.6-luna',
  },
  anthropic: {
    'claude-opus-4-8': 'claude-opus-5',
    'claude-sonnet-4-6': 'claude-sonnet-5',
  },
  gemini: {
    'gemini-3-flash': 'gemini-3.6-flash',
    'gemini-3.1-flash-lite': 'gemini-3.5-flash-lite',
  },
  huggingface: {
    'deepseek-ai/DeepSeek-R1:preferred': 'deepseek-ai/DeepSeek-V3-0324:preferred',
  },
  ollama: {
    'qwen3-coder': 'qwen3.5',
    gemma3: 'gemma4',
  },
}

function migrateAIModel(ai: AppSettings['ai']): AppSettings['ai'] {
  const replacement = RETIRED_AI_MODELS[ai.provider]?.[ai.model]
  return replacement ? { ...ai, model: replacement } : ai
}

const defaultSettings: AppSettings = {
  version: 5,
  general: {
    confirmBeforeClosingDirtyTabs: true,
    restoreTabsOnStartup: true,
    showWelcomeOnEmptyWorkspace: true,
    defaultStartupRail: 'collections',
    autoSaveIntervalMs: 5000,
    backupWorkspaceOnStartup: true,
    maxConcurrentRequests: 6,
  },
  appearance: {
    theme: 'dark',
    windowChrome: 'system',
    themeId: 'builtin-dark',
    density: 'comfortable',
    uiFont: DEFAULT_UI_FONT_ID,
    fontSize: 'medium',
    monoFontSize: 'medium',
    language: 'en',
    sidebarWidth: 280,
    showRailIconsOnly: false,
    accentColorPreset: 'purple',
    sidebarCollapsed: false,
  },
  requests: {
    defaultTimeoutMs: 30000,
    followRedirects: true,
    saveResponsesToHistory: true,
    maxResponseHistoryPerTab: 20,
    defaultHttpMethod: 'GET',
    skipCertVerify: false,
    clientCertPem: '',
    clientCertPassphrase: '',
    sendCookiesAutomatically: true,
    preserveCookiesBetweenTabs: true,
    encodeUrlAutomatically: true,
    trimWhitespaceInHeaders: true,
    maxRedirects: 10,
    stripAuthOnRedirect: true,
    autoValidateSchema: true,
  },
  proxy: {
    defaultProxyPort: 8080,
    maxTrafficEntries: 500,
    reqBodyLimitKB: 1024,
    respBodyLimitKB: 1024,
    upstreamProxy: '',
    noProxyHosts: '',
    enableHttps: false,
  },
  mock: {
    defaultMockPort: 3000,
    defaultResponseDelayMs: 0,
    mockServerPassword: '',
    corsHeadersAuto: true,
    logHitsToFile: false,
  },
  vault: {
    autoLockTimeoutMin: 30,
    lockVaultOnMinimize: true,
    showVaultInAutocomplete: true,
  },
  editor: {
    tabSize: 2,
    softTabs: true,
    wordWrap: true,
    lineNumbers: true,
    autoCloseBrackets: true,
    formatResponseAuto: true,
    responseMaxRenderSizeKB: 2048,
  },
  ai: {
    provider: 'ollama' as const,
    model: '',
    apiKey: '',
    baseURL: 'http://localhost:11434',
    enabled: false,
    credentialMode: 'vault',
  },
  features: {
    pluginsEnabled: false,
    dailyScenariosEnabled: false,
    showAdvancedFeatures: true,
    showLabFeatures: false,
  },
  markdown: {
    templatesFolder: '',
  },
}

interface SettingsState {
  settings: AppSettings
  loaded: boolean
  load: () => Promise<void>
  save: () => void
  update: (patch: Partial<AppSettings>) => void
  updateGeneral: (patch: Partial<AppSettings['general']>) => void
  updateAppearance: (patch: Partial<AppSettings['appearance']>) => void
  updateRequests: (patch: Partial<AppSettings['requests']>) => void
  updateProxy: (patch: Partial<AppSettings['proxy']>) => void
  updateMock: (patch: Partial<AppSettings['mock']>) => void
  updateVault: (patch: Partial<AppSettings['vault']>) => void
  updateEditor: (patch: Partial<AppSettings['editor']>) => void
  updateAi: (patch: Partial<AppSettings['ai']>) => void
  updateFeatures: (patch: Partial<AppSettings['features']>) => void
  updateMarkdown: (patch: Partial<AppSettings['markdown']>) => void
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: defaultSettings,
  loaded: false,

  load: async () => {
    try {
      const raw = await LoadSettings()
      const parsed = JSON.parse(raw)
      const appearance = mergeBlock(defaultSettings.appearance, parsed.appearance)
      if (!appearance.themeId) {
        appearance.themeId = appearance.theme === 'light' ? 'builtin-light' : 'builtin-dark'
      }
      // v3 migration: the system titlebar is now the default. Flip the legacy
      // 'app' default to 'system' once; explicit Linux ('app-xwayland') choices
      // and deliberate 'system' picks are left untouched.
      const migratedToV3 = (parsed.version ?? 0) < 3 && appearance.windowChrome === 'app'
      if (migratedToV3) appearance.windowChrome = 'system'
      const savedAI = mergeBlock(defaultSettings.ai, parsed.ai)
      const migratedAI = (parsed.version ?? 0) < 5 ? migrateAIModel(savedAI) : savedAI
      const migratedAiModels = migratedAI.model !== savedAI.model
      const merged: AppSettings = {
        ...defaultSettings,
        ...parsed,
        version: defaultSettings.version,
        general: mergeBlock(defaultSettings.general, parsed.general),
        appearance,
        requests: mergeBlock(defaultSettings.requests, parsed.requests),
        proxy: mergeBlock(defaultSettings.proxy, parsed.proxy),
        mock: mergeBlock(defaultSettings.mock, parsed.mock),
        vault: mergeBlock(defaultSettings.vault, parsed.vault),
        editor: mergeBlock(defaultSettings.editor, parsed.editor),
        ai: migratedAI,
        features: mergeBlock(defaultSettings.features, parsed.features),
        markdown: mergeBlock(defaultSettings.markdown, parsed.markdown),
      }
      setAutoSaveDelay(merged.general.autoSaveIntervalMs)
      set({ settings: merged, loaded: true })
      // Persist one-time migrations so the change survives without a manual edit.
      if (migratedToV3 || migratedAiModels) get().save()
    } catch {
      set({ settings: defaultSettings, loaded: true })
    }
  },

  save: () => {
    const s = get().settings
    debouncedSave('settings', () => SaveSettings(JSON.stringify(s)))
  },

  update: (patch) => {
    set((s) => ({ settings: { ...s.settings, ...patch } }))
    get().save()
  },

  updateGeneral: (patch) => {
    set((s) => ({
      settings: { ...s.settings, general: { ...s.settings.general, ...patch } },
    }))
    if (patch.autoSaveIntervalMs !== undefined) setAutoSaveDelay(patch.autoSaveIntervalMs)
    get().save()
  },

  updateAppearance: (patch) => {
    set((s) => ({
      settings: {
        ...s.settings,
        appearance: { ...s.settings.appearance, ...patch },
      },
    }))
    get().save()
  },

  updateRequests: (patch) => {
    set((s) => ({
      settings: { ...s.settings, requests: { ...s.settings.requests, ...patch } },
    }))
    get().save()
  },

  updateProxy: (patch) => {
    set((s) => ({
      settings: { ...s.settings, proxy: { ...s.settings.proxy, ...patch } },
    }))
    get().save()
  },

  updateMock: (patch) => {
    set((s) => ({
      settings: { ...s.settings, mock: { ...s.settings.mock, ...patch } },
    }))
    get().save()
  },

  updateVault: (patch) => {
    set((s) => ({
      settings: { ...s.settings, vault: { ...s.settings.vault, ...patch } },
    }))
    get().save()
  },

  updateEditor: (patch) => {
    set((s) => ({
      settings: { ...s.settings, editor: { ...s.settings.editor, ...patch } },
    }))
    get().save()
  },

  updateAi: (patch) => {
    set((s) => ({
      settings: { ...s.settings, ai: { ...s.settings.ai, ...patch } },
    }))
    get().save()
  },

  updateFeatures: (patch) => {
    set((s) => ({
      settings: { ...s.settings, features: { ...s.settings.features, ...patch } },
    }))
    get().save()
  },

  updateMarkdown: (patch) => {
    set((s) => ({
      settings: { ...s.settings, markdown: { ...s.settings.markdown, ...patch } },
    }))
    get().save()
  },
}))
