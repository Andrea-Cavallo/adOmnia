import { useMemo } from 'react'
import { Globe, ScrollText } from 'lucide-react'
import { openWorkspaceApi, openWorkspaceLogs, workspaceServices } from '@/lib/devsession/workspaceFlow'
import { showEntityNotice } from '@/lib/entities/notice'
import { useDevSessionStore } from '@/stores/devSession'

/** One-click environment: while the workspace runs, its services with their ports, Open API and Open logs. */
export function GoStudioWorkspaceBar({ goSessionId }: { goSessionId: string }) {
  const sessions = useDevSessionStore((state) => state.sessions)
  const services = useMemo(() => workspaceServices(sessions, goSessionId), [sessions, goSessionId])
  if (services.length === 0) return null
  const fail = (error: unknown) => showEntityNotice(`Open API failed: ${error instanceof Error ? error.message : String(error)}`)
  return (
    <div role="region" aria-label="Running workspace" className="flex shrink-0 items-center gap-2 border-b border-border-1 bg-[var(--gs-island)] px-3 py-1 text-[11px] text-text-3">
      <span className="font-semibold uppercase tracking-[0.12em] text-[10px] text-text-4">Workspace</span>
      <ul className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        {services.map((session) => (
          <li key={session.id} className="flex shrink-0 items-center gap-1 rounded border border-border-1 px-1.5 py-0.5" title={session.portSource ? `Port detected from ${session.portSource}` : 'Port not detected yet'}>
            <span className={`h-1.5 w-1.5 rounded-full ${session.state === 'running' ? 'bg-success' : session.state === 'paused' ? 'bg-warning' : 'bg-text-4'}`} aria-hidden="true" />
            <span className="text-text-1">{session.service}</span>
            <span className="font-mono text-text-3">{session.port ? `:${session.port}` : '…'}</span>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => void openWorkspaceApi(goSessionId).catch(fail)} className="go-studio-widget h-6 gap-1 px-2" title="The detected routes as requests in the API Workspace, linked to the running service">
        <Globe size={12} /> Open API
      </button>
      <button type="button" onClick={() => openWorkspaceLogs(goSessionId)} className="go-studio-widget h-6 gap-1 px-2" title="Every running service of this project in the Log Inspector">
        <ScrollText size={12} /> Open logs
      </button>
    </div>
  )
}
