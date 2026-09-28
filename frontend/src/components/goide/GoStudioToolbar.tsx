import { FolderOpen, LockKeyhole, ShieldCheck, X } from 'lucide-react'
import type { GoIDESession } from '@/lib/goide-api'

interface GoStudioToolbarProps {
  sessions: GoIDESession[]
  activeSession: GoIDESession
  loading: boolean
  onSelect: (sessionId: string) => void
  onOpenProject: () => void
  onSetAuthorization: (allowed: boolean) => void
  onClose: () => void
}

export function GoStudioToolbar({ sessions, activeSession, loading, onSelect, onOpenProject, onSetAuthorization, onClose }: GoStudioToolbarProps) {
  const authorized = activeSession.project.authorization === 'tooling-permitted'
  return (
    <div role="toolbar" aria-label="Go Studio toolbar" className="flex h-9 shrink-0 items-center gap-2 border-b border-border-1 bg-surface-1 px-2">
      <select
        aria-label="Active Go project"
        value={activeSession.id}
        onChange={(event) => onSelect(event.target.value)}
        className="h-7 min-w-44 max-w-64 rounded border border-border-1 bg-surface-2 px-2 text-xs text-text-1 outline-none focus:border-accent"
      >
        {sessions.map((session) => <option key={session.id} value={session.id}>{session.project.name}</option>)}
      </select>
      <button type="button" onClick={onOpenProject} disabled={loading} className="flex h-7 items-center gap-1.5 rounded px-2 text-xs text-text-2 hover:bg-surface-3 hover:text-text-1 disabled:opacity-40">
        <FolderOpen size={13} /> Open
      </button>
      <div className="h-4 w-px bg-border-1" />
      <button
        type="button"
        onClick={() => onSetAuthorization(!authorized)}
        disabled={loading}
        aria-pressed={authorized}
        title={authorized ? 'Revoke permission to run local tools' : 'Permit tools for this project; no tool starts automatically'}
        className="flex h-7 items-center gap-1.5 rounded border border-border-1 px-2 text-[11px] text-text-2 hover:border-accent/50 hover:text-text-1 disabled:opacity-40"
      >
        {authorized ? <ShieldCheck size={13} className="text-success" /> : <LockKeyhole size={13} />}
        {authorized ? 'Tools permitted' : 'Project restricted'}
      </button>
      <span className="flex-1" />
      <button type="button" onClick={onClose} disabled={loading} title="Close project session" className="grid h-7 w-7 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1 disabled:opacity-40">
        <X size={13} />
      </button>
    </div>
  )
}
