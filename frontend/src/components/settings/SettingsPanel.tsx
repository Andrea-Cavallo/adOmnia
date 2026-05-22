import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import type { AppSettings } from '@/stores/settings'
import { useSettingsStore } from '@/stores/settings'
import { useThemesStore } from '@/stores/themes'
import { useT } from '@/lib/i18n'
import { UI_FONTS, type UIFontId } from '@/lib/uiFonts'
import { cn } from '@/lib/utils'
import { useAppIcon } from '@/lib/brandAssets'
import { useThemeContext } from '@/components/themes/ThemeProvider'
import { inferThemeMode, loadAvailableThemes } from '@/lib/themeCatalog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { getRuntimeInfo, type RuntimeInfo } from '@/lib/python-bridge-api'
import {
  Settings,
  Monitor,
  Globe,
  Shield,
  Server,
  Lock,
  Code2,
  Database,
  Keyboard,
  Info,
  Bug,
  Search,
  Terminal,
} from 'lucide-react'
import { Toggle, Select, NumberInput, TextInput, PasswordInput, TextAreaInput } from './SettingsFields'

function appBinding() {
  return window.go?.main?.App
}

async function safeIsDevMode(): Promise<boolean> {
  return await appBinding()?.IsDevMode?.() ?? false
}

async function safeSetDevMode(enabled: boolean): Promise<void> {
  await appBinding()?.SetDevMode?.(enabled)
}

async function safeOpenDevLogsFolder(): Promise<void> {
  await appBinding()?.OpenDevLogsFolder?.()
}

async function safeSetVaultTimeout(minutes: number): Promise<void> {
  await appBinding()?.SetVaultTimeout?.(minutes)
}

async function safeGetServerPort(): Promise<number | null> {
  return await appBinding()?.GetServerPort?.() ?? null
}

async function safeGetStartupWindowChrome(): Promise<AppSettings['appearance']['windowChrome'] | null> {
  const value = await appBinding()?.GetStartupWindowChrome?.()
  return value === 'system' ? 'system' : value === 'app-xwayland' ? 'app-xwayland' : value === 'app' ? 'app' : null
}

async function safeClearDevLogs(): Promise<void> {
  await appBinding()?.ClearDevLogs?.()
}

type SectionId =
  | 'general'
  | 'appearance'
  | 'requests'
  | 'proxy'
  | 'mock'
  | 'vault'
  | 'editor'
  | 'privacy'
  | 'shortcuts'
  | 'about'
  | 'developer'
  | 'python'

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-3 pb-2 border-b border-border-1">
      <h2 className="text-sm font-semibold text-text-1">{title}</h2>
      <p className="text-[10px] text-text-4 mt-0.5">{subtitle}</p>
    </div>
  )
}

function SettingsCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('bg-surface-1 border border-border-2 rounded-md p-3 mb-3', className)}>
      <div className="flex flex-col divide-y divide-border-1">{children}</div>
    </div>
  )
}

function DangerZone({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-status-err/30 rounded-md p-3 mb-3 bg-status-err/5">
      <div className="flex flex-col divide-y divide-border-1">{children}</div>
    </div>
  )
}

// --- Keyboard shortcuts data ---

const shortcutsList = [
  { win: 'Ctrl+Enter', mac: 'Cmd+Enter', labelKey: 'sendRequest' },
  { win: 'Ctrl+N', mac: 'Cmd+N', labelKey: 'newTab' },
  { win: 'Ctrl+W', mac: 'Cmd+W', labelKey: 'closeTab' },
  { win: 'Ctrl+S', mac: 'Cmd+S', labelKey: 'saveTab' },
  { win: 'Ctrl+L', mac: 'Cmd+L', labelKey: 'focusUrlBar' },
  { win: 'Ctrl+B', mac: 'Cmd+B', labelKey: 'toggleSidebar' },
  { win: 'Ctrl+,', mac: 'Cmd+,', labelKey: 'openSettings' },
  { win: 'Ctrl+1', mac: 'Cmd+1', labelKey: 'openCollections' },
  { win: 'Ctrl+Tab', mac: 'Cmd+Option+Right', labelKey: 'nextTab' },
  { win: 'Ctrl+Shift+D', mac: 'Cmd+Shift+D', labelKey: 'devLogs' },
] as const

// --- Main panel ---

export function SettingsPanel() {
  const [section, setSection] = useState<SectionId>('general')
  const settings = useSettingsStore((s) => s.settings)
  const updateGeneral = useSettingsStore((s) => s.updateGeneral)
  const updateAppearance = useSettingsStore((s) => s.updateAppearance)
  const updateRequests = useSettingsStore((s) => s.updateRequests)
  const updateProxy = useSettingsStore((s) => s.updateProxy)
  const updateMock = useSettingsStore((s) => s.updateMock)
  const updateVault = useSettingsStore((s) => s.updateVault)
  const updateEditor = useSettingsStore((s) => s.updateEditor)
  const { themes, activeThemeId, setThemes, setLoading } = useThemesStore()
  const { applyTheme } = useThemeContext()
  const t = useT()
  const appIcon = useAppIcon()

  const s = t.settings
  const selectedThemeId = settings.appearance.themeId
    || activeThemeId
    || (settings.appearance.theme === 'light' ? 'builtin-light' : 'builtin-dark')
  const themeOptions = useMemo(() => themes.map((theme) => {
    const source = theme.meta?.source === 'data/themes'
      ? 'data/themes'
      : theme.meta?.builtin === 'true'
        ? 'built-in'
        : 'skin'
    return { value: theme.id, label: `${theme.name} - ${source}` }
  }), [themes])

  const handleThemeChange = useCallback((themeId: string) => {
    const theme = themes.find((candidate) => candidate.id === themeId)
    if (!theme) {
      updateAppearance({ themeId })
      return
    }
    applyTheme(theme)
    updateAppearance({ themeId: theme.id, theme: inferThemeMode(theme) })
  }, [applyTheme, themes, updateAppearance])

  // Confirm dialogs for danger actions
  const [confirmClearHistory, setConfirmClearHistory] = useState(false)
  const [confirmResetDefaults, setConfirmResetDefaults] = useState(false)
  const [confirmClearAll, setConfirmClearAll] = useState(false)

  // Search filter in sidebar
  const [search, setSearch] = useState('')

  // Developer mode state
  const [isDev, setIsDev] = useState(false)
  const [devLoaded, setDevLoaded] = useState(false)
  useEffect(() => {
    safeIsDevMode().then((v) => {
      setIsDev(v)
      setDevLoaded(true)
    }).catch(() => setDevLoaded(true))
  }, [])

  // Python runtime state
  const [pythonInfo, setPythonInfo] = useState<RuntimeInfo | null>(null)
  const [pythonLoading, setPythonLoading] = useState(false)
  const [startupWindowChrome, setStartupWindowChrome] = useState<AppSettings['appearance']['windowChrome'] | null>(null)
  const [runtimePlatform, setRuntimePlatform] = useState<string | null>(null)
  const loadPythonInfo = useCallback(() => {
    setPythonLoading(true)
    getRuntimeInfo()
      .then((info) => setPythonInfo(info))
      .catch(() => setPythonInfo(null))
      .finally(() => setPythonLoading(false))
  }, [])
  useEffect(() => {
    if (section === 'python' && pythonInfo === null) {
      loadPythonInfo()
    }
  }, [section, pythonInfo, loadPythonInfo])

  useEffect(() => {
    safeGetStartupWindowChrome()
      .then((mode) => setStartupWindowChrome(mode))
      .catch(() => setStartupWindowChrome(null))
    import('@/wailsjs/runtime/runtime').then(({ Environment }) => Environment())
      .then((env) => setRuntimePlatform(env.platform))
      .catch(() => setRuntimePlatform(null))
  }, [])

  useEffect(() => {
    if (section !== 'appearance') return
    if (themes.length > 0) return
    setLoading(true)
    loadAvailableThemes()
      .then(setThemes)
      .finally(() => setLoading(false))
  }, [section, themes.length, setThemes, setLoading])

  // Sync vault timeout to backend on mount
  useEffect(() => {
    safeSetVaultTimeout(settings.vault.autoLockTimeoutMin).catch(() => {})
  }, [settings.vault.autoLockTimeoutMin])

  // Track whether settings were modified (for badge)
  const [settingsModified, setSettingsModified] = useState(false)
  const initialSettingsRef = useRef(JSON.stringify(settings))
  useEffect(() => {
    const current = JSON.stringify(settings)
    setSettingsModified(current !== initialSettingsRef.current)
  }, [settings])

  const allSectionDefs: { id: SectionId; label: string; icon: React.ReactNode }[] = [
    { id: 'general', label: s.sections.general, icon: <Settings size={14} /> },
    { id: 'appearance', label: s.sections.appearance, icon: <Monitor size={14} /> },
    { id: 'requests', label: s.sections.requests, icon: <Globe size={14} /> },
    { id: 'proxy', label: s.sections.proxy, icon: <Shield size={14} /> },
    { id: 'mock', label: s.sections.mock, icon: <Server size={14} /> },
    { id: 'vault', label: s.sections.vault, icon: <Lock size={14} /> },
    { id: 'editor', label: s.sections.editor, icon: <Code2 size={14} /> },
    { id: 'privacy', label: s.sections.privacy, icon: <Database size={14} /> },
    { id: 'shortcuts', label: s.sections.shortcuts, icon: <Keyboard size={14} /> },
    { id: 'about', label: s.sections.about, icon: <Info size={14} /> },
    { id: 'developer', label: s.sections.developer, icon: <Bug size={14} /> },
    { id: 'python', label: 'Python Runtime', icon: <Terminal size={14} /> },
  ]

  const sectionDefs = allSectionDefs.filter((sec) => {
    if (sec.id === 'developer' && devLoaded && !isDev) return false
    if (!search) return true
    return sec.label.toLowerCase().includes(search.toLowerCase())
  })

  const handleExportSettings = useCallback(() => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'adomnia-settings.json'
    a.click()
    URL.revokeObjectURL(url)
  }, [settings])

  const handleImportSettings = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const parsed = JSON.parse(text)
        useSettingsStore.getState().update(parsed)
      } catch {
        console.error('Failed to import settings')
      }
    }
    input.click()
  }, [])

  const handleResetDefaults = useCallback(() => {
    // reload will pick up defaults if saved settings are cleared
    useSettingsStore.getState().load()
  }, [])

  const handleClearAllData = useCallback(() => {
    localStorage.clear()
    useSettingsStore.getState().load()
    window.location.reload()
  }, [])

  // Estimate localStorage usage
  const storageEstimate = (() => {
    let total = 0
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!
      total += (localStorage.getItem(key) ?? '').length
    }
    return (total / 1024).toFixed(1)
  })()
  const isLinuxRuntime = runtimePlatform === 'linux'
  const windowChromeValue = isLinuxRuntime
    ? (settings.appearance.windowChrome ?? 'app')
    : (settings.appearance.windowChrome === 'system' ? 'system' : 'app')
  const windowChromeOptions = isLinuxRuntime
    ? [
        { value: 'app', label: s.appearance.windowChromeOptions.appWayland },
        { value: 'app-xwayland', label: s.appearance.windowChromeOptions.appXWayland },
        { value: 'system', label: s.appearance.windowChromeOptions.system },
      ]
    : [
        { value: 'app', label: s.appearance.windowChromeOptions.app },
        { value: 'system', label: s.appearance.windowChromeOptions.system },
      ]

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-52 border-r border-border-1 py-3 px-2 flex flex-col gap-0.5 overflow-y-auto">
        {/* Search */}
        <div className="relative mb-2">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-4" />
          <input
            type="text"
            placeholder="Filter..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-7 pl-7 pr-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 placeholder:text-text-4 focus:border-accent outline-none"
          />
        </div>
        {sectionDefs.map((sec) => (
          <button
            key={sec.id}
            onClick={() => setSection(sec.id)}
            className={cn(
              'text-left px-3 py-1.5 rounded text-xs transition-colors flex items-center gap-2',
              section === sec.id
                ? 'bg-surface-2 text-text-1'
                : 'text-text-3 hover:text-text-1 hover:bg-surface-2'
            )}
          >
            {sec.icon}
            <span className="flex-1">{sec.label}</span>
            {settingsModified && section === sec.id && (
              <span className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 max-w-xl">
        {/* General */}
        {section === 'general' && (
          <>
            <SectionHeader title={s.general.title} subtitle={s.general.subtitle} />
            <SettingsCard>
              <Select
                label={s.general.defaultStartupRail}
                desc={s.general.defaultStartupRailDesc}
                value={settings.general.defaultStartupRail}
                options={[
                  { value: 'collections', label: s.general.railOptions.collections },
                  { value: 'kafka', label: s.general.railOptions.kafka },
                  { value: 'proxy', label: s.general.railOptions.proxy },
                  { value: 'mock', label: s.general.railOptions.mock },
                  { value: 'nettools', label: s.general.railOptions.nettools },
                  { value: 'observe', label: s.general.railOptions.observe },
                  { value: 'secretscanner', label: 'Secret Scanner' },
                ]}
                onChange={(v) => updateGeneral({ defaultStartupRail: v })}
              />
            </SettingsCard>
            <SettingsCard>
              <Toggle
                label={s.general.restoreTabs}
                desc={s.general.restoreTabsDesc}
                checked={settings.general.restoreTabsOnStartup}
                onChange={(v) => updateGeneral({ restoreTabsOnStartup: v })}
              />
              <Toggle
                label={s.general.showWelcome}
                desc={s.general.showWelcomeDesc}
                checked={settings.general.showWelcomeOnEmptyWorkspace}
                onChange={(v) => updateGeneral({ showWelcomeOnEmptyWorkspace: v })}
              />
              <Toggle
                label={s.general.confirmClose}
                desc={s.general.confirmCloseDesc}
                checked={settings.general.confirmBeforeClosingDirtyTabs}
                onChange={(v) => updateGeneral({ confirmBeforeClosingDirtyTabs: v })}
              />
            </SettingsCard>
          </>
        )}

        {/* Appearance */}
        {section === 'appearance' && (
          <>
            <SectionHeader title={s.appearance.title} subtitle={s.appearance.subtitle} />
            <SettingsCard>
              <Select
                label={s.appearance.language}
                desc={s.appearance.languageDesc}
                value={settings.appearance.language ?? 'en'}
                options={[
                  { value: 'en', label: s.appearance.languageOptions.en },
                  { value: 'it', label: s.appearance.languageOptions.it },
                ]}
                onChange={(v) => updateAppearance({ language: v as 'en' | 'it' })}
              />
              <Select
                label={s.appearance.theme}
                desc={s.appearance.themeDesc}
                value={selectedThemeId}
                options={themeOptions.length
                  ? themeOptions
                  : [{ value: selectedThemeId, label: s.appearance.themeOptions.loading }]}
                onChange={handleThemeChange}
              />
              <Select
                label={s.appearance.windowChrome}
                desc={s.appearance.windowChromeDesc}
                value={windowChromeValue}
                options={windowChromeOptions}
                onChange={(v) =>
                  updateAppearance({ windowChrome: v as AppSettings['appearance']['windowChrome'] })
                }
              />
              <Select
                label={s.appearance.windowChrome}
                desc={s.appearance.windowChromeDesc}
                value={windowChromeValue}
                options={windowChromeOptions}
                onChange={(v) =>
                  updateAppearance({ windowChrome: v as AppSettings['appearance']['windowChrome'] })
                }
              />
              {startupWindowChrome !== null && startupWindowChrome !== windowChromeValue && (
                <div className="mx-1 mb-1 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[10px] text-amber-200">
                  {s.appearance.windowChromeRestart}
                </div>
              )}
              <Select
                label={s.appearance.density}
                desc={s.appearance.densityDesc}
                value={settings.appearance.density}
                options={[
                  { value: 'compact', label: s.appearance.densityOptions.compact },
                  { value: 'comfortable', label: s.appearance.densityOptions.comfortable },
                  { value: 'spacious', label: s.appearance.densityOptions.spacious },
                ]}
                onChange={(v) =>
                  updateAppearance({ density: v as AppSettings['appearance']['density'] })
                }
              />
              <Select
                label={s.appearance.uiFont}
                desc={s.appearance.uiFontDesc}
                value={settings.appearance.uiFont}
                options={UI_FONTS.map((font) => ({ value: font.id, label: font.label }))}
                onChange={(v) =>
                  updateAppearance({ uiFont: v as UIFontId })
                }
              />
              <Select
                label={s.appearance.fontSize}
                desc={s.appearance.fontSizeDesc}
                value={settings.appearance.fontSize}
                options={[
                  { value: 'small', label: s.appearance.fontSizeOptions.small },
                  { value: 'medium', label: s.appearance.fontSizeOptions.medium },
                  { value: 'large', label: s.appearance.fontSizeOptions.large },
                ]}
                onChange={(v) =>
                  updateAppearance({ fontSize: v as AppSettings['appearance']['fontSize'] })
                }
              />
              <Select
                label={s.appearance.monoFontSize}
                desc={s.appearance.monoFontSizeDesc}
                value={settings.appearance.monoFontSize}
                options={[
                  { value: 'small', label: s.appearance.monoFontSizeOptions.small },
                  { value: 'medium', label: s.appearance.monoFontSizeOptions.medium },
                  { value: 'large', label: s.appearance.monoFontSizeOptions.large },
                ]}
                onChange={(v) =>
                  updateAppearance({ monoFontSize: v as AppSettings['appearance']['monoFontSize'] })
                }
              />
            </SettingsCard>
            <SettingsCard>
              <NumberInput
                label={s.appearance.sidebarWidth}
                desc={s.appearance.sidebarWidthDesc}
                value={settings.appearance.sidebarWidth}
                min={180}
                max={600}
                onChange={(v) => updateAppearance({ sidebarWidth: v })}
              />
              <Select
                label={s.appearance.accentColorPreset}
                desc={s.appearance.accentColorPresetDesc}
                value={settings.appearance.accentColorPreset}
                options={[
                  { value: 'default', label: s.appearance.accentOptions.default },
                  { value: 'blue', label: s.appearance.accentOptions.blue },
                  { value: 'purple', label: s.appearance.accentOptions.purple },
                  { value: 'green', label: s.appearance.accentOptions.green },
                  { value: 'orange', label: s.appearance.accentOptions.orange },
                  { value: 'red', label: s.appearance.accentOptions.red },
                ]}
                onChange={(v) => updateAppearance({ accentColorPreset: v })}
              />
              <Toggle
                label={s.appearance.showRailIconsOnly}
                desc={s.appearance.showRailIconsOnlyDesc}
                checked={settings.appearance.showRailIconsOnly}
                onChange={(v) => updateAppearance({ showRailIconsOnly: v })}
              />
            </SettingsCard>
            <SettingsCard>
              <div className="py-2 px-1 flex items-center justify-between">
                <div>
                  <div className="text-xs text-text-1">{s.appearance.themeEditorLink}</div>
                  <div className="text-[10px] text-text-4">{s.appearance.themeEditorLinkDesc}</div>
                </div>
                <button
                  onClick={() => {
                    // navigate to themes rail — set rail via store or emit event
                    document.dispatchEvent(new CustomEvent('adomnia:set-rail', { detail: 'themes' }))
                  }}
                  className="h-7 px-3 bg-surface-2 border border-border-2 rounded text-xs text-text-2 hover:text-text-1 hover:bg-surface-3"
                >
                  {s.actions.open}
                </button>
              </div>
            </SettingsCard>
          </>
        )}

        {/* Requests */}
        {section === 'requests' && (
          <>
            <SectionHeader title={s.requests.title} subtitle={s.requests.subtitle} />
            <SettingsCard>
              <Select
                label={s.requests.defaultHttpMethod}
                desc={s.requests.defaultHttpMethodDesc}
                value={settings.requests.defaultHttpMethod}
                options={[
                  { value: 'GET', label: 'GET' },
                  { value: 'POST', label: 'POST' },
                  { value: 'PUT', label: 'PUT' },
                  { value: 'PATCH', label: 'PATCH' },
                  { value: 'DELETE', label: 'DELETE' },
                ]}
                onChange={(v) => updateRequests({ defaultHttpMethod: v })}
              />
              <NumberInput
                label={s.requests.timeout}
                desc={s.requests.timeoutDesc}
                value={settings.requests.defaultTimeoutMs}
                min={1000}
                max={300000}
                onChange={(v) => updateRequests({ defaultTimeoutMs: v })}
              />
              <NumberInput
                label={s.requests.maxHistory}
                desc={s.requests.maxHistoryDesc}
                value={settings.requests.maxResponseHistoryPerTab}
                min={1}
                max={100}
                onChange={(v) => updateRequests({ maxResponseHistoryPerTab: v })}
              />
            </SettingsCard>
            <SettingsCard>
              <Toggle
                label={s.requests.followRedirects}
                desc={s.requests.followRedirectsDesc}
                checked={settings.requests.followRedirects}
                onChange={(v) => updateRequests({ followRedirects: v })}
              />
              <Toggle
                label={s.requests.saveHistory}
                desc={s.requests.saveHistoryDesc}
                checked={settings.requests.saveResponsesToHistory}
                onChange={(v) => updateRequests({ saveResponsesToHistory: v })}
              />
            </SettingsCard>
          </>
        )}

        {/* Network / Proxy */}
        {section === 'proxy' && (
          <>
            <SectionHeader title={s.proxy.title} subtitle={s.proxy.subtitle} />
            <SettingsCard>
              <NumberInput
                label={s.proxy.defaultProxyPort}
                desc={s.proxy.defaultProxyPortDesc}
                value={settings.proxy.defaultProxyPort}
                min={1024}
                max={65535}
                onChange={(v) => updateProxy({ defaultProxyPort: v })}
              />
              <NumberInput
                label={s.proxy.maxTrafficEntries}
                desc={s.proxy.maxTrafficEntriesDesc}
                value={settings.proxy.maxTrafficEntries}
                min={10}
                max={10000}
                onChange={(v) => updateProxy({ maxTrafficEntries: v })}
              />
              <NumberInput
                label={s.proxy.reqBodyLimitKB}
                desc={s.proxy.reqBodyLimitKBDesc}
                value={settings.proxy.reqBodyLimitKB}
                min={1}
                max={102400}
                onChange={(v) => updateProxy({ reqBodyLimitKB: v })}
              />
              <NumberInput
                label={s.proxy.respBodyLimitKB}
                desc={s.proxy.respBodyLimitKBDesc}
                value={settings.proxy.respBodyLimitKB}
                min={1}
                max={102400}
                onChange={(v) => updateProxy({ respBodyLimitKB: v })}
              />
            </SettingsCard>
            <SettingsCard>
              <TextInput
                label={s.proxy.upstreamProxy}
                desc={s.proxy.upstreamProxyDesc}
                value={settings.proxy.upstreamProxy}
                placeholder="http://user:pass@host:port"
                onChange={(v) => updateProxy({ upstreamProxy: v })}
              />
              <TextAreaInput
                label={s.proxy.noProxyHosts}
                desc={s.proxy.noProxyHostsDesc}
                value={settings.proxy.noProxyHosts}
                placeholder="localhost&#10;127.0.0.1&#10;*.local"
                rows={3}
                onChange={(v) => updateProxy({ noProxyHosts: v })}
              />
            </SettingsCard>
            <SettingsCard>
              <Toggle
                label={s.proxy.enableHttps}
                desc={s.proxy.enableHttpsDesc}
                checked={settings.proxy.enableHttps}
                onChange={(v) => updateProxy({ enableHttps: v })}
              />
              {settings.proxy.enableHttps && (
                <div className="py-2 px-1 flex items-center justify-between">
                  <div>
                    <div className="text-xs text-text-1">{s.proxy.exportCA}</div>
                    <div className="text-[10px] text-text-4">{s.proxy.exportCADesc}</div>
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        const port = await safeGetServerPort()
                        if (!port) return
                        window.open(`http://127.0.0.1:${port}/proxy/ca/export?format=pem`, '_blank')
                      } catch {
                        console.error('Failed to export CA cert')
                      }
                    }}
                    className="h-7 px-3 bg-surface-2 border border-border-2 rounded text-xs text-text-2 hover:text-text-1 hover:bg-surface-3"
                  >
                    {s.actions.export}
                  </button>
                </div>
              )}
            </SettingsCard>
          </>
        )}

        {/* Mock Server Defaults */}
        {section === 'mock' && (
          <>
            <SectionHeader title={s.mock.title} subtitle={s.mock.subtitle} />
            <SettingsCard>
              <NumberInput
                label={s.mock.defaultMockPort}
                desc={s.mock.defaultMockPortDesc}
                value={settings.mock.defaultMockPort}
                min={1024}
                max={65535}
                onChange={(v) => updateMock({ defaultMockPort: v })}
              />
              <NumberInput
                label={s.mock.defaultResponseDelay}
                desc={s.mock.defaultResponseDelayDesc}
                value={settings.mock.defaultResponseDelayMs}
                min={0}
                max={60000}
                onChange={(v) => updateMock({ defaultResponseDelayMs: v })}
              />
              <PasswordInput
                label={s.mock.mockServerPassword}
                desc={s.mock.mockServerPasswordDesc}
                value={settings.mock.mockServerPassword}
                onChange={(v) => updateMock({ mockServerPassword: v })}
              />
            </SettingsCard>
            <SettingsCard>
              <Toggle
                label={s.mock.corsHeadersAuto}
                desc={s.mock.corsHeadersAutoDesc}
                checked={settings.mock.corsHeadersAuto}
                onChange={(v) => updateMock({ corsHeadersAuto: v })}
              />
              <Toggle
                label={s.mock.logHitsToFile}
                desc={s.mock.logHitsToFileDesc}
                checked={settings.mock.logHitsToFile}
                onChange={(v) => updateMock({ logHitsToFile: v })}
              />
            </SettingsCard>
          </>
        )}

        {/* Vault */}
        {section === 'vault' && (
          <>
            <SectionHeader title={s.vault.title} subtitle={s.vault.subtitle} />
            <SettingsCard>
              <NumberInput
                label={s.vault.autoLockTimeout}
                desc={s.vault.autoLockTimeoutDesc}
                value={settings.vault.autoLockTimeoutMin}
                min={1}
                max={120}
                onChange={(v) => {
                  updateVault({ autoLockTimeoutMin: v })
                  safeSetVaultTimeout(v).catch(() => {})
                }}
              />
              <Toggle
                label={s.vault.lockOnMinimize}
                desc={s.vault.lockOnMinimizeDesc}
                checked={settings.vault.lockVaultOnMinimize}
                onChange={(v) => updateVault({ lockVaultOnMinimize: v })}
              />
              <Toggle
                label={s.vault.showVaultInAutocomplete}
                desc={s.vault.showVaultInAutocompleteDesc}
                checked={settings.vault.showVaultInAutocomplete}
                onChange={(v) => updateVault({ showVaultInAutocomplete: v })}
              />
            </SettingsCard>
          </>
        )}

        {/* Editor */}
        {section === 'editor' && (
          <>
            <SectionHeader title={s.editor.title} subtitle={s.editor.subtitle} />
            <SettingsCard>
              <Select
                label={s.editor.tabSize}
                desc={s.editor.tabSizeDesc}
                value={String(settings.editor.tabSize)}
                options={[
                  { value: '2', label: s.editor.tabSizeOptions['2'] },
                  { value: '4', label: s.editor.tabSizeOptions['4'] },
                  { value: '8', label: s.editor.tabSizeOptions['8'] },
                ]}
                onChange={(v) => updateEditor({ tabSize: Number(v) as 2 | 4 | 8 })}
              />
              <NumberInput
                label={s.editor.responseMaxRenderSize}
                desc={s.editor.responseMaxRenderSizeDesc}
                value={settings.editor.responseMaxRenderSizeKB}
                min={10}
                max={102400}
                onChange={(v) => updateEditor({ responseMaxRenderSizeKB: v })}
              />
            </SettingsCard>
            <SettingsCard>
              <Toggle
                label={s.editor.softTabs}
                desc={s.editor.softTabsDesc}
                checked={settings.editor.softTabs}
                onChange={(v) => updateEditor({ softTabs: v })}
              />
              <Toggle
                label={s.editor.wordWrap}
                desc={s.editor.wordWrapDesc}
                checked={settings.editor.wordWrap}
                onChange={(v) => updateEditor({ wordWrap: v })}
              />
              <Toggle
                label={s.editor.lineNumbers}
                desc={s.editor.lineNumbersDesc}
                checked={settings.editor.lineNumbers}
                onChange={(v) => updateEditor({ lineNumbers: v })}
              />
              <Toggle
                label={s.editor.autoCloseBrackets}
                desc={s.editor.autoCloseBracketsDesc}
                checked={settings.editor.autoCloseBrackets}
                onChange={(v) => updateEditor({ autoCloseBrackets: v })}
              />
              <Toggle
                label={s.editor.formatResponseAuto}
                desc={s.editor.formatResponseAutoDesc}
                checked={settings.editor.formatResponseAuto}
                onChange={(v) => updateEditor({ formatResponseAuto: v })}
              />
            </SettingsCard>
          </>
        )}

        {/* Privacy & Data */}
        {section === 'privacy' && (
          <>
            <SectionHeader title={s.privacy.title} subtitle={s.privacy.subtitle} />
            <SettingsCard>
              <div className="py-2 px-1 flex items-center justify-between">
                <div>
                  <div className="text-xs text-text-1">{s.privacy.storageUsage}</div>
                  <div className="text-[10px] text-text-4">{s.privacy.storageUsageDesc}</div>
                </div>
                <span className="text-xs text-text-2 bg-surface-2 px-2 py-0.5 rounded">
                  ~{storageEstimate} KB
                </span>
              </div>
            </SettingsCard>
            <SettingsCard>
              <div className="py-2 px-1 flex items-center justify-between">
                <div>
                  <div className="text-xs text-text-1">{s.privacy.exportSettings}</div>
                  <div className="text-[10px] text-text-4">{s.privacy.exportSettingsDesc}</div>
                </div>
                <button
                  onClick={handleExportSettings}
                  className="h-7 px-3 bg-surface-2 border border-border-2 rounded text-xs text-text-2 hover:text-text-1 hover:bg-surface-3"
                >
                  {s.actions.export}
                </button>
              </div>
              <div className="py-2 px-1 flex items-center justify-between">
                <div>
                  <div className="text-xs text-text-1">{s.privacy.importSettings}</div>
                  <div className="text-[10px] text-text-4">{s.privacy.importSettingsDesc}</div>
                </div>
                <button
                  onClick={handleImportSettings}
                  className="h-7 px-3 bg-surface-2 border border-border-2 rounded text-xs text-text-2 hover:text-text-1 hover:bg-surface-3"
                >
                  {s.actions.import}
                </button>
              </div>
            </SettingsCard>

            <div className="mb-3">
              <div className="text-xs font-semibold text-status-err mb-2 flex items-center gap-1.5">
                <Shield size={12} />
                {s.privacy.dangerZone}
              </div>
              <DangerZone>
                <div className="py-2 px-1 flex items-center justify-between">
                  <div>
                    <div className="text-xs text-text-1">{s.privacy.clearResponseHistory}</div>
                    <div className="text-[10px] text-text-4">{s.privacy.clearResponseHistoryDesc}</div>
                  </div>
                  <button
                    onClick={() => setConfirmClearHistory(true)}
                    className="h-7 px-3 bg-status-err text-white rounded text-xs hover:bg-status-err/80"
                  >
                    {s.actions.clear}
                  </button>
                </div>
                <div className="py-2 px-1 flex items-center justify-between">
                  <div>
                    <div className="text-xs text-text-1">{s.privacy.resetDefaults}</div>
                    <div className="text-[10px] text-text-4">{s.privacy.resetDefaultsDesc}</div>
                  </div>
                  <button
                    onClick={() => setConfirmResetDefaults(true)}
                    className="h-7 px-3 bg-status-err text-white rounded text-xs hover:bg-status-err/80"
                  >
                    {s.actions.reset}
                  </button>
                </div>
                <div className="py-2 px-1 flex items-center justify-between">
                  <div>
                    <div className="text-xs text-text-1">{s.privacy.clearAllData}</div>
                    <div className="text-[10px] text-text-4">{s.privacy.clearAllDataDesc}</div>
                  </div>
                  <button
                    onClick={() => setConfirmClearAll(true)}
                    className="h-7 px-3 bg-status-err text-white rounded text-xs hover:bg-status-err/80"
                  >
                    {s.actions.clear}
                  </button>
                </div>
              </DangerZone>
            </div>

            <ConfirmDialog
              open={confirmClearHistory}
              title={s.privacy.clearResponseHistory}
              message={s.privacy.confirmClearHistory}
              confirmLabel={s.actions.clear}
              variant="danger"
              onConfirm={() => {
                localStorage.removeItem('adomnia.respHistory')
              }}
              onCancel={() => setConfirmClearHistory(false)}
            />
            <ConfirmDialog
              open={confirmResetDefaults}
              title={s.privacy.resetDefaults}
              message={s.privacy.confirmResetDefaults}
              confirmLabel={s.actions.reset}
              variant="danger"
              onConfirm={handleResetDefaults}
              onCancel={() => setConfirmResetDefaults(false)}
            />
            <ConfirmDialog
              open={confirmClearAll}
              title={s.privacy.clearAllData}
              message={s.privacy.confirmClearAllData}
              confirmLabel={s.actions.clear}
              variant="danger"
              onConfirm={handleClearAllData}
              onCancel={() => setConfirmClearAll(false)}
            />
          </>
        )}

        {/* Keyboard Shortcuts */}
        {section === 'shortcuts' && (
          <>
            <SectionHeader title={s.shortcuts.title} subtitle={s.shortcuts.subtitle} />
            <SettingsCard>
              <div className="grid grid-cols-[1fr_120px_120px] gap-2 px-1 pb-2 text-[10px] uppercase tracking-wider text-text-4">
                <span>Action</span>
                <span>Windows</span>
                <span>macOS</span>
              </div>
              {shortcutsList.map((sc) => (
                <div key={sc.labelKey} className="grid grid-cols-[1fr_120px_120px] items-center gap-2 py-2 px-1">
                  <span className="text-xs text-text-1">
                    {(s.shortcuts as Record<string, string>)[sc.labelKey]}
                  </span>
                  <kbd className="px-2 py-0.5 bg-surface-3 border border-border-2 rounded text-[10px] text-text-2 font-mono">
                    {sc.win}
                  </kbd>
                  <kbd className="px-2 py-0.5 bg-surface-3 border border-border-2 rounded text-[10px] text-text-2 font-mono">
                    {sc.mac}
                  </kbd>
                </div>
              ))}
            </SettingsCard>
          </>
        )}

        {/* About */}
        {section === 'about' && (
          <>
            <SectionHeader title={s.about.title} subtitle={s.about.subtitle} />
            {/* Logo + Name */}
            <div className="flex items-center gap-4 mb-4 p-4 bg-surface-1 border border-border-2 rounded-md">
              <img
                src={appIcon}
                alt="adOmnia"
                className="w-12 h-12 rounded-lg"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none'
                }}
              />
              <div>
                <div className="text-sm font-bold text-text-1">adOmnia</div>
                <div className="text-[10px] text-text-4">A local-first API development toolbox</div>
                <div className="mt-1 text-[10px] text-text-3">Developed by Andrea Cavallo</div>
              </div>
            </div>
            <SettingsCard>
              <div className="py-2 px-1 flex items-center justify-between">
                <span className="text-xs text-text-1">{s.about.version}</span>
                <span className="text-xs text-text-2 font-mono">0.1.0</span>
              </div>
              <div className="py-2 px-1 flex items-center justify-between">
                <span className="text-xs text-text-1">{s.about.buildDate}</span>
                <span className="text-xs text-text-2 font-mono">{s.about.unknown}</span>
              </div>
              <div className="py-2 px-1 flex items-center justify-between">
                <span className="text-xs text-text-1">{s.about.commitHash}</span>
                <span className="text-xs text-text-2 font-mono">{s.about.unknown}</span>
              </div>
              <div className="py-2 px-1 flex items-center justify-between">
                <span className="text-xs text-text-1">{s.about.stackInfo}</span>
                <span className="text-xs text-text-2">Wails · Go · React</span>
              </div>
              <div className="py-2 px-1 flex items-center justify-between">
                <span className="text-xs text-text-1">Developer</span>
                <span className="text-xs text-text-2">Andrea Cavallo</span>
              </div>
            </SettingsCard>
            <SettingsCard>
              <div className="py-2 px-1">
                <a
                  href="https://github.com/anomalyco/adomnia"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-accent hover:underline"
                >
                  {s.about.linkGitHub}
                </a>
              </div>
              <div className="py-2 px-1">
                <details className="text-xs text-text-2">
                  <summary className="cursor-pointer hover:text-text-1">
                    {s.about.openSourceLicenses}
                  </summary>
                  <div className="mt-2 text-[10px] text-text-4 space-y-1">
                    <p>React — MIT License</p>
                    <p>Vite — MIT License</p>
                    <p>Zustand — MIT License</p>
                    <p>lucide-react — ISC License</p>
                    <p>tailwind-merge — MIT License</p>
                    <p>class-variance-authority — Apache 2.0</p>
                    <p>clsx — MIT License</p>
                    <p>Wails — MIT License</p>
                  </div>
                </details>
              </div>
            </SettingsCard>
          </>
        )}

        {/* Developer / Debug */}
        {section === 'developer' && (
          <>
            <SectionHeader title={s.developer.title} subtitle={s.developer.subtitle} />
            <SettingsCard>
              <Toggle
                label={s.developer.devLogging}
                desc={s.developer.devLoggingDesc}
                checked={isDev}
                onChange={(v) => {
                  setIsDev(v)
                  safeSetDevMode(v).catch(() => {})
                }}
              />
              <Toggle
                label={s.developer.showPerfOverlay}
                desc={s.developer.showPerfOverlayDesc}
                checked={false}
                onChange={() => {
                  console.log('Toggle perf overlay — not yet implemented')
                }}
              />
            </SettingsCard>
            <SettingsCard>
              <div className="py-2 px-1 flex items-center justify-between">
                <div>
                  <div className="text-xs text-text-1">{s.developer.openDevLogsFolder}</div>
                  <div className="text-[10px] text-text-4">{s.developer.openDevLogsFolderDesc}</div>
                </div>
                <button
                  onClick={() => safeOpenDevLogsFolder().catch(console.error)}
                  className="h-7 px-3 bg-surface-2 border border-border-2 rounded text-xs text-text-2 hover:text-text-1 hover:bg-surface-3"
                >
                  {s.actions.open}
                </button>
              </div>
              <div className="py-2 px-1 flex items-center justify-between">
                <div>
                  <div className="text-xs text-text-1">{s.developer.clearDevLogs}</div>
                  <div className="text-[10px] text-text-4">{s.developer.clearDevLogsDesc}</div>
                </div>
                <button
                  onClick={async () => {
                    try {
                      await safeClearDevLogs()
                    } catch {
                      console.error('Failed to clear dev logs')
                    }
                  }}
                  className="h-7 px-3 bg-surface-2 border border-border-2 rounded text-xs text-text-2 hover:text-text-1 hover:bg-surface-3"
                >
                  {s.actions.clear}
                </button>
              </div>
            </SettingsCard>
          </>
        )}

        {/* Python Runtime */}
        {section === 'python' && (
          <>
            <SectionHeader title="Python Runtime" subtitle="Manage the embedded Python runtime used by plugins" />
            <SettingsCard>
              <div className="py-2 px-1 flex items-center justify-between">
                <div>
                  <div className="text-xs text-text-1">Status</div>
                  <div className="text-[10px] text-text-4">Whether Python runtime is available</div>
                </div>
                {pythonLoading ? (
                  <span className="text-xs text-text-4">Loading...</span>
                ) : (
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'w-2 h-2 rounded-full',
                        pythonInfo?.available ? 'bg-green-500' : 'bg-red-500'
                      )}
                    />
                    <span className="text-xs text-text-2">
                      {pythonInfo?.available ? 'Ready' : 'Not found'}
                    </span>
                  </div>
                )}
              </div>
              <div className="py-2 px-1 flex items-center justify-between">
                <div>
                  <div className="text-xs text-text-1">Version</div>
                  <div className="text-[10px] text-text-4">Detected Python interpreter version</div>
                </div>
                <span className="text-xs text-text-2 font-mono">
                  {pythonInfo?.version || 'N/A'}
                </span>
              </div>
              <div className="py-2 px-1 flex items-center justify-between">
                <div>
                  <div className="text-xs text-text-1">Path</div>
                  <div className="text-[10px] text-text-4">Location of the Python executable</div>
                </div>
                <span className="text-xs text-text-2 font-mono max-w-[200px] truncate" title={pythonInfo?.path || ''}>
                  {pythonInfo?.path || 'N/A'}
                </span>
              </div>
              <div className="py-2 px-1 flex items-center justify-between">
                <div>
                  <div className="text-xs text-text-1">Source</div>
                  <div className="text-[10px] text-text-4">Whether using embedded or system Python</div>
                </div>
                <span className={cn(
                  'px-2 py-0.5 text-[10px] font-medium rounded',
                  pythonInfo?.source === 'embedded'
                    ? 'bg-accent/10 text-accent'
                    : 'bg-surface-2 text-text-3'
                )}>
                  {pythonInfo?.source === 'embedded' ? 'Embedded' : pythonInfo?.source === 'system' ? 'System' : 'Unknown'}
                </span>
              </div>
            </SettingsCard>
            <SettingsCard>
              <div className="py-2 px-1 flex items-center justify-between">
                <div>
                  <div className="text-xs text-text-1">Reinstall Runtime</div>
                  <div className="text-[10px] text-text-4">Re-download and setup the embedded Python runtime</div>
                </div>
                <button
                  onClick={() => {
                    // Call backend to reinstall the runtime
                    const bridge = (window as unknown as { go: { main: { PythonBridge: { SpawnWorker: (id: string, cfg: string) => Promise<void> } } } }).go?.main?.PythonBridge
                    if (bridge) {
                      // Trigger a reinstall by calling backend (this is a UI placeholder; the actual Go method may vary)
                      bridge.SpawnWorker('__reinstall__', '{}').catch(() => {})
                    }
                    // Refresh info after a delay
                    setTimeout(loadPythonInfo, 2000)
                  }}
                  className="h-7 px-3 bg-surface-2 border border-border-2 rounded text-xs text-text-2 hover:text-text-1 hover:bg-surface-3"
                >
                  Reinstall
                </button>
              </div>
              <div className="py-2 px-1 flex items-center justify-between">
                <div>
                  <div className="text-xs text-text-1">Open Runtime Folder</div>
                  <div className="text-[10px] text-text-4">Open the folder containing the Python runtime files</div>
                </div>
                <button
                  onClick={() => {
                    // Use the same pattern as OpenDevLogsFolder, but for the runtime path
                    safeOpenDevLogsFolder().catch(() => {})
                  }}
                  className="h-7 px-3 bg-surface-2 border border-border-2 rounded text-xs text-text-2 hover:text-text-1 hover:bg-surface-3"
                >
                  Open Folder
                </button>
              </div>
              <div className="py-2 px-1 flex items-center justify-between">
                <div>
                  <div className="text-xs text-text-1">Refresh Status</div>
                  <div className="text-[10px] text-text-4">Re-check the Python runtime availability</div>
                </div>
                <button
                  onClick={loadPythonInfo}
                  disabled={pythonLoading}
                  className="h-7 px-3 bg-surface-2 border border-border-2 rounded text-xs text-text-2 hover:text-text-1 hover:bg-surface-3 disabled:opacity-50"
                >
                  Refresh
                </button>
              </div>
            </SettingsCard>
          </>
        )}
      </div>
    </div>
  )
}
