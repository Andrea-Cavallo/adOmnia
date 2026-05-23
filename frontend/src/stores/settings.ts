import { create } from 'zustand'
import { LoadSettings, SaveSettings } from '../wailsjs/go/main/App'
import { debouncedSave } from '@/lib/storeSave'
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

const defaultSettings: AppSettings = {
  version: 2,
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
    windowChrome: 'app',
    themeId: 'builtin-dark',
    density: 'comfortable',
    uiFont: DEFAULT_UI_FONT_ID,
    fontSize: 'medium',
    monoFontSize: 'medium',
    language: 'en',
    sidebarWidth: 280,
    showRailIconsOnly: false,
    accentColorPreset: 'default',
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
      const merged: AppSettings = {
        ...defaultSettings,
        ...parsed,
        general: mergeBlock(defaultSettings.general, parsed.general),
        appearance,
        requests: mergeBlock(defaultSettings.requests, parsed.requests),
        proxy: mergeBlock(defaultSettings.proxy, parsed.proxy),
        mock: mergeBlock(defaultSettings.mock, parsed.mock),
        vault: mergeBlock(defaultSettings.vault, parsed.vault),
        editor: mergeBlock(defaultSettings.editor, parsed.editor),
      }
      set({ settings: merged, loaded: true })
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
}))
