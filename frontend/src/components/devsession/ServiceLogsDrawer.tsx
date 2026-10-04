import { useEffect, useMemo, useState } from 'react'
import { showModule } from '@/lib/moduleRouting'
import { X } from 'lucide-react'
import { liveLogs, type LiveLogEntry } from '@/lib/devsession-api'
import { cn } from '@/lib/utils'
import { useDevSessionStore } from '@/stores/devSession'
import { LiveLogList } from './LiveRequestViews'
import { streamSessionToLogInspector } from '@/lib/devsession/logInspectorSource'
import { ServiceView } from './ServiceView'
import { LiveDot, stateLabel } from './liveUi'

type DrawerTab = 'logs' | 'service'

/** Side drawer of one live service: its output (filterable by request) and the service map. */
export function ServiceLogsDrawer({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const session = useDevSessionStore((state) => state.sessions[sessionId])
  const storeLogs = useDevSessionStore((state) => state.logs[sessionId])
  const [tab, setTab] = useState<DrawerTab>('logs')
  const [initial, setInitial] = useState<LiveLogEntry[]>([])
  const [onlyRequests, setOnlyRequests] = useState(false)
  useEffect(() => {
    let cancelled = false
    void liveLogs(sessionId, '', 2000).then((entries) => { if (!cancelled) setInitial(entries ?? []) }).catch(() => undefined)
    return () => { cancelled = true }
  }, [sessionId])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const entries = useMemo(() => {
    const seen = new Set<number>()
    const merged: LiveLogEntry[] = []
    for (const entry of [...initial, ...(storeLogs ?? [])]) {
      if (seen.has(entry.seq)) continue
      seen.add(entry.seq)
      if (!onlyRequests || entry.requestRunId) merged.push(entry)
    }
    return merged.sort((a, b) => a.seq - b.seq)
  }, [initial, storeLogs, onlyRequests])
  if (!session) return null

  return (
    <aside aria-label={`${session.service} service`} className="fixed bottom-12 right-3 top-12 z-[300] flex w-[min(620px,calc(100vw-32px))] flex-col overflow-hidden rounded-lg border border-border-2 bg-surface-1 shadow-2xl shadow-black/50">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border-1 px-3">
        <LiveDot session={session} />
        <span className="text-[12.5px] font-semibold text-text-1">{session.service}</span>
        <span className="text-[11px] text-text-4">{stateLabel(session)}{session.port ? ` · localhost:${session.port}` : ''}{session.pid ? ` · PID ${session.pid}` : ''}</span>
        <div role="tablist" className="ml-auto flex items-center gap-0.5 rounded-md bg-surface-2/70 p-0.5">
          {(['logs', 'service'] as const).map((id) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={cn('h-6 rounded px-2.5 text-[11px] capitalize', tab === id ? 'bg-surface-3 font-semibold text-text-1' : 'text-text-3 hover:text-text-1')}>{id}</button>
          ))}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1"><X size={13} /></button>
      </header>
      {tab === 'logs' ? (
        <>
          <label className="flex h-7 shrink-0 items-center gap-2 border-b border-border-1 px-3 text-[11px] text-text-3">
            <input type="checkbox" checked={onlyRequests} onChange={(event) => setOnlyRequests(event.target.checked)} className="accent-[var(--color-accent)]" />
            Only lines tied to API requests
          </label>
          <LiveLogList entries={entries} goSessionId={session.goSessionId} empty={`${session.service} has not printed anything yet.`}
            toolbar={<button type="button" onClick={() => { streamSessionToLogInspector(session.id, session.service); showModule('loginspector'); onClose() }}
              className="shrink-0 rounded border border-border-2 px-2 py-0.5 text-[11px] text-text-2 hover:border-accent hover:text-accent">Open in Log Inspector</button>} />
        </>
      ) : <ServiceView session={session} />}
    </aside>
  )
}
