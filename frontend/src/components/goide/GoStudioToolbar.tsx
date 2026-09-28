import { FolderOpen, Hammer, LockKeyhole, PackageSearch, Play, Plus, RefreshCw, Settings2, ShieldCheck, Square, Wrench, X } from 'lucide-react'
import type { GoIDEExecution, GoIDESession, GoIDEToolchainInfo } from '@/lib/goide-api'

interface GoStudioToolbarProps {
  sessions: GoIDESession[]
  activeSession: GoIDESession
  activeExecution: GoIDEExecution | null
  toolchain: GoIDEToolchainInfo | null
  loading: boolean
  onSelect: (sessionId: string) => void
  onOpenProject: () => void
  onCreateProject: () => void
  onSetAuthorization: (allowed: boolean) => void
  onDetectToolchain: () => void
  onToolchainSettings: () => void
  onDependencies: () => void
  onConfigure: () => void
  onBuild: () => void
  onRun: () => void
  onTidy: () => void
  onStop: () => void
  onClose: () => void
}

export function GoStudioToolbar({ sessions, activeSession, activeExecution, toolchain, loading, onSelect, onOpenProject, onCreateProject, onSetAuthorization, onDetectToolchain, onToolchainSettings, onDependencies, onConfigure, onBuild, onRun, onTidy, onStop, onClose }: GoStudioToolbarProps) {
  const authorized = activeSession.project.authorization === 'tooling-permitted'
  const running = activeExecution?.status === 'running'
  const toolsReady = authorized && toolchain?.available
  return (
    <div role="toolbar" aria-label="Go Studio toolbar" className="flex h-9 shrink-0 items-center gap-1 border-b border-border-1 bg-surface-1 px-2">
      <select aria-label="Active Go project" value={activeSession.id} onChange={(event) => onSelect(event.target.value)} className="h-7 min-w-40 max-w-56 rounded border border-border-1 bg-surface-2 px-2 text-xs text-text-1 outline-none focus:border-accent">
        {sessions.map((session) => <option key={session.id} value={session.id}>{session.project.name}</option>)}
      </select>
      <button type="button" onClick={onOpenProject} disabled={loading} title="Open project · Ctrl/Cmd+O" className="grid h-7 w-7 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1 disabled:opacity-40"><FolderOpen size={13} /></button>
      <button type="button" onClick={onCreateProject} disabled={loading} title="Create Go project" className="grid h-7 w-7 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1 disabled:opacity-40"><Plus size={13} /></button>
      <div className="mx-1 h-4 w-px bg-border-1" />
      <button type="button" onClick={() => onSetAuthorization(!authorized)} disabled={loading} aria-pressed={authorized} title={authorized ? 'Revoke local tool permission' : 'Permit local Go tools; nothing starts automatically'} className="flex h-7 items-center gap-1.5 rounded border border-border-1 px-2 text-[10px] text-text-2 hover:border-accent/50 hover:text-text-1 disabled:opacity-40">
        {authorized ? <ShieldCheck size={12} className="text-success" /> : <LockKeyhole size={12} />}{authorized ? 'Trusted' : 'Restricted'}
      </button>
      <button type="button" onClick={onDetectToolchain} disabled={!authorized || loading} title="Detect Go toolchain" className="flex h-7 items-center gap-1.5 rounded px-2 text-[10px] text-text-3 hover:bg-surface-3 hover:text-text-1 disabled:opacity-35"><RefreshCw size={11} /> {toolchain?.available ? (toolchain.version ?? 'Go ready').replace(/^go version\s+/, '') : 'Detect Go'}</button>
      <button type="button" onClick={onToolchainSettings} disabled={!authorized} title="Go binary and session environment" className="grid h-7 w-7 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1 disabled:opacity-35"><Wrench size={12} /></button>
      <button type="button" onClick={onDependencies} title="Go module dependencies" className="grid h-7 w-7 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1"><PackageSearch size={12} /></button>
      <button type="button" onClick={onConfigure} title="Run configuration" className="grid h-7 w-7 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1"><Settings2 size={12} /></button>
      <div className="mx-1 h-4 w-px bg-border-1" />
      <button type="button" onClick={onBuild} disabled={!toolsReady || loading} title="Build · Ctrl/Cmd+Shift+B" className="flex h-7 items-center gap-1.5 rounded px-2 text-[10px] font-medium text-text-2 hover:bg-surface-3 hover:text-text-1 disabled:opacity-35"><Hammer size={12} /> Build</button>
      <button type="button" onClick={onRun} disabled={!toolsReady || loading} title="Run · Ctrl/Cmd+F5" className="flex h-7 items-center gap-1.5 rounded border border-success/30 bg-success/5 px-2 text-[10px] font-medium text-success hover:bg-success/10 disabled:opacity-35"><Play size={11} fill="currentColor" /> Run</button>
      <button type="button" onClick={onStop} disabled={!running} title="Stop process tree · Shift+F5" className="grid h-7 w-7 place-items-center rounded border border-danger/25 text-danger hover:bg-danger/10 disabled:opacity-30"><Square size={10} fill="currentColor" /></button>
      <button type="button" onClick={onTidy} disabled={!toolsReady || running} title="Preview and run go mod tidy" className="h-7 rounded px-2 text-[10px] text-text-3 hover:bg-surface-3 hover:text-text-1 disabled:opacity-30">Tidy</button>
      <span className="min-w-0 flex-1 truncate px-2 text-right font-mono text-[9px] text-text-4">{activeExecution ? `${activeExecution.kind} · ${activeExecution.status}` : activeSession.project.rootPath}</span>
      <button type="button" onClick={onClose} disabled={loading} title="Close project session" className="grid h-7 w-7 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1 disabled:opacity-40"><X size={13} /></button>
    </div>
  )
}
