import { useState } from 'react'
import { Bug, ChevronDown, Hammer, LockKeyhole, MoreVertical, Play, Search, Square, X } from 'lucide-react'
import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu'
import type { GoIDEExecution, GoIDERunConfiguration, GoIDESession, GoIDEToolchainInfo } from '@/lib/goide-api'
import { GoGopherIcon } from './GoGopherIcon'

interface GoStudioToolbarProps {
  sessions: GoIDESession[]
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
  onSetAuthorization: (allowed: boolean) => void
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
}

type ToolbarMenu = 'project' | 'config' | 'more'

interface OpenMenu {
  kind: ToolbarMenu
  x: number
  y: number
}

const SESSION_PREFIX = 'session:'
const CONFIG_PREFIX = 'config:'
const MAX_INITIALS = 2

/** Iniziali del progetto per il badge, come il widget progetto di JetBrains: "go-lang" → "GL". */
export function projectInitials(name: string): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, MAX_INITIALS).toUpperCase()
  return words.slice(0, MAX_INITIALS).map((word) => word[0]).join('').toUpperCase()
}

function goVersion(toolchain: GoIDEToolchainInfo | null): string {
  if (!toolchain?.available) return 'Go not detected'
  return (toolchain.version ?? 'Go ready').replace(/^go version\s+/, '')
}

/** Toolbar unica di Go Studio: menu, progetto, branch, ricerca e gruppo Run su una sola riga. */
export function GoStudioToolbar(props: GoStudioToolbarProps) {
  const { sessions, activeSession, mainMenu, extra, trailing, activeExecution, toolchain, loading, runConfigurations, activeConfigId } = props
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const authorized = activeSession.project.authorization === 'tooling-permitted'
  const running = activeExecution?.status === 'running'
  const toolsReady = !!(authorized && toolchain?.available)
  const activeConfig = runConfigurations.find((config) => config.id === activeConfigId) ?? null

  const openMenu = (kind: ToolbarMenu, target: HTMLElement) => {
    if (menu?.kind === kind) return setMenu(null)
    const rect = target.getBoundingClientRect()
    setMenu({ kind, x: rect.left, y: rect.bottom + 4 })
  }

  const menuItems = (kind: ToolbarMenu): ContextMenuItem[] => {
    if (kind === 'project') return [
      ...sessions.map((session) => ({ id: `${SESSION_PREFIX}${session.id}`, label: `${session.id === activeSession.id ? '● ' : ''}${session.project.name}`, disabled: session.id === activeSession.id })),
      { id: 'open', label: 'Open Project…', shortcut: 'Ctrl+O', separatorBefore: true },
      { id: 'new', label: 'New Go Project…' },
      { id: 'close', label: `Close “${activeSession.project.name}”`, separatorBefore: true },
    ]
    if (kind === 'config') return [
      ...runConfigurations.map((config) => ({ id: `${CONFIG_PREFIX}${config.id}`, label: `${config.id === activeConfigId ? '● ' : ''}${config.name}` })),
      { id: `${CONFIG_PREFIX}`, label: 'Project root · go run . (no configuration)', separatorBefore: runConfigurations.length > 0 },
      { id: 'configure', label: 'Edit Configurations…', separatorBefore: true },
    ]
    return [
      { id: 'detect', label: `Detect Go Toolchain · ${goVersion(toolchain)}`, disabled: !authorized, disabledReason: 'Trust the project first' },
      { id: 'toolchain', label: 'Go Binary and Environment…', disabled: !authorized, disabledReason: 'Trust the project first' },
      { id: 'dependencies', label: 'Module Dependencies…' },
      { id: 'tidy', label: 'go mod tidy…', disabled: !toolsReady || running, disabledReason: running ? 'A process is running' : 'Go tools are not ready' },
    ]
  }

  const select = (id: string) => {
    setMenu(null)
    if (id.startsWith(SESSION_PREFIX)) return props.onSelect(id.slice(SESSION_PREFIX.length))
    if (id.startsWith(CONFIG_PREFIX)) return props.onSelectConfiguration(id.slice(CONFIG_PREFIX.length) || null)
    switch (id) {
      case 'open': return props.onOpenProject()
      case 'new': return props.onCreateProject()
      case 'close': return props.onClose()
      case 'configure': return props.onConfigure()
      case 'detect': return props.onDetectToolchain()
      case 'toolchain': return props.onToolchainSettings()
      case 'dependencies': return props.onDependencies()
      case 'tidy': return props.onTidy()
    }
  }

  return (
    <div role="toolbar" aria-label="Go Studio toolbar" className="flex h-11 shrink-0 items-center gap-1 border-b border-border-1 bg-surface-1 px-2">
      {mainMenu}
      <button type="button" aria-haspopup="menu" aria-expanded={menu?.kind === 'project'} disabled={loading} onClick={(event) => openMenu('project', event.currentTarget)} title={activeSession.project.rootPath} className={`go-studio-widget ml-1 max-w-60 ${menu?.kind === 'project' ? 'is-active' : ''}`}>
        <span aria-hidden="true" className="grid h-5 w-5 shrink-0 place-items-center rounded-[5px] bg-accent/20 text-[9.5px] font-bold text-accent">{projectInitials(activeSession.project.name)}</span>
        <span className="truncate text-[13px] font-semibold text-text-1">{activeSession.project.name}</span>
        <ChevronDown size={12} className="shrink-0 text-text-4" />
      </button>
      {extra}
      {!authorized && (
        <button type="button" onClick={() => props.onSetAuthorization(true)} disabled={loading} title="Local Go tools are blocked for this folder. Click to trust it; nothing starts automatically." className="go-studio-widget text-warning">
          <LockKeyhole size={13} /> Restricted
        </button>
      )}

      <div className="flex min-w-0 flex-1 justify-center px-3">
        <button type="button" onClick={props.onSearchEverywhere} title="Search Everywhere · Shift Shift" className="flex h-[30px] w-full max-w-[360px] items-center gap-2 rounded-[7px] border border-border-1 bg-surface-0 px-2.5 text-text-4 transition-colors hover:border-border-2 hover:text-text-2">
          <Search size={13} className="shrink-0" />
          <span className="flex-1 truncate text-left text-[12px]">Search files, symbols, actions</span>
          <kbd className="shrink-0 rounded border border-border-1 px-1.5 font-mono text-[10px] text-text-3">⇧⇧</kbd>
        </button>
      </div>

      <div className="go-studio-run-group" role="group" aria-label="Run">
        <button type="button" aria-haspopup="menu" aria-expanded={menu?.kind === 'config'} onClick={(event) => openMenu('config', event.currentTarget)} title="Active run configuration" className={`go-studio-widget h-6 max-w-48 px-2 ${menu?.kind === 'config' ? 'is-active' : ''}`}>
          <GoGopherIcon size={14} />
          <span className="truncate text-text-1">{activeConfig?.name ?? 'go run .'}</span>
          <ChevronDown size={11} className="shrink-0 text-text-4" />
        </button>
        <span className="mx-0.5 h-4 w-px bg-border-1" aria-hidden="true" />
        <button type="button" onClick={props.onRun} disabled={!toolsReady || loading} aria-label="Run" title="Run · Ctrl/Cmd+F5" className="go-studio-icon-button h-6 w-7 text-success"><Play size={14} fill="currentColor" /></button>
        <button type="button" onClick={props.onDebug} disabled={!toolsReady || loading} aria-label="Debug" title="Debug · Shift+F9" className="go-studio-icon-button h-6 w-7 text-info"><Bug size={14} /></button>
        <button type="button" onClick={props.onStop} disabled={!running} aria-label="Stop" title="Stop process tree · Shift+F5" className="go-studio-icon-button h-6 w-7 text-danger"><Square size={11} fill="currentColor" /></button>
      </div>
      <button type="button" onClick={props.onBuild} disabled={!toolsReady || loading} aria-label="Build" title="Build · Ctrl/Cmd+Shift+B" className="go-studio-icon-button h-8 w-8"><Hammer size={15} /></button>
      <button type="button" aria-label="More Go actions" aria-haspopup="menu" aria-expanded={menu?.kind === 'more'} onClick={(event) => openMenu('more', event.currentTarget)} title="Toolchain, dependencies, go mod tidy" className={`go-studio-icon-button h-8 w-8 ${menu?.kind === 'more' ? 'is-active' : ''}`}><MoreVertical size={15} /></button>
      {trailing && <><span className="mx-1 h-5 w-px bg-border-1" aria-hidden="true" />{trailing}</>}
      <button type="button" onClick={props.onClose} disabled={loading} aria-label="Close project" title="Close project session" className="go-studio-icon-button h-8 w-8"><X size={14} /></button>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.kind)} onSelect={select} onClose={() => setMenu(null)} />}
    </div>
  )
}
