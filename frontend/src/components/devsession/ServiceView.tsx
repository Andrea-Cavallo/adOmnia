import { useEffect, useState, type ReactNode } from 'react'
import { Bug, Database, FolderGit2, Globe, MessageSquare, Radio, ScrollText, Server } from 'lucide-react'
import { entityRefFrom, type DevEntity, type DevSnapshot } from '@/lib/devcontext-api'
import {
  liveTools, setServiceName, startSqlCapture, stopSqlCapture, unwatchLiveKafka, watchLiveKafka,
  type LiveSession, type SessionTools,
} from '@/lib/devsession-api'
import { openEntity } from '@/lib/entities/router'
import { cn } from '@/lib/utils'
import { useDevSessionStore } from '@/stores/devSession'
import type { ServiceTarget } from '@/stores/devSessionModel'
import { openFrameInGoStudio } from '@/lib/devsession/navigation'
import { basename } from './liveUi'

const SQL_TYPES = new Set(['postgres', 'mysql', 'mariadb'])
const KAFKA_TYPES = new Set(['kafka', 'redpanda'])

function useSnapshot(goSessionId: string): DevSnapshot | null {
  const [snapshot, setSnapshot] = useState<DevSnapshot | null>(null)
  useEffect(() => {
    let cancelled = false
    let off = () => {}
    void import('@/stores/devcontext').then(({ useDevContextStore }) => {
      if (cancelled) return
      void useDevContextStore.getState().ensure(goSessionId)
      const read = () => { if (!cancelled) setSnapshot(useDevContextStore.getState().snapshots[goSessionId] ?? null) }
      read()
      off = useDevContextStore.subscribe(read)
    })
    return () => { cancelled = true; off() }
  }, [goSessionId])
  return snapshot
}

function Node({ icon, title, detail, children, action }: { icon: ReactNode; title: string; detail?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <li className="relative pl-5 before:absolute before:left-[7px] before:top-0 before:h-full before:w-px before:bg-border-2 last:before:h-3.5">
      <span aria-hidden="true" className="absolute left-[7px] top-3.5 h-px w-2.5 bg-border-2" />
      <div className="flex min-h-7 items-center gap-2 py-1">
        <span className="text-text-3">{icon}</span>
        <span className="text-[12px] font-medium text-text-1">{title}</span>
        {detail && <span className="min-w-0 truncate text-[11px] text-text-4">{detail}</span>}
        {action && <span className="ml-auto flex shrink-0 items-center gap-1">{action}</span>}
      </div>
      {children}
    </li>
  )
}

function SmallButton({ onClick, children, active }: { onClick: () => void; children: ReactNode; active?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('rounded border px-2 py-0.5 text-[11px] transition-colors', active ? 'border-accent/50 bg-accent/15 text-accent' : 'border-border-2 text-text-2 hover:border-accent hover:text-accent')}>
      {children}
    </button>
  )
}

/**
 * The service as one object: its Go project, REST API, runtime, databases,
 * topics, logs and debugger, with the capture tools that tie them to requests.
 */
export function ServiceView({ session }: { session: LiveSession }) {
  const snapshot = useSnapshot(session.goSessionId)
  const [tools, setTools] = useState<SessionTools>({})
  const [error, setError] = useState('')
  const [name, setName] = useState(session.service)
  const prefs = useDevSessionStore((state) => state.prefs)
  const setPrefs = useDevSessionStore((state) => state.setPrefs)
  const setTarget = useDevSessionStore((state) => state.setTarget)
  useEffect(() => { void liveTools(session.id).then(setTools).catch(() => undefined) }, [session.id])
  useEffect(() => setName(session.service), [session.service])

  const entities = snapshot?.entities ?? []
  const routes = entities.filter((e) => e.kind === 'route')
  const datasources = entities.filter((e) => e.kind === 'datasource')
  const sqlSources = datasources.filter((e) => SQL_TYPES.has(e.attrs.type))
  const kafkaSources = datasources.filter((e) => KAFKA_TYPES.has(e.attrs.type) || e.attrs.type?.includes('kafka'))
  const topics = entities.filter((e) => e.kind === 'topic' && (e.attrs.broker ?? 'kafka') === 'kafka')
  const dockerTargets = entities.filter((e) => e.kind === 'service' && e.attrs.port)
  const run = async (action: () => Promise<SessionTools>) => {
    setError('')
    try { setTools(await action()) } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }
  const target: ServiceTarget = prefs.targets[session.service] ?? { kind: 'local' }

  return (
    <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
      <div className="mb-3 flex items-center gap-2">
        <Server size={14} className="text-accent" />
        <input aria-label="Service name" value={name} onChange={(event) => setName(event.target.value)}
          onBlur={() => { if (name.trim() && name.trim() !== session.service) void setServiceName(session.goSessionId, name.trim()) }}
          onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur() }}
          className="h-7 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-[14px] font-semibold text-text-1 outline-none hover:border-border-2 focus:border-accent" />
        <span className="text-[10.5px] text-text-4">Link requests with <code className="text-text-2">{`{{service:${session.service}}}`}</code></span>
      </div>
      <ul>
        <Node icon={<FolderGit2 size={13} />} title="Go project" detail={basename(session.projectRoot)}
          action={<SmallButton onClick={() => void openFrameInGoStudio(session)}>Open</SmallButton>} />
        <Node icon={<Globe size={13} />} title="REST API" detail={`${routes.length} route${routes.length === 1 ? '' : 's'}`}>
          <ul className="ml-1">
            {routes.slice(0, 12).map((route) => (
              <li key={route.id} className="flex items-center gap-2 py-0.5 pl-4 text-[11.5px]">
                <button type="button" onClick={() => void openEntity(entityRefFrom(route, session.goSessionId))} className="min-w-0 truncate font-mono text-text-2 hover:text-accent" title="Open in API Workspace">{route.label}</button>
                {route.attrs.declName && <span className="truncate text-text-4">{route.attrs.declName}</span>}
              </li>
            ))}
            {routes.length > 12 && <li className="pl-4 text-[11px] text-text-4">…{routes.length - 12} more in the command palette</li>}
          </ul>
        </Node>
        <Node icon={<Radio size={13} />} title="Runtime" detail={`${session.kind === 'debug' ? 'Delve' : 'go run'} · ${session.port ? `localhost:${session.port}` : 'port not detected'}${session.pid ? ` · PID ${session.pid}` : ''}`}>
          <div className="flex flex-wrap items-center gap-1.5 py-1 pl-4 text-[11px] text-text-3">
            <span>Requests to <code>{`{{service:${session.service}}}`}</code> go to</span>
            <select aria-label="Service target" value={target.kind === 'local' ? 'local' : target.url ?? ''}
              onChange={(event) => setTarget(session.service, event.target.value === 'local' ? { kind: 'local' } : { kind: event.target.value.startsWith('http://localhost') ? 'docker' : 'remote', url: event.target.value })}
              className="h-6 max-w-64 rounded border border-border-2 bg-surface-2 px-1 text-[11px] text-text-1 outline-none focus:border-accent">
              <option value="local">Local run{session.port ? ` — :${session.port}` : ''}</option>
              {dockerTargets.map((docker) => {
                const port = docker.attrs.port.split(':')[0]
                return <option key={docker.id} value={`http://localhost:${port}`}>Docker — {docker.label} :{port}</option>
              })}
              {target.kind === 'remote' && target.url && <option value={target.url}>{target.url}</option>}
            </select>
            <RemoteTarget onSet={(url) => setTarget(session.service, { kind: 'remote', url })} />
          </div>
        </Node>
        <Node icon={<Database size={13} />} title="Databases" detail={sqlSources.map((d) => d.label).join(', ') || 'none detected'}
          action={tools.sql
            ? <SmallButton active onClick={() => void run(() => stopSqlCapture(session.id))}>Stop SQL capture</SmallButton>
            : null}>
          <SqlCapture tools={tools} sources={sqlSources} onStart={(kind, target, port) => void run(() => startSqlCapture(session.id, kind, target, port))} />
        </Node>
        <Node icon={<MessageSquare size={13} />} title="Kafka" detail={`${topics.length} topic${topics.length === 1 ? '' : 's'} in the code`}
          action={tools.kafka ? <SmallButton active onClick={() => void run(() => unwatchLiveKafka(session.id))}>Stop watching</SmallButton> : null}>
          <KafkaWatch tools={tools} sources={kafkaSources} topics={topics} onStart={(brokers, list) => void run(() => watchLiveKafka(session.id, brokers, list))} />
        </Node>
        <Node icon={<ScrollText size={13} />} title="Logs" detail="stdout and stderr, tied to requests by id or time" />
        <Node icon={<Bug size={13} />} title="Debugger" detail={session.kind === 'debug' ? (session.pause ? `paused at ${basename(session.pause.relativePath || '')}:${session.pause.line}` : 'Delve attached') : 'not attached — use Debug Request or Debug in Go Studio'} />
      </ul>
      {error && <p role="alert" className="mt-2 text-[11.5px] text-error">{error}</p>}
      <div className="mt-4 space-y-1.5 border-t border-border-1 pt-3 text-[11.5px] text-text-2">
        <label className="flex items-center gap-2"><input type="checkbox" checked={prefs.correlationHeader} onChange={(event) => setPrefs({ correlationHeader: event.target.checked })} className="accent-[var(--color-accent)]" />Add <code>X-AdOmnia-Request-ID</code> to requests sent to live services</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={prefs.autoSplitView} onChange={(event) => setPrefs({ autoSplitView: event.target.checked })} className="accent-[var(--color-accent)]" />Open the Split Debug View when a request stops at a breakpoint</label>
      </div>
    </div>
  )
}

function RemoteTarget({ onSet }: { onSet: (url: string) => void }) {
  const [value, setValue] = useState('')
  const valid = /^https?:\/\/[^\s]+$/.test(value.trim())
  return (
    <span className="flex items-center gap-1">
      <input value={value} onChange={(event) => setValue(event.target.value)} placeholder="https://dev-api.company.com" aria-label="Remote target URL"
        className="h-6 w-48 rounded border border-border-2 bg-surface-2 px-1.5 text-[11px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent" />
      <SmallButton onClick={() => { if (valid) { onSet(value.trim()); setValue('') } }}>Use</SmallButton>
    </span>
  )
}

function SqlCapture({ tools, sources, onStart }: { tools: SessionTools; sources: DevEntity[]; onStart: (kind: string, target: string, port: number) => void }) {
  const first = sources[0]
  const [kind, setKind] = useState(first?.attrs.type === 'mysql' || first?.attrs.type === 'mariadb' ? 'mysql' : 'postgres')
  const [target, setTarget] = useState(first ? `${first.attrs.host ?? 'localhost'}:${first.attrs.port ?? ''}` : 'localhost:5432')
  if (tools.sql) {
    return <p className="py-1 pl-4 text-[11px] text-text-3">Capturing on <code className="text-text-1">{tools.sql.listen}</code> → {tools.sql.target}. Point the service's database address at <code className="text-text-1">{tools.sql.listen}</code> (no TLS) and restart it.</p>
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 py-1 pl-4 text-[11px] text-text-3">
      <span>Capture SQL through a local proxy:</span>
      <select aria-label="Database kind" value={kind} onChange={(event) => setKind(event.target.value)} className="h-6 rounded border border-border-2 bg-surface-2 px-1 text-[11px] text-text-1 outline-none focus:border-accent">
        <option value="postgres">Postgres</option>
        <option value="mysql">MySQL</option>
      </select>
      <input aria-label="Database address" value={target} onChange={(event) => setTarget(event.target.value)} className="h-6 w-36 rounded border border-border-2 bg-surface-2 px-1.5 font-mono text-[11px] text-text-1 outline-none focus:border-accent" />
      <SmallButton onClick={() => onStart(kind, target.trim(), 0)}>Start</SmallButton>
    </div>
  )
}

function KafkaWatch({ tools, sources, topics, onStart }: { tools: SessionTools; sources: DevEntity[]; topics: DevEntity[]; onStart: (brokers: string[], topics: string[]) => void }) {
  const first = sources[0]
  const [brokers, setBrokers] = useState(first ? `${first.attrs.host ?? 'localhost'}:${first.attrs.port ?? '9092'}` : 'localhost:9092')
  const [list, setList] = useState(topics.map((topic) => topic.label).join(', '))
  useEffect(() => { if (!list && topics.length) setList(topics.map((topic) => topic.label).join(', ')) }, [topics, list])
  if (tools.kafka) {
    return <p className="py-1 pl-4 text-[11px] text-text-3">Watching {tools.kafka.topics.join(', ')} on {tools.kafka.brokers.join(', ')} (no consumer group, offsets untouched).</p>
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 py-1 pl-4 text-[11px] text-text-3">
      <span>Watch produced events:</span>
      <input aria-label="Kafka brokers" value={brokers} onChange={(event) => setBrokers(event.target.value)} className="h-6 w-36 rounded border border-border-2 bg-surface-2 px-1.5 font-mono text-[11px] text-text-1 outline-none focus:border-accent" />
      <input aria-label="Topics" value={list} onChange={(event) => setList(event.target.value)} placeholder="user.updated, …" className="h-6 min-w-0 flex-1 rounded border border-border-2 bg-surface-2 px-1.5 font-mono text-[11px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent" />
      <SmallButton onClick={() => onStart(brokers.split(',').map((b) => b.trim()).filter(Boolean), list.split(',').map((t) => t.trim()).filter(Boolean))}>Watch</SmallButton>
    </div>
  )
}
