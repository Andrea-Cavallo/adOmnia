import { templateFor } from '@/lib/code-studio/runFormSchema'
import { configurationTestTarget } from '@/lib/code-studio/runToolbarActions'
import { useEffect, useMemo, useState } from 'react'
import { useCodeStudioWindowsStore } from '@/stores/codeStudioWindows'
import { FolderGit2, GitBranch, FolderOpen, FolderPlus, FolderX, History, PackageCheck, PackageSearch, RefreshCw, Settings2, Terminal } from 'lucide-react'
import { AlertCircle, Bug, Check, ChevronDown, Hammer, Loader2, Maximize2, PanelLeft, PanelBottom, PanelRight, Play, Plus, Search, Square } from 'lucide-react'
import { Container, Database, LayoutGrid, LayoutList, Send, Server, ServerCog } from 'lucide-react'
import type { RailItem } from '@/lib/navigation'
import { openRailItemInWindow, usePanelWindowsStore } from '@/stores/panelWindows'
import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu'
import type { GoIDEExecution, GoIDERunConfiguration, GoIDESession, GoIDEToolchainInfo, GoIDERecentProject } from '@/lib/code-studio-api'
import { CodeStudioFolderIcon } from './CodeStudioFolderIcon'
import { projectProfile } from '@/lib/code-studio/projectProfile'
import { ideLanguage, IDE_LANGUAGE_NAMES } from '@/components/ide/languages'
import { LanguageBrandIcon } from '@/components/ide/LanguageBrandIcon'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { groupConfigurationsByUnit, unitOfConfiguration } from '@/lib/code-studio/runUnits'
import { useDetectedRunItems } from './useDetectedRunItems'
import { useCodeStudioTitlebar, CodeStudioWindowControls } from './CodeStudioTitlebar'

interface CodeStudioToolbarProps {
  sessions: GoIDESession[]
  /** Progetti recenti non aperti: il menu del progetto permette di riaprirli. */
  recentProjects?: GoIDERecentProject[]
  onOpenRecent?: (path: string) => void
  activeSession: GoIDESession
  /** Menu principale ☰ (vedi CodeStudioMenuBar). */
  mainMenu: React.ReactNode
  /** Controlli aggiuntivi mostrati accanto al progetto (es. branch Git). */
  extra?: React.ReactNode
  /** Selettore del workspace Code Studio, a destra. */
  trailing?: React.ReactNode
  activeExecution: GoIDEExecution | null
  toolchain: GoIDEToolchainInfo | null
  loading: boolean
  runConfigurations: GoIDERunConfiguration[]
  activeConfigId: string | null
  onSelectConfiguration: (configId: string | null) => void
  onSelect: (sessionId: string) => void
  onOpenProject: () => void
  onCreateProject: () => void
  onClone: () => void
  onDetectToolchain: () => void
  onToolchainSettings: () => void
  onDependencies: () => void
  onConfigure: () => void
  onSearchEverywhere: () => void
  onBuild: () => void
  onRun: () => void
  onDebug: () => void
  onTest: () => void
  onTidy: () => void
  onStop: () => void
  onClose: () => void
  /** Solo nella finestra principale: Code Studio a tutta finestra senza rail né intestazione di adOmnia. */
  maximized?: boolean
  onToggleMaximize?: () => void
}

type ToolbarMenu = 'project' | 'config' | 'more' | 'studios'

/** The adOmnia modules you use next to the code: each opens in its own window, beside the IDE. */
const STUDIOS: ReadonlyArray<{ rail: RailItem; label: string; icon: typeof Send }> = [
  { rail: 'collections', label: 'API Workspace', icon: LayoutList },
  { rail: 'database', label: 'Database Studio', icon: Database },
  { rail: 'broker', label: 'Broker Studio', icon: Server },
  { rail: 'mock', label: 'Mock Server', icon: ServerCog },
  { rail: 'grpc', label: 'gRPC Client', icon: Send },
  { rail: 'dockerlab', label: 'Docker Lab', icon: Container },
]
const STUDIO_PREFIX = 'studio:'

interface OpenMenu {
  kind: ToolbarMenu
  x: number
  y: number
}

const SESSION_PREFIX = 'session:'
const RECENT_PREFIX = 'recent:'
const MAX_RECENT_IN_MENU = 8
const CONFIG_PREFIX = 'config:'
const DETECTED_PREFIX = 'detected:'

function goVersion(toolchain: GoIDEToolchainInfo | null): string {
  if (!toolchain?.available) return 'Go not detected'
  return (toolchain.version ?? 'Go ready').replace(/^go version\s+/, '')
}

/** Toolbar unica di Code Studio: menu, progetto, branch, ricerca e gruppo Run su una sola riga. */
export function CodeStudioToolbar(props: CodeStudioToolbarProps) {
  const { sessions, activeSession, mainMenu, extra, trailing, activeExecution, toolchain, loading, runConfigurations, activeConfigId } = props
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const detected = useDetectedRunItems(activeSession.id, (menu?.kind === 'config' || menu?.kind === 'more') && runConfigurations.length === 0)
  const detachedStudios = usePanelWindowsStore((state) => state.detached)
  const startPanelWindows = usePanelWindowsStore((state) => state.start)
  useEffect(() => { startPanelWindows() }, [startPanelWindows])
  const authorized = activeSession.project.authorization === 'tooling-permitted'
  const running = activeExecution?.status === 'running'
  const failed = activeExecution?.status === 'failed'
  const profile = useMemo(() => projectProfile(activeSession.project, IDE_LANGUAGE_NAMES), [activeSession.project])
  // Il toolchain Go serve solo ai progetti con unità Go: un'app Node si avvia con Node, non con `go`.
  const activeConfig = runConfigurations.find((config) => config.id === activeConfigId) ?? null
  const requiresGoTools = activeConfig ? templateFor(activeConfig).language === 'go' : profile.hasGo
  const toolsReady = !!(authorized && (!requiresGoTools || toolchain?.available))
  const capabilities = useCodeStudioStore(state => state.capabilities)
  const language = activeConfig?.language || (activeConfig ? unitOfConfiguration(activeConfig, activeSession.project)?.language : null) || activeSession.project.units?.[0]?.language
  const provider = capabilities?.languages?.find(item => item.id === language)
  const debugReason = !toolsReady ? 'Trust the project and configure its toolchain first' : !provider?.capabilities.debug ? 'This provider does not offer debugging' : activeConfig && !ideLanguage(language ?? '')?.canDebugRun?.(activeConfig) ? 'Debug is not available for this configuration type' : ''
  const testReason = !authorized ? 'Trust the project first' : !configurationTestTarget(activeSession.project, activeConfig) ? 'No structured test target for this configuration' : ''

  const openMenu = (kind: ToolbarMenu, target: HTMLElement) => {
    if (menu?.kind === kind) return setMenu(null)
    const rect = target.getBoundingClientRect()
    setMenu({ kind, x: rect.left, y: rect.bottom + 4 })
  }

  // Sempre visibile: vuota resta una voce disabilitata, non sparisce.
  const recentItems = (): ContextMenuItem[] => {
    const recent = (props.recentProjects ?? []).slice(0, MAX_RECENT_IN_MENU)
    if (recent.length === 0) return [{ id: 'recent-empty', label: 'Recent Projects', icon: History, disabled: true, disabledReason: 'No other recent projects yet', separatorBefore: true }]
    return recent.map((project, index) => ({
      id: `${RECENT_PREFIX}${project.rootPath}`,
      label: `${project.name} · ${project.rootPath}`,
      icon: History,
      disabled: !project.available,
      disabledReason: 'Folder no longer available',
      separatorBefore: index === 0,
    }))
  }

  const menuItems = (kind: ToolbarMenu): ContextMenuItem[] => {
    if (kind === 'project') return [
      ...sessions.map((session) => ({ id: `${SESSION_PREFIX}${session.id}`, label: session.project.name, icon: FolderGit2, checked: session.id === activeSession.id || undefined, disabled: session.id === activeSession.id })),
      ...recentItems(),
      { id: 'open', label: 'Open Project…', shortcut: 'Ctrl+O', icon: FolderOpen, separatorBefore: true },
      { id: 'new', label: 'New Project…', icon: FolderPlus },
      { id: 'project-window', label: 'Open Project in New Window', icon: Maximize2 },
      { id: 'clone', label: 'Clone Repository…', icon: GitBranch },
      { id: 'close', label: `Close “${activeSession.project.name}”`, icon: FolderX, separatorBefore: true },
    ]
    if (kind === 'studios') return STUDIOS.map((studio) => ({
      id: `${STUDIO_PREFIX}${studio.rail}`,
      label: detachedStudios.includes(studio.rail) ? `${studio.label} · show window` : studio.label,
      icon: studio.icon,
      iconClassName: detachedStudios.includes(studio.rail) ? 'text-accent' : undefined,
      checked: detachedStudios.includes(studio.rail) || undefined,
    }))
    if (kind === 'config') return [
      // Monorepo: le configurazioni sono raggruppate per unità ("orders · Go") e l'unità è scritta a destra della voce.
      ...groupConfigurationsByUnit(runConfigurations, activeSession.project, IDE_LANGUAGE_NAMES).flatMap((group, groupIndex) => group.items.map((config, index) => ({
        id: `${CONFIG_PREFIX}${config.id}`, label: config.name, icon: Play, iconClassName: 'text-success',
        iconElement: group.language ? <LanguageBrandIcon id={group.language} /> : undefined,
        checked: config.id === activeConfigId || undefined,
        shortcut: group.label || undefined, separatorBefore: index === 0 && groupIndex > 0 && group.label !== '' || undefined,
      }))),
      ...(profile.hasGo ? [{ id: `${CONFIG_PREFIX}`, label: 'Project root · go run . (no configuration)', icon: Terminal, checked: !activeConfigId || undefined, separatorBefore: runConfigurations.length > 0 }] : []),
      ...detected.suggestions.map((item, index) => ({ id: `${DETECTED_PREFIX}${item.id}`, label: `Add ${item.title}`, icon: Plus, iconClassName: 'text-accent', separatorBefore: index === 0 })),
      { id: 'configure', label: 'Edit Configurations…', icon: Settings2, separatorBefore: true },
    ]
    return [
      { id: 'active-configuration', label: `Configuration: ${activeConfig?.name ?? (profile.hasGo ? 'go run .' : 'Choose…')}`, icon: Terminal, submenu: menuItems('config') },
      { id: 'debug', label: 'Debug', icon: Bug, disabled: !!debugReason || loading, disabledReason: debugReason || 'An operation is in progress', separatorBefore: true },
      { id: 'build', label: 'Build', icon: Hammer, disabled: !toolsReady || loading, disabledReason: !authorized ? 'Trust the project first' : loading ? 'An operation is in progress' : 'Configure the toolchain first' },
      { id: 'test', label: 'Test project unit', icon: Check, disabled: !!testReason || loading, disabledReason: testReason || 'An operation is in progress' },
      { id: 'studios', label: 'Open studio in a window', icon: LayoutGrid, submenu: menuItems('studios'), separatorBefore: true },
      ...(profile.hasGo ? [{ id: 'go-tools', label: 'Go tools', icon: Settings2, submenu: [
        { id: 'detect', label: `Detect Go Toolchain · ${goVersion(toolchain)}`, icon: RefreshCw, disabled: !authorized, disabledReason: 'Trust the project first' },
        { id: 'toolchain', label: 'Go Binary and Environment…', icon: Settings2, disabled: !authorized, disabledReason: 'Trust the project first' },
        { id: 'dependencies', label: 'Module Dependencies…', icon: PackageSearch },
        { id: 'tidy', label: 'go mod tidy…', icon: PackageCheck, disabled: !toolsReady || running, disabledReason: running ? 'A process is running' : 'Go tools are not ready' },
      ] }] : []),
      { id: 'close', label: 'Close Project', icon: FolderX, separatorBefore: true, disabled: loading, disabledReason: 'An operation is in progress' },
    ]
  }

  const select = (id: string) => {
    setMenu(null)
    if (id.startsWith(SESSION_PREFIX)) return props.onSelect(id.slice(SESSION_PREFIX.length))
    if (id.startsWith(RECENT_PREFIX)) return props.onOpenRecent?.(id.slice(RECENT_PREFIX.length))
    if (id.startsWith(STUDIO_PREFIX)) {
      const studio = STUDIOS.find((item) => `${STUDIO_PREFIX}${item.rail}` === id)
      return studio ? openRailItemInWindow(studio.rail, studio.label) : undefined
    }
    if (id.startsWith(DETECTED_PREFIX)) return void detected.add(id.slice(DETECTED_PREFIX.length))
    if (id.startsWith(CONFIG_PREFIX)) return props.onSelectConfiguration(id.slice(CONFIG_PREFIX.length) || null)
    switch (id) {
      case 'build': return props.onBuild()
      case 'debug': return props.onDebug()
      case 'test': return props.onTest()
      case 'open': return props.onOpenProject()
      case 'new': return props.onCreateProject()
      case 'project-window': return void useCodeStudioWindowsStore.getState().moveToNewWindow(activeSession.id)
      case 'clone': return props.onClone()
      case 'close': return props.onClose()
      case 'configure': return props.onConfigure()
      case 'detect': return props.onDetectToolchain()
      case 'toolchain': return props.onToolchainSettings()
      case 'dependencies': return props.onDependencies()
      case 'tidy': return props.onTidy()
    }
  }

  const titlebar = useCodeStudioTitlebar()
  return (
    <div role="toolbar" aria-label="Code Studio toolbar" {...titlebar.props} className={`code-studio-toolbar flex h-11 shrink-0 items-center gap-1.5 pl-2 ${titlebar.active ? 'code-studio-titlebar' : 'pr-2'}`}>
      <div className="code-studio-header-start">
      {mainMenu}
      {([{ key: 'projectOpen', label: 'Toggle project pane', icon: PanelLeft }, { key: 'bottomOpen', label: 'Toggle bottom pane', icon: PanelBottom }, { key: 'structureOpen', label: 'Toggle structure pane', icon: PanelRight }] as const).map(({ key, label, icon: Icon }) => (
        <button key={key} type="button" aria-label={label} title={label} className="code-studio-icon-button h-8 w-8" onClick={() => { const state = useCodeStudioStore.getState(); state.updateLayout({ [key]: !state.layout[key] }) }}><Icon size={16} /></button>
      ))}
      </div>
      <div className="code-studio-header-center">
      <span className="mx-1 h-5 w-px shrink-0 bg-border-1" aria-hidden="true" />
      <button type="button" aria-haspopup="menu" aria-expanded={menu?.kind === 'project'} disabled={loading} onClick={(event) => openMenu('project', event.currentTarget)} title={activeSession.project.rootPath} className={`code-studio-widget max-w-60 pl-1.5 ${menu?.kind === 'project' ? 'is-active' : ''}`}>
        <span aria-hidden="true" className="code-studio-project-tile"><CodeStudioFolderIcon open size={16} /></span>
        <span className="truncate text-[13.5px] font-semibold tracking-[-0.01em] text-text-1">{activeSession.project.name}</span>
        <ChevronDown size={12} className="shrink-0 text-text-4" />
      </button>
      {extra}
      </div>
      <div className="code-studio-header-end">
      <div className="code-studio-header-search">
        <button type="button" aria-label="Search Everywhere" onClick={props.onSearchEverywhere} title="Search Everywhere · Ctrl/Cmd+K" className="code-studio-search-control">
          <Search size={15} className="shrink-0" />
          <span className="flex-1 truncate text-left text-[13px]">Search files, symbols, actions…</span>
          <span className="flex shrink-0 items-center gap-1"><kbd className="code-studio-key">Ctrl</kbd><kbd className="code-studio-key">K</kbd></span>
        </button>
      </div>

      <div className={`code-studio-run-group ${running ? 'is-running' : loading ? 'is-starting' : failed ? 'is-failed' : ''}`} role="group" aria-label="Run">
        <span className="mx-0.5 h-4 w-px bg-border-1" aria-hidden="true" />
        <button type="button" onClick={props.onRun} disabled={!toolsReady || loading || running || (!!activeConfig && templateFor(activeConfig).run === false)} aria-label="Run" title={(!!activeConfig && templateFor(activeConfig).run === false) ? 'Attach configurations use Debug' : `Run ${activeConfig?.name ?? 'project'} · Ctrl/Cmd+F5`} className="code-studio-icon-button code-studio-run-action h-[28px] px-2">
          {running || loading ? <Loader2 size={15} className="animate-spin" /> : failed ? <AlertCircle size={15} /> : <Play size={15} fill="currentColor" />}
          <span className="code-studio-run-label">{running ? 'Running' : loading ? 'Starting' : failed ? 'Retry' : 'Run'}</span>
        </button>
        <span role="status" aria-live="polite" className="sr-only">{activeExecution ? `${activeExecution.kind}: ${activeExecution.status}` : 'Ready to run'}</span>
        {running && <button type="button" onClick={props.onStop} aria-label="Stop" title="Stop process tree · Shift+F5" className="code-studio-icon-button h-[28px] w-[32px] bg-danger/15 text-danger"><Square size={12} fill="currentColor" /></button>}
      </div>
      <span className="mx-1 h-5 w-px shrink-0 bg-border-1" aria-hidden="true" />
      <button type="button" aria-label="More actions" aria-haspopup="menu" aria-expanded={menu?.kind === 'more'} onClick={(event) => openMenu('more', event.currentTarget)} title={`Run configuration: ${activeConfig?.name ?? (profile.hasGo ? 'go run .' : 'Choose a configuration')} · Build, debug and tools`} className={`code-studio-icon-button h-8 w-8 ${menu?.kind === 'more' ? 'is-active' : ''}`}><Settings2 size={16} /></button>
      <span className="mx-1 h-5 w-px shrink-0 bg-border-1" aria-hidden="true" />
      {trailing && <div className="code-studio-workspace-picker">{trailing}</div>}
      {/* Nella barra della finestra la X è quella della finestra: Close Project resta nel menu File. */}
      <CodeStudioWindowControls />
      </div>
      {menu && <ContextMenu appearance="studio" x={menu.x} y={menu.y} items={menuItems(menu.kind)} onSelect={select} onClose={() => setMenu(null)} />}
    </div>
  )
}
