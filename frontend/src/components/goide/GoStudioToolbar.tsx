import { useEffect, useState } from 'react'
import { FolderGit2, GitBranch, FolderOpen, FolderPlus, FolderX, History, PackageCheck, PackageSearch, RefreshCw, Settings2, Terminal } from 'lucide-react'
import { Bug, ChevronDown, Hammer, Maximize2, Minimize2, MoreVertical, Play, Search, Square, X } from 'lucide-react'
import { Container, Database, LayoutGrid, LayoutList, Send, Server, ServerCog } from 'lucide-react'
import type { RailItem } from '@/lib/navigation'
import { openRailItemInWindow, usePanelWindowsStore } from '@/stores/panelWindows'
import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu'
import type { GoIDEExecution, GoIDERunConfiguration, GoIDESession, GoIDEToolchainInfo, GoIDERecentProject } from '@/lib/goide-api'
import { GoStudioFolderIcon } from './GoStudioFolderIcon'
import { GoGopherIcon } from './GoGopherIcon'
import { useGoStudioTitlebar, GoStudioWindowControls } from './GoStudioTitlebar'

interface GoStudioToolbarProps {
  sessions: GoIDESession[]
  /** Progetti recenti non aperti: il menu del progetto permette di riaprirli. */
  recentProjects?: GoIDERecentProject[]
  onOpenRecent?: (path: string) => void
  activeSession: GoIDESession
  /** Menu principale ☰ (vedi GoStudioMenuBar). */
  mainMenu: React.ReactNode
  /** Controlli aggiuntivi mostrati accanto al progetto (es. branch Git). */
  extra?: React.ReactNode
  /** Selettore del workspace Go Studio, a destra. */
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
  onTidy: () => void
  onStop: () => void
  onClose: () => void
  /** Solo nella finestra principale: Go Studio a tutta finestra senza rail né intestazione di adOmnia. */
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

function goVersion(toolchain: GoIDEToolchainInfo | null): string {
  if (!toolchain?.available) return 'Go not detected'
  return (toolchain.version ?? 'Go ready').replace(/^go version\s+/, '')
}

/** Toolbar unica di Go Studio: menu, progetto, branch, ricerca e gruppo Run su una sola riga. */
export function GoStudioToolbar(props: GoStudioToolbarProps) {
  const { sessions, activeSession, mainMenu, extra, trailing, activeExecution, toolchain, loading, runConfigurations, activeConfigId } = props
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const detachedStudios = usePanelWindowsStore((state) => state.detached)
  const startPanelWindows = usePanelWindowsStore((state) => state.start)
  useEffect(() => { startPanelWindows() }, [startPanelWindows])
  const authorized = activeSession.project.authorization === 'tooling-permitted'
  const running = activeExecution?.status === 'running'
  const toolsReady = !!(authorized && toolchain?.available)
  const activeConfig = runConfigurations.find((config) => config.id === activeConfigId) ?? null

  const openMenu = (kind: ToolbarMenu, target: HTMLElement) => {
    if (menu?.kind === kind) return setMenu(null)
    const rect = target.getBoundingClientRect()
    setMenu({ kind, x: rect.left, y: rect.bottom + 4 })
  }

  // Sempre visibile, come nel widget progetto di JetBrains: vuota resta una voce disabilitata, non sparisce.
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
      { id: 'new', label: 'New Go Project…', icon: FolderPlus },
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
      ...runConfigurations.map((config) => ({ id: `${CONFIG_PREFIX}${config.id}`, label: config.name, icon: Play, iconClassName: 'text-success', checked: config.id === activeConfigId || undefined })),
      { id: `${CONFIG_PREFIX}`, label: 'Project root · go run . (no configuration)', icon: Terminal, checked: !activeConfigId || undefined, separatorBefore: runConfigurations.length > 0 },
      { id: 'configure', label: 'Edit Configurations…', icon: Settings2, separatorBefore: true },
    ]
    return [
      { id: 'detect', label: `Detect Go Toolchain · ${goVersion(toolchain)}`, icon: RefreshCw, disabled: !authorized, disabledReason: 'Trust the project first' },
      { id: 'toolchain', label: 'Go Binary and Environment…', icon: Settings2, disabled: !authorized, disabledReason: 'Trust the project first' },
      { id: 'dependencies', label: 'Module Dependencies…', icon: PackageSearch },
      { id: 'tidy', label: 'go mod tidy…', icon: PackageCheck, disabled: !toolsReady || running, disabledReason: running ? 'A process is running' : 'Go tools are not ready' },
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
    if (id.startsWith(CONFIG_PREFIX)) return props.onSelectConfiguration(id.slice(CONFIG_PREFIX.length) || null)
    switch (id) {
      case 'open': return props.onOpenProject()
      case 'new': return props.onCreateProject()
      case 'clone': return props.onClone()
      case 'close': return props.onClose()
      case 'configure': return props.onConfigure()
      case 'detect': return props.onDetectToolchain()
      case 'toolchain': return props.onToolchainSettings()
      case 'dependencies': return props.onDependencies()
      case 'tidy': return props.onTidy()
    }
  }

  const titlebar = useGoStudioTitlebar()
  return (
    <div role="toolbar" aria-label="Go Studio toolbar" {...titlebar.props} className={`flex h-12 shrink-0 items-center gap-1 pl-2 ${titlebar.active ? 'go-studio-titlebar' : 'pr-2'}`}>
      {mainMenu}
      <span className="mx-1 h-5 w-px shrink-0 bg-border-1" aria-hidden="true" />
      <button type="button" aria-haspopup="menu" aria-expanded={menu?.kind === 'project'} disabled={loading} onClick={(event) => openMenu('project', event.currentTarget)} title={activeSession.project.rootPath} className={`go-studio-widget max-w-60 pl-1.5 ${menu?.kind === 'project' ? 'is-active' : ''}`}>
        <span aria-hidden="true" className="go-studio-project-tile"><GoStudioFolderIcon open size={16} /></span>
        <span className="truncate text-[13.5px] font-semibold tracking-[-0.01em] text-text-1">{activeSession.project.name}</span>
        <ChevronDown size={12} className="shrink-0 text-text-4" />
      </button>
      {extra}

      <div className="flex min-w-0 flex-1 justify-center px-3">
        <button type="button" onClick={props.onSearchEverywhere} title="Search Everywhere · Shift Shift" className="flex h-8 w-full max-w-[400px] items-center gap-2.5 rounded-[10px] border border-border-1 bg-[var(--gs-island)] px-3 text-text-4 transition-colors hover:border-border-2 hover:text-text-2">
          <Search size={13} className="shrink-0" />
          <span className="flex-1 truncate text-left text-[12px]">Search files, symbols, actions</span>
          <kbd className="shrink-0 rounded-[5px] bg-[var(--gs-raised)] px-1.5 font-mono text-[10px] text-text-3">⇧⇧</kbd>
        </button>
      </div>

      <div className="go-studio-run-group" role="group" aria-label="Run">
        <button type="button" aria-haspopup="menu" aria-expanded={menu?.kind === 'config'} onClick={(event) => openMenu('config', event.currentTarget)} title="Active run configuration" className={`go-studio-widget h-6 max-w-48 px-2 ${menu?.kind === 'config' ? 'is-active' : ''}`}>
          <GoGopherIcon size={14} />
          <span className="truncate text-text-1">{activeConfig?.name ?? 'go run .'}</span>
          <ChevronDown size={11} className="shrink-0 text-text-4" />
        </button>
        <span className="mx-0.5 h-4 w-px bg-border-1" aria-hidden="true" />
        <button type="button" onClick={props.onRun} disabled={!toolsReady || loading} aria-label="Run" title="Run · Ctrl/Cmd+F5" className="go-studio-icon-button h-[26px] w-[30px] bg-success/15 text-success"><Play size={14} fill="currentColor" /></button>
        <button type="button" onClick={props.onDebug} disabled={!toolsReady || loading} aria-label="Debug" title="Debug · Shift+F9" className="go-studio-icon-button h-[26px] w-[30px] text-info"><Bug size={14} /></button>
        <button type="button" onClick={props.onStop} disabled={!running} aria-label="Stop" title="Stop process tree · Shift+F5" className="go-studio-icon-button h-[26px] w-[30px] text-danger"><Square size={11} fill="currentColor" /></button>
      </div>
      <button type="button" onClick={props.onBuild} disabled={!toolsReady || loading} aria-label="Build" title="Build · Ctrl/Cmd+Shift+B" className="go-studio-icon-button h-8 w-8"><Hammer size={15} /></button>
      <button type="button" aria-label="More Go actions" aria-haspopup="menu" aria-expanded={menu?.kind === 'more'} onClick={(event) => openMenu('more', event.currentTarget)} title="Toolchain, dependencies, go mod tidy" className={`go-studio-icon-button h-8 w-8 ${menu?.kind === 'more' ? 'is-active' : ''}`}><MoreVertical size={15} /></button>
      <button type="button" aria-label="Open an adOmnia studio in its own window" aria-haspopup="menu" aria-expanded={menu?.kind === 'studios'} onClick={(event) => openMenu('studios', event.currentTarget)} title="Studios: API, Database, Broker, Mock… each in its own window beside the code" className={`go-studio-icon-button relative h-8 w-8 ${menu?.kind === 'studios' ? 'is-active' : ''}`}>
        <LayoutGrid size={15} />
        {detachedStudios.length > 0 && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />}
      </button>
      {trailing && <><span className="mx-1 h-5 w-px bg-border-1" aria-hidden="true" />{trailing}</>}
      {props.onToggleMaximize && (
        <button type="button" onClick={props.onToggleMaximize} aria-label={props.maximized ? 'Restore adOmnia layout' : 'Maximize Go Studio'} aria-pressed={!!props.maximized} title={`${props.maximized ? 'Restore adOmnia rail and header' : 'Maximize Go Studio: hide adOmnia rail and header'} · Ctrl/Cmd+Shift+F11`} className={`go-studio-icon-button h-8 w-8 ${props.maximized ? 'is-active' : ''}`}>
          {props.maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      )}
      {/* Nella barra della finestra la X è quella della finestra: Close Project resta nel menu File. */}
      {!titlebar.active && <button type="button" onClick={props.onClose} disabled={loading} aria-label="Close project" title="Close project session" className="go-studio-icon-button h-8 w-8"><X size={14} /></button>}
      <GoStudioWindowControls />
      {menu && <ContextMenu appearance="studio" x={menu.x} y={menu.y} items={menuItems(menu.kind)} onSelect={select} onClose={() => setMenu(null)} />}
    </div>
  )
}
