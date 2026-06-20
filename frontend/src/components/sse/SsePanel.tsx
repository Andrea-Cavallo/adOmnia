import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  Check,
  ChevronRight,
  Copy,
  Download,
  Pause,
  Play,
  Plus,
  Radio,
  Save,
  Search,
  Trash2,
  X,
  Zap,
  ZapOff,
} from 'lucide-react'
import { getSidecarToken, useServerPort, serverUrl, sidecarFetch } from '@/lib/useServerPort'
import { useEnvironmentsStore } from '@/stores/environments'
import { useAppStore } from '@/stores/app'
import { cn } from '@/lib/utils'
import { safeSetItem } from '@/lib/safeLocalStorage'

type AuthType = 'none' | 'bearer' | 'basic'
type ConnStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

interface KVRow { key: string; value: string; enabled: boolean }

interface SSEConfig {
  url: string
  authType: AuthType
  token: string
  username: string
  password: string
  headers: KVRow[]
}

interface SSEEventItem {
  localId: string
  type: string
  id?: string
  retry?: number
  payload: string
  timestamp: number
  system?: boolean
}

interface SavedSSEStream {
  id: string
  name: string
  url: string
  savedAt: number
  events: SSEEventItem[]
}

const CONFIG_KEY = 'adomnia.sse.config'
const SAVED_KEY = 'adomnia.sse.saved'

function defaultConfig(): SSEConfig {
  return {
    url: 'http://localhost:8080/events',
    authType: 'none',
    token: '',
    username: '',
    password: '',
    headers: [],
  }
}

function loadConfig(): SSEConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (raw) return { ...defaultConfig(), ...JSON.parse(raw) }
  } catch {}
  return defaultConfig()
}

function loadSavedStreams(): SavedSSEStream[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY)
    if (raw) return JSON.parse(raw) as SavedSSEStream[]
  } catch {}
  return []
}

function substVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`)
}

function eventId() {
  return Math.random().toString(36).slice(2)
}

function fmt(ts: number) {
  const d = new Date(ts)
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return d.toLocaleTimeString('en-GB', { hour12: false }) + '.' + ms
}

function tryPrettyJson(payload: string) {
  try {
    return JSON.stringify(JSON.parse(payload), null, 2)
  } catch {
    return payload
  }
}

function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function StatusDot({ status }: { status: ConnStatus }) {
  const colors: Record<ConnStatus, string> = {
    connected: 'bg-success',
    connecting: 'bg-warning animate-pulse',
    disconnected: 'bg-text-4',
    error: 'bg-error',
  }
  return <span className={cn('h-2 w-2 rounded-full', colors[status])} />
}

function HeadersEditor({ headers, onChange }: { headers: KVRow[]; onChange: (headers: KVRow[]) => void }) {
  const update = (i: number, patch: Partial<KVRow>) => onChange(headers.map((h, j) => j === i ? { ...h, ...patch } : h))
  const remove = (i: number) => onChange(headers.filter((_, j) => j !== i))
  return (
    <div className="flex flex-col gap-1">
      {headers.map((h, i) => (
        <div key={i} className="flex items-center gap-1">
          <input type="checkbox" checked={h.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} className="h-3 w-3 accent-accent" />
          <input value={h.key} onChange={(e) => update(i, { key: e.target.value })} placeholder="Header" className="h-6 flex-1 rounded border border-border-2 bg-surface-0 px-1.5 text-[11px] text-text-1 outline-none focus:border-accent/40" />
          <input value={h.value} onChange={(e) => update(i, { value: e.target.value })} placeholder="Value" className="h-6 flex-1 rounded border border-border-2 bg-surface-0 px-1.5 text-[11px] text-text-1 outline-none focus:border-accent/40" />
          <button onClick={() => remove(i)} className="grid h-5 w-5 place-items-center rounded text-text-4 hover:text-error"><X size={10} /></button>
        </div>
      ))}
      <button onClick={() => onChange([...headers, { key: '', value: '', enabled: true }])} className="flex items-center gap-1 self-start text-[10px] text-text-4 hover:text-accent">
        <Plus size={10} /> Add header
      </button>
    </div>
  )
}

function EventCard({ event }: { event: SSEEventItem }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const pretty = tryPrettyJson(event.payload)
  const isJson = pretty !== event.payload
  const payload = expanded ? pretty : event.payload.slice(0, 500)

  const copyPayload = () => {
    navigator.clipboard.writeText(event.payload).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1000)
  }

  return (
    <div className={cn('group rounded border-l-2 bg-surface-1 px-2 py-1.5', event.system ? 'border-l-warning/50' : 'border-l-accent/50')}>
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex w-48 shrink-0 items-center gap-1.5">
          <span className="font-mono text-[9px] text-text-4">{fmt(event.timestamp)}</span>
          <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase', event.system ? 'bg-warning/10 text-warning' : 'bg-accent/10 text-accent-light')}>
            {event.type || 'message'}
          </span>
          {event.id && <span className="font-mono text-[9px] text-info">#{event.id}</span>}
          {event.retry ? <span className="font-mono text-[9px] text-text-4">retry {event.retry}</span> : null}
        </div>
        <div className="min-w-0 flex-1">
          {isJson && (
            <button onClick={() => setExpanded((v) => !v)} className="mb-1 flex items-center gap-1 text-[10px] text-text-4 hover:text-text-2">
              <ChevronRight size={10} className={cn('transition-transform', expanded && 'rotate-90')} />
              {expanded ? 'Collapse JSON' : 'Pretty JSON'}
            </button>
          )}
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-surface-0 p-2 font-mono text-[11px] leading-4 text-text-2">{payload}{!expanded && event.payload.length > 500 ? '...' : ''}</pre>
        </div>
        <button onClick={copyPayload} className="grid h-5 w-5 shrink-0 place-items-center text-text-4 opacity-0 transition-opacity hover:text-text-1 group-hover:opacity-100">
          {copied ? <Check size={10} className="text-success" /> : <Copy size={10} />}
        </button>
      </div>
    </div>
  )
}

export function SsePanel() {
  const port = useServerPort()
  const getResolvedVars = useEnvironmentsStore((s) => s.getResolvedVars)
  const [config, setConfig] = useState<SSEConfig>(loadConfig)
  const [status, setStatus] = useState<ConnStatus>('disconnected')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [events, setEvents] = useState<SSEEventItem[]>([])
  const [savedStreams, setSavedStreams] = useState<SavedSSEStream[]>(loadSavedStreams)
  const [showHeaders, setShowHeaders] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  const [paused, setPaused] = useState(false)
  const [buffered, setBuffered] = useState(0)
  const [typeFilter, setTypeFilter] = useState('')
  const [search, setSearch] = useState('')
  const [replayName, setReplayName] = useState('')
  const [activeSessions, setActiveSessions] = useState(0)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    return () => { useAppStore.getState().setSseRunning(false) }
  }, [])
  const pausedRef = useRef(false)
  const bufferRef = useRef<SSEEventItem[]>([])
  const logRef = useRef<HTMLDivElement | null>(null)

  const refreshSessions = useCallback(async () => {
    const url = serverUrl(port, '/sse/list')
    if (!url) return
    try {
      const res = await sidecarFetch(url)
      const data = await res.json()
      if (res.ok && Array.isArray(data)) setActiveSessions(data.length)
    } catch {}
  }, [port])

  const closeAllSessions = async () => {
    const url = serverUrl(port, '/sse/close-all')
    if (!url) return
    await sidecarFetch(url, { method: 'POST' }).catch(() => {})
    esRef.current?.close()
    setSessionId(null)
    setStatus('disconnected')
    setActiveSessions(0)
    useAppStore.getState().setSseRunning(false)
    addEvent({ type: 'close', payload: 'All SSE sessions closed', timestamp: Date.now(), system: true })
  }

  useEffect(() => safeSetItem(CONFIG_KEY, JSON.stringify(config)), [config])
  useEffect(() => safeSetItem(SAVED_KEY, JSON.stringify(savedStreams)), [savedStreams])
  useEffect(() => { pausedRef.current = paused }, [paused])
  useEffect(() => {
    if (!paused && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [events, paused])
  useEffect(() => () => { esRef.current?.close() }, [])
  useEffect(() => { void refreshSessions() }, [refreshSessions, sessionId])

  const addEvent = useCallback((ev: Omit<SSEEventItem, 'localId'>) => {
    const item = { ...ev, localId: eventId() }
    if (pausedRef.current) {
      bufferRef.current.push(item)
      setBuffered(bufferRef.current.length)
      return
    }
    setEvents((prev) => [...prev, item])
  }, [])

  const openInternalStream = useCallback(async (sid: string) => {
    esRef.current?.close()
    const token = await getSidecarToken()
    const url = serverUrl(port, `/sse/stream?sessionId=${encodeURIComponent(sid)}&token=${encodeURIComponent(token)}`)
    if (!url) return
    const es = new EventSource(url)
    esRef.current = es
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data) as Omit<SSEEventItem, 'localId'>
        addEvent(ev)
        if (ev.system && (ev.type === 'close' || ev.type === 'error')) {
          setStatus(ev.type === 'error' ? 'error' : 'disconnected')
          useAppStore.getState().setSseRunning(false)
          setSessionId(null)
          es.close()
        }
      } catch {}
    }
    es.onerror = () => es.close()
  }, [addEvent, port])

  const connect = useCallback(async () => {
    const url = serverUrl(port, '/sse/connect')
    if (!url) return
    setStatus('connecting')
    setEvents([])
    setBuffered(0)
    bufferRef.current = []
    const vars = getResolvedVars()
    const resolvedHeaders: Record<string, string> = {}
    for (const h of config.headers) {
      if (h.enabled && h.key.trim()) {
        resolvedHeaders[substVars(h.key, vars)] = substVars(h.value, vars)
      }
    }
    const resolvedUrl = substVars(config.url, vars)
    try {
      const res = await sidecarFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: resolvedUrl,
          headers: resolvedHeaders,
          auth: {
            type: config.authType,
            token: substVars(config.token, vars),
            username: substVars(config.username, vars),
            password: substVars(config.password, vars),
          },
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Connect failed')
      setSessionId(data.sessionId)
      setStatus('connected')
      useAppStore.getState().setSseRunning(true)
      addEvent({ type: 'open', payload: `Connected to ${resolvedUrl}`, timestamp: Date.now(), system: true })
      openInternalStream(data.sessionId)
    } catch (err) {
      setStatus('error')
      useAppStore.getState().setSseRunning(false)
      addEvent({ type: 'error', payload: err instanceof Error ? err.message : String(err), timestamp: Date.now(), system: true })
    }
  }, [addEvent, config, getResolvedVars, openInternalStream, port])

  const disconnect = async () => {
    esRef.current?.close()
    if (port && sessionId) {
      await sidecarFetch(serverUrl(port, '/sse/disconnect'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      }).catch(() => {})
    }
    setSessionId(null)
    setStatus('disconnected')
    useAppStore.getState().setSseRunning(false)
    addEvent({ type: 'close', payload: 'Disconnected', timestamp: Date.now(), system: true })
  }

  const resume = () => {
    setPaused(false)
    if (bufferRef.current.length > 0) {
      setEvents((prev) => [...prev, ...bufferRef.current])
      bufferRef.current = []
      setBuffered(0)
    }
  }

  const exportJSONL = () => {
    const lines = events.map(({ localId, ...ev }) => JSON.stringify(ev)).join('\n')
    downloadText(`sse-stream-${Date.now()}.jsonl`, lines, 'application/jsonl')
  }

  const saveStream = () => {
    if (events.length === 0) return
    const saved: SavedSSEStream = {
      id: eventId(),
      name: `SSE ${new Date().toLocaleString()}`,
      url: config.url,
      savedAt: Date.now(),
      events,
    }
    setSavedStreams((prev) => [saved, ...prev].slice(0, 20))
  }

  const replay = (stream: SavedSSEStream) => {
    setReplayName(stream.name)
    setEvents(stream.events.map((ev) => ({ ...ev, localId: eventId() })))
    setStatus('disconnected')
    setSessionId(null)
  }

  const knownTypes = useMemo(() => Array.from(new Set(events.map((e) => e.type).filter(Boolean))).sort(), [events])
  const visibleEvents = useMemo(() => {
    const q = search.trim().toLowerCase()
    return events.filter((ev) => {
      if (typeFilter && ev.type !== typeFilter) return false
      if (q && !ev.payload.toLowerCase().includes(q)) return false
      return true
    })
  }, [events, search, typeFilter])

  const connected = status === 'connected'

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-col gap-2 border-b border-border-1 bg-surface-1 px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 flex-1 items-center gap-1 rounded border border-border-2 bg-surface-0 px-2 focus-within:border-accent/40">
            <span className="shrink-0 text-[9px] font-semibold text-accent">SSE</span>
            <input
              value={config.url}
              disabled={connected}
              onChange={(e) => setConfig((c) => ({ ...c, url: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter' && !connected) void connect() }}
              placeholder="https://api.local/events"
              className="flex-1 bg-transparent font-mono text-[11px] text-text-1 outline-none placeholder:text-text-4"
            />
          </div>
          {connected ? (
            <button onClick={disconnect} className="flex h-7 items-center gap-1.5 rounded border border-error/30 bg-error/10 px-3 text-[11px] font-semibold text-error hover:bg-error/20">
              <ZapOff size={12} /> Disconnect
            </button>
          ) : (
            <button onClick={() => void connect()} disabled={!port || status === 'connecting'} className="flex h-7 items-center gap-1.5 rounded bg-accent px-3 text-[11px] font-semibold text-white disabled:opacity-40">
              <Zap size={12} /> Connect
            </button>
          )}
          <button onClick={() => void refreshSessions()} className="h-7 rounded border border-border-2 bg-surface-0 px-2 text-[10px] text-text-3 hover:text-text-1" title="Refresh active backend sessions">{activeSessions} sessions</button>
          {activeSessions > 0 && <button onClick={() => void closeAllSessions()} className="h-7 rounded border border-error/30 bg-error/10 px-2 text-[10px] text-error hover:bg-error/20">Close all</button>}
        </div>

        <div className="flex items-center gap-3">
          <button onClick={() => setShowAuth((v) => !v)} className={cn('flex items-center gap-1 text-[10px]', showAuth ? 'text-accent' : 'text-text-4 hover:text-text-2')}>
            <ChevronRight size={10} className={cn('transition-transform', showAuth && 'rotate-90')} /> Auth
          </button>
          <button onClick={() => setShowHeaders((v) => !v)} className={cn('flex items-center gap-1 text-[10px]', showHeaders ? 'text-accent' : 'text-text-4 hover:text-text-2')}>
            <ChevronRight size={10} className={cn('transition-transform', showHeaders && 'rotate-90')} /> Headers
            {config.headers.filter((h) => h.enabled && h.key).length > 0 && <span className="rounded bg-accent/20 px-1 text-[9px] text-accent">{config.headers.filter((h) => h.enabled && h.key).length}</span>}
          </button>
          <span className="text-[10px] text-text-4">Supports <span className="font-mono text-accent">{'{{variables}}'}</span></span>
        </div>

        {showAuth && (
          <div className="flex items-center gap-2 border-t border-border-2 pt-2">
            <select value={config.authType} onChange={(e) => setConfig((c) => ({ ...c, authType: e.target.value as AuthType }))} className="h-6 rounded border border-border-2 bg-surface-0 px-1.5 text-[11px] text-text-1 outline-none">
              <option value="none">No auth</option>
              <option value="bearer">Bearer Token</option>
              <option value="basic">Basic Auth</option>
            </select>
            {config.authType === 'bearer' && <input value={config.token} onChange={(e) => setConfig((c) => ({ ...c, token: e.target.value }))} type="password" placeholder="Token" className="h-6 flex-1 rounded border border-border-2 bg-surface-0 px-2 text-[11px] text-text-1 outline-none" />}
            {config.authType === 'basic' && (
              <>
                <input value={config.username} onChange={(e) => setConfig((c) => ({ ...c, username: e.target.value }))} placeholder="Username" className="h-6 flex-1 rounded border border-border-2 bg-surface-0 px-2 text-[11px] text-text-1 outline-none" />
                <input value={config.password} onChange={(e) => setConfig((c) => ({ ...c, password: e.target.value }))} type="password" placeholder="Password" className="h-6 flex-1 rounded border border-border-2 bg-surface-0 px-2 text-[11px] text-text-1 outline-none" />
              </>
            )}
          </div>
        )}

        {showHeaders && (
          <div className="border-t border-border-2 pt-2">
            <HeadersEditor headers={config.headers} onChange={(headers) => setConfig((c) => ({ ...c, headers }))} />
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-b border-border-1 bg-surface-0 px-3 py-1">
        <StatusDot status={status} />
        <span className={cn('text-[10px] font-medium', connected && 'text-success', status === 'connecting' && 'text-warning', status === 'error' && 'text-error', status === 'disconnected' && 'text-text-4')}>{status}</span>
        {sessionId && <span className="font-mono text-[9px] text-text-4">#{sessionId.slice(0, 8)}</span>}
        {replayName && <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[9px] text-text-4">Replay: {replayName}</span>}
        <div className="flex-1" />
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="h-6 rounded border border-border-2 bg-surface-1 px-2 text-[10px] text-text-2 outline-none">
          <option value="">All types</option>
          {knownTypes.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <div className="flex h-6 w-48 items-center gap-1 rounded border border-border-2 bg-surface-1 px-2">
          <Search size={10} className="text-text-4" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search payload" className="min-w-0 flex-1 bg-transparent text-[10px] text-text-1 outline-none" />
        </div>
        {paused ? (
          <button onClick={resume} className="flex h-6 items-center gap-1 rounded bg-accent px-2 text-[10px] font-medium text-white"><Play size={10} /> Resume {buffered ? `(${buffered})` : ''}</button>
        ) : (
          <button onClick={() => setPaused(true)} disabled={!connected} className="flex h-6 items-center gap-1 rounded px-2 text-[10px] text-text-3 hover:bg-surface-2 hover:text-text-1 disabled:opacity-30"><Pause size={10} /> Pause</button>
        )}
        <button onClick={saveStream} disabled={events.length === 0} className="flex h-6 items-center gap-1 rounded px-2 text-[10px] text-text-3 hover:bg-surface-2 hover:text-text-1 disabled:opacity-30"><Save size={10} /> Save</button>
        <button onClick={exportJSONL} disabled={events.length === 0} className="flex h-6 items-center gap-1 rounded px-2 text-[10px] text-text-3 hover:bg-surface-2 hover:text-text-1 disabled:opacity-30"><Download size={10} /> JSONL</button>
        <button onClick={() => { setEvents([]); setReplayName('') }} disabled={events.length === 0} className="flex h-6 items-center gap-1 rounded px-2 text-[10px] text-text-3 hover:bg-surface-2 hover:text-error disabled:opacity-30"><Trash2 size={10} /> Clear</button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_240px]">
        <div ref={logRef} className="flex min-h-0 flex-col gap-1 overflow-y-auto px-3 py-2">
          {visibleEvents.length === 0 ? (
            <div className="flex flex-1 items-center justify-center text-center">
              <div>
                <Radio size={34} className="mx-auto mb-2 text-text-4 opacity-30" />
                <p className="text-xs text-text-4">No SSE events to show</p>
                <p className="mt-1 text-[10px] text-text-4">Connect to an event-stream endpoint or replay a saved stream.</p>
              </div>
            </div>
          ) : (
            visibleEvents.map((ev) => <EventCard key={ev.localId} event={ev} />)
          )}
        </div>
        <aside className="min-h-0 overflow-y-auto border-l border-border-1 bg-surface-1 p-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-4">Saved Streams</span>
            <span className="text-[10px] text-text-4">{savedStreams.length}</span>
          </div>
          <div className="flex flex-col gap-1">
            {savedStreams.length === 0 && <p className="px-2 py-6 text-center text-[10px] text-text-4">No saved streams yet.</p>}
            {savedStreams.map((stream) => (
              <div key={stream.id} className="rounded border border-border-1 bg-surface-0 p-2">
                <button onClick={() => replay(stream)} className="block w-full truncate text-left text-[11px] font-medium text-text-2 hover:text-text-1">{stream.name}</button>
                <p className="mt-1 truncate font-mono text-[9px] text-text-4">{stream.url}</p>
                <div className="mt-2 flex items-center gap-2 text-[9px] text-text-4">
                  <span>{stream.events.length} events</span>
                  <button onClick={() => setSavedStreams((prev) => prev.filter((s) => s.id !== stream.id))} className="ml-auto text-text-4 hover:text-error">Delete</button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded border border-border-1 bg-surface-0 p-2">
            <div className="flex items-center gap-2 text-[10px] text-text-4">
              <Activity size={11} />
              <span>{events.length} total / {visibleEvents.length} visible</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
