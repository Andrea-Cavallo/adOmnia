import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import type { AppSettings } from '@/stores/settings'
import { useSettingsStore } from '@/stores/settings'
import { useThemesStore } from '@/stores/themes'
import { useT } from '@/lib/i18n'
import { UI_FONTS, type UIFontId } from '@/lib/uiFonts'
import { cn } from '@/lib/utils'
import { useAppIcon } from '@/lib/brandAssets'
import { APP_VERSION, BUILD_DATE, COMMIT_HASH, formatBuildDate } from '@/lib/buildInfo'
import { useThemeContext } from '@/components/themes/ThemeProvider'
import { inferThemeMode, loadAvailableThemes } from '@/lib/themeCatalog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useTabsStore } from '@/stores/tabs'
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
  Sparkles,
  FolderOpen,
} from 'lucide-react'
import { Toggle, Select, NumberInput, TextInput, PasswordInput, TextAreaInput } from './SettingsFields'
import { AISettings } from './AISettings'
import { DangerZone, SectionHeader, SettingsCard } from './SettingsLayout'
import { UpdateCheckRow } from './UpdateCheckRow'
import { WorkspacePanel } from '@/components/workspace/WorkspacePanel'

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
  | 'features'
  | 'workspace'
  | 'privacy'
  | 'shortcuts'
  | 'about'
  | 'developer'
  | 'ai'

// --- Keyboard shortcuts data ---

const shortcutsList = [
  { win: 'Ctrl+K / Ctrl+P', mac: 'Cmd+K / Cmd+P', labelKey: 'commandPalette' },
  { win: 'Ctrl+Enter', mac: 'Cmd+Enter', labelKey: 'sendRequest' },
  { win: 'Ctrl+N', mac: 'Cmd+N', labelKey: 'newTab' },
  { win: 'Ctrl+W', mac: 'Cmd+W', labelKey: 'closeTab' },
  { win: 'Ctrl+D', mac: 'Cmd+D', labelKey: 'duplicateTab' },
  { win: 'Ctrl+S', mac: 'Cmd+S', labelKey: 'saveTab' },
  { win: 'Ctrl+L', mac: 'Cmd+L', labelKey: 'focusUrlBar' },
  { win: 'Ctrl+Shift+F', mac: 'Cmd+Shift+F', labelKey: 'focusSearch' },
  { win: 'Ctrl+B', mac: 'Cmd+B', labelKey: 'toggleSidebar' },
  { win: 'Ctrl+,', mac: 'Cmd+,', labelKey: 'openSettings' },
  { win: 'Ctrl+1…7', mac: 'Cmd+1…7', labelKey: 'switchRail' },
  { win: 'Ctrl+Shift+]', mac: 'Cmd+Shift+]', labelKey: 'nextTab' },
  { win: 'Ctrl+Shift+[', mac: 'Cmd+Shift+[', labelKey: 'prevTab' },
  { win: 'Ctrl+Shift+D', mac: 'Cmd+Shift+D', labelKey: 'devLogs' },
] as const

// --- Main panel ---

export function SettingsPanel({ initialSection = 'general' }: { initialSection?: SectionId }) {
  const [section, setSection] = useState<SectionId>(initialSection)
  const settings = useSettingsStore((s) => s.settings)
  const updateGeneral = useSettingsStore((s) => s.updateGeneral)
  const updateAppearance = useSettingsStore((s) => s.updateAppearance)
  const updateRequests = useSettingsStore((s) => s.updateRequests)
  const updateProxy = useSettingsStore((s) => s.updateProxy)
  const updateMock = useSettingsStore((s) => s.updateMock)
  const updateVault = useSettingsStore((s) => s.updateVault)
  const updateEditor = useSettingsStore((s) => s.updateEditor)
  const updateFeatures = useSettingsStore((s) => s.updateFeatures)
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
  const [confirmDisableTabRestore, setConfirmDisableTabRestore] = useState(false)

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

  const [startupWindowChrome, setStartupWindowChrome] = useState<AppSettings['appearance']['windowChrome'] | null>(null)
  const [runtimePlatform, setRuntimePlatform] = useState<string | null>(null)

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

  const searchable = (values: object) => Object.values(values)
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
  const allSectionDefs: { id: SectionId; label: string; icon: React.ReactNode; terms: string }[] = [
    { id: 'general', label: s.sections.general, icon: <Settings size={14} />, terms: searchable(s.general) },
    { id: 'appearance', label: s.sections.appearance, icon: <Monitor size={14} />, terms: searchable(s.appearance) },
    { id: 'requests', label: s.sections.requests, icon: <Globe size={14} />, terms: searchable(s.requests) },
    { id: 'proxy', label: s.sections.proxy, icon: <Shield size={14} />, terms: searchable(s.proxy) },
    { id: 'mock', label: s.sections.mock, icon: <Server size={14} />, terms: searchable(s.mock) },
    { id: 'vault', label: s.sections.vault, icon: <Lock size={14} />, terms: searchable(s.vault) },
    { id: 'editor', label: s.sections.editor, icon: <Code2 size={14} />, terms: searchable(s.editor) },
    { id: 'features', label: 'Feature Surface', icon: <Sparkles size={14} />, terms: 'features surface advanced lab experimental rail command palette visibility modules' },
    { id: 'workspace', label: 'Workspace', icon: <FolderOpen size={14} />, terms: 'workspace import export backup project local .adomnia' },
    { id: 'privacy', label: s.sections.privacy, icon: <Database size={14} />, terms: searchable(s.privacy) },
    { id: 'shortcuts', label: s.sections.shortcuts, icon: <Keyboard size={14} />, terms: searchable(s.shortcuts) },
    { id: 'about', label: s.sections.about, icon: <Info size={14} />, terms: searchable(s.about) },
    { id: 'developer', label: s.sections.developer, icon: <Bug size={14} />, terms: searchable(s.developer) },
    { id: 'ai', label: 'AI Engine', icon: <Sparkles size={14} />, terms: 'ai engine provider openai anthropic gemini ollama model api key' },
  ]

  const normalizedSearch = search.trim().toLowerCase()
  const sectionDefs = allSectionDefs.filter((sec) => {
    if (sec.id === 'developer' && devLoaded && !isDev) return false
    if (!normalizedSearch) return true
    return `${sec.label} ${sec.terms}`.toLowerCase().includes(normalizedSearch)
  })

  useEffect(() => {
    if (!normalizedSearch || sectionDefs.length === 0) return
    if (!sectionDefs.some((item) => item.id === section)) {
      setSection(sectionDefs[0].id)
    }
  }, [normalizedSearch, section, sectionDefs])

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
  const rawWindowChromeValue = settings.appearance.windowChrome ?? 'system'
  const windowChromeValue = isLinuxRuntime
    ? (rawWindowChromeValue === 'app' ? 'app-xwayland' : rawWindowChromeValue)
    : (rawWindowChromeValue === 'system' ? 'system' : 'app')
  const startupWindowChromeValue = isLinuxRuntime && startupWindowChrome === 'app'
    ? 'app-xwayland'
    : startupWindowChrome
  const windowChromeOptions = isLinuxRuntime
    ? [
        { value: 'app-xwayland', label: s.appearance.windowChromeOptions.appXWayland },
        { value: 'system', label: s.appearance.windowChromeOptions.system },
      ]
    : [
        { value: 'app', label: s.appearance.windowChromeOptions.app },
        { value: 'system', label: s.appearance.windowChromeOptions.system },
      ]

  return (
    <div className="flex h-full min-w-0 bg-surface-0">
      {/* Sidebar */}
      <aside className="flex w-60 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border-1 bg-surface-1/35 px-3 py-4 max-lg:w-52">
        {/* Search */}
        <div className="relative mb-3">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-4" />
          <input
            type="text"
            placeholder="Search settings..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-full rounded-md border border-border-2 bg-surface-2 pl-8 pr-2 text-xs text-text-1 outline-none placeholder:text-text-4 focus:border-accent"
          />
        </div>
        {sectionDefs.map((sec) => (
          <button
            key={sec.id}
            onClick={() => setSection(sec.id)}
            className={cn(
              'flex min-h-8 w-full items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors',
              section === sec.id
                ? 'border-border-2 bg-surface-2 text-text-1 shadow-sm'
                : 'border-transparent text-text-3 hover:bg-surface-2 hover:text-text-1'
            )}
          >
            <span className={cn('shrink-0', section === sec.id ? 'text-accent' : 'text-text-4')}>{sec.icon}</span>
            <span className="min-w-0 flex-1 truncate">{sec.label}</span>
            {settingsModified && section === sec.id && (
              <span className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
            )}
          </button>
        ))}
        {sectionDefs.length === 0 && (
          <p className="px-3 py-2 text-[10px] leading-relaxed text-text-4">No setting matches "{search.trim()}".</p>
        )}
      </aside>

      {/* Content */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className={cn(
          'w-full',
          section === 'workspace'
            ? 'h-full p-4'
            : 'mx-auto max-w-[1240px] px-8 pb-16 pt-6 max-lg:px-5 max-md:px-4'
        )}>
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
                  { value: 'broker', label: 'Broker Studio' },
                  { value: 'proxy', label: s.general.railOptions.proxy },
                  { value: 'mock', label: s.general.railOptions.mock },
                  { value: 'browser', label: 'Browser Debug' },
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
                onChange={(v) => {
                  if (!v) {
                    setConfirmDisableTabRestore(true)
                  } else {
                    updateGeneral({ restoreTabsOnStartup: true })
                  }
                }}
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
              {startupWindowChromeValue !== null && startupWindowChromeValue !== windowChromeValue && (
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
              <Toggle
                label={s.requests.autoValidateSchema}
                desc={s.requests.autoValidateSchemaDesc}
                checked={settings.requests.autoValidateSchema ?? true}
                onChange={(v) => updateRequests({ autoValidateSchema: v })}
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

        {/* Feature Surface */}
        {section === 'features' && (
          <>
            <SectionHeader
              title="Feature Surface"
              subtitle="Control how much of adOmnia is visible in the rail and command palette."
            />
            <SettingsCard>
              <Toggle
                label="Show advanced features"
                desc="Expose Browser Debug, Database Studio, Git Sync, Docker Lab, Mermaid, Storage Explorer and other secondary workspaces."
                checked={settings.features.showAdvancedFeatures}
                onChange={(v) => updateFeatures({ showAdvancedFeatures: v })}
              />
              <Toggle
                label="Show lab features"
                desc="Expose experimental or parked surfaces. Keep this off for a tighter production toolbox."
                checked={settings.features.showLabFeatures}
                onChange={(v) => updateFeatures({ showLabFeatures: v })}
              />
            </SettingsCard>
            <SettingsCard>
              <Toggle
                label="Plugins"
                desc="Show the plugin manager and plugin-related workspace controls."
                checked={settings.features.pluginsEnabled}
                onChange={(v) => updateFeatures({ pluginsEnabled: v })}
              />
              <Toggle
                label="Daily Scenarios"
                desc="Show the daily scenarios workbench inside API Core."
                checked={settings.features.dailyScenariosEnabled}
                onChange={(v) => updateFeatures({ dailyScenariosEnabled: v })}
              />
            </SettingsCard>
          </>
        )}

        {/* Workspace */}
        {section === 'workspace' && (
          <div className="h-full min-h-[560px] overflow-hidden rounded-md border border-border-1 bg-surface-1">
            <WorkspacePanel />
          </div>
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
                useTabsStore.getState().clearResponseHistory()
                setConfirmClearHistory(false)
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
                <span className="text-xs text-text-2 font-mono">{APP_VERSION}</span>
              </div>
              <div className="py-2 px-1 flex items-center justify-between">
                <span className="text-xs text-text-1">{s.about.buildDate}</span>
                <span className="text-xs text-text-2 font-mono">{formatBuildDate(BUILD_DATE)}</span>
              </div>
              <div className="py-2 px-1 flex items-center justify-between">
                <span className="text-xs text-text-1">{s.about.commitHash}</span>
                <span className="text-xs text-text-2 font-mono">{COMMIT_HASH}</span>
              </div>
              <div className="py-2 px-1 flex items-center justify-between">
                <span className="text-xs text-text-1">{s.about.stackInfo}</span>
                <span className="text-xs text-text-2">Wails · Go · React</span>
              </div>
              <div className="py-2 px-1 flex items-center justify-between">
                <span className="text-xs text-text-1">Developer</span>
                <span className="text-xs text-text-2">Andrea Cavallo</span>
              </div>
              <UpdateCheckRow />
            </SettingsCard>
            <SettingsCard>
              <div className="py-2 px-1">
                <a
                  href="https://www.andrea-cavallo.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-accent hover:underline"
                >
                  andrea-cavallo.com
                </a>
              </div>
              <div className="py-2 px-1">
                <a
                  href="https://github.com/Andrea-Cavallo/adOmnia"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-accent hover:underline"
                >
                  Andrea-Cavallo/adOmnia
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

        {/* AI Engine */}
        {section === 'ai' && (
          <AISettings />
        )}
        </div>
      </div>
      <ConfirmDialog
        open={confirmDisableTabRestore}
        title="Disable tab restoration?"
        message="Tabs will not be restored on next startup. Open tabs in this session are not affected."
        confirmLabel="Disable"
        variant="danger"
        onConfirm={() => {
          updateGeneral({ restoreTabsOnStartup: false })
          // Force-save with empty tabs immediately so the next startup starts clean
          useTabsStore.getState().save()
          setConfirmDisableTabRestore(false)
        }}
        onCancel={() => setConfirmDisableTabRestore(false)}
      />
    </div>
  )
}
