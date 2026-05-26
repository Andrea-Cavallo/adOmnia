import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity, AlertCircle, BookMarked, CheckCircle2, ChevronDown, ChevronRight,
  Database, Download, ExternalLink, List,
  Loader2, Lock, MessageSquare, Plus, Radio, Send, Timer, Trash2,
  Unplug, X,
} from 'lucide-react'
import { useServerPort, serverUrl, sidecarFetch } from '@/lib/useServerPort'
import { cn } from '@/lib/utils'
import { JsonGraph } from '@/components/ui/JsonGraph'
import { KafkaPanel } from './KafkaPanel'
import { ConnectionProfiles } from './ConnectionProfiles'
import { useAppStore } from '@/stores/app'
import { safeSetItem } from '@/lib/safeLocalStorage'

// ─── types ────────────────────────────────────────────────────────────────────

type Protocol = 'kafka' | 'rabbitmq' | 'mqtt' | 'redis' | 'nats'

interface BrokerMessage {
  id: string
  timestamp: string
  topic: string
  content: string
  headers?: Record<string, string>
  metadata?: Record<string, string>
}

interface MessagePreset {
  id: string
  name: string
  protocol: Protocol
  content: string
  headers?: Record<string, string>
}

function sendBrokerSecretToVault(name: string, value: string, note: string) {
  if (!value) return
  safeSetItem('adomnia.vault.pendingSecret', JSON.stringify({ name, value, note }))
  useAppStore.getState().setActiveRail('vault')
}

// ─── constants ────────────────────────────────────────────────────────────────

const PROTOCOL_DEFS: { id: Protocol; label: string; color: string; desc: string; port: string }[] = [
  { id: 'kafka',    label: 'Kafka',    color: '#fb923c', desc: 'Apache Kafka streaming', port: '9092'  },
  { id: 'rabbitmq', label: 'RabbitMQ', color: '#f87171', desc: 'AMQP 0-9-1 messaging',  port: '5672'  },
  { id: 'mqtt',     label: 'MQTT',     color: '#34d399', desc: 'IoT pub/sub protocol',   port: '1883'  },
  { id: 'redis',    label: 'Redis',    color: '#60a5fa', desc: 'In-memory pub/sub',       port: '6379'  },
  { id: 'nats',     label: 'NATS',     color: '#a78bfa', desc: 'Cloud-native messaging',  port: '4222'  },
]

const inputClass = 'h-8 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none focus:border-accent w-full'
const labelClass = 'text-[10px] text-text-4 uppercase tracking-wider mb-0.5 block'

// ─── small shared components ──────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col">
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  )
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 h-8 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-2 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="accent-accent" />
      {label}
    </label>
  )
}

function KVEditor({ rows, onChange, keyPlaceholder = 'key', valuePlaceholder = 'value' }: {
  rows: { key: string; value: string }[]
  onChange: (rows: { key: string; value: string }[]) => void
  keyPlaceholder?: string
  valuePlaceholder?: string
}) {
  return (
    <div className="flex flex-col gap-1">
      {rows.map((row, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_24px] gap-1">
          <input value={row.key} onChange={e => onChange(rows.map((r, j) => j === i ? { ...r, key: e.target.value } : r))}
            placeholder={keyPlaceholder} className={cn(inputClass, 'h-7 font-mono')} />
          <input value={row.value} onChange={e => onChange(rows.map((r, j) => j === i ? { ...r, value: e.target.value } : r))}
            placeholder={valuePlaceholder} className={cn(inputClass, 'h-7 font-mono')} />
          <button onClick={() => onChange(rows.filter((_, j) => j !== i))} className="grid place-items-center text-text-4 hover:text-error">
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <button onClick={() => onChange([...rows, { key: '', value: '' }])} className="self-start inline-flex items-center gap-1 text-[11px] text-accent hover:text-accent/80">
        <Plus size={11} /> Add row
      </button>
    </div>
  )
}

// ─── message log ──────────────────────────────────────────────────────────────

function MessageItem({ msg, onRemove }: { msg: BrokerMessage; onRemove: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [showHeaders, setShowHeaders] = useState(false)
  const [showJson, setShowJson] = useState(false)

  const isJson = (() => { try { JSON.parse(msg.content); return true } catch { return false } })()

  return (
    <div className="border-b border-border-1/50 last:border-0">
      <div className="flex items-start gap-2 px-3 py-2 hover:bg-surface-1/50">
        <button onClick={() => setExpanded(v => !v)} className="mt-0.5 text-text-4 hover:text-text-2 flex-shrink-0">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-accent-light truncate max-w-[140px]">{msg.topic}</span>
            <span className="text-[9px] text-text-4">{new Date(msg.timestamp).toLocaleTimeString()}</span>
            {isJson && (
              <button onClick={() => setShowJson(v => !v)} title="JSON view"
                className="text-[9px] px-1.5 py-0.5 rounded bg-accent/10 text-accent hover:bg-accent/20 transition-colors">
                JSON
              </button>
            )}
            {Object.keys(msg.headers ?? {}).length > 0 && (
              <button onClick={() => setShowHeaders(v => !v)} title="Headers"
                className="text-[9px] px-1.5 py-0.5 rounded bg-surface-2 text-text-4 hover:text-text-2 transition-colors">
                HDR
              </button>
            )}
          </div>
          <p className={cn('font-mono text-xs text-text-3 mt-0.5 break-all', !expanded && 'truncate')}>
            {msg.content}
          </p>
        </div>
        <button onClick={onRemove} className="text-text-4 hover:text-error flex-shrink-0 mt-0.5">
          <X size={11} />
        </button>
      </div>

      {expanded && (
        <div className="px-3 pb-2 space-y-1.5">
          {showHeaders && Object.keys(msg.headers ?? {}).length > 0 && (
            <div className="rounded border border-border-1 bg-surface-0 p-2">
              <p className="text-[9px] font-semibold text-text-4 uppercase mb-1.5">Headers</p>
              {Object.entries(msg.headers ?? {}).map(([k, v]) => (
                <div key={k} className="flex gap-2 text-[10px] font-mono">
                  <span className="text-accent-light min-w-[100px]">{k}</span>
                  <span className="text-text-3">{v}</span>
                </div>
              ))}
            </div>
          )}
          {Object.keys(msg.metadata ?? {}).length > 0 && (
            <div className="rounded border border-border-1 bg-surface-0 p-2">
              <p className="text-[9px] font-semibold text-text-4 uppercase mb-1.5">Metadata</p>
              {Object.entries(msg.metadata ?? {}).map(([k, v]) => (
                <div key={k} className="flex gap-2 text-[10px] font-mono">
                  <span className="text-text-4 min-w-[100px]">{k}</span>
                  <span className="text-text-3">{v}</span>
                </div>
              ))}
            </div>
          )}
          {showJson && isJson && (
            <div className="rounded border border-border-1 bg-surface-0 p-2 max-h-48 overflow-auto">
              <JsonGraph json={msg.content} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function MessageLog({
  messages, onClear, onRemove, onExport,
}: {
  messages: BrokerMessage[]
  onClear: () => void
  onRemove: (id: string) => void
  onExport: () => void
}) {
  const [msgs, setMsgs] = useState(messages)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => { setMsgs(messages) }, [messages])
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [msgs.length])

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-1 flex-shrink-0">
        <MessageSquare size={12} className="text-accent" />
        <span className="text-xs font-semibold text-text-2 flex-1">
          Messages <span className="text-text-4 font-normal">({msgs.length})</span>
        </span>
        <button onClick={onExport} title="Export JSON" disabled={msgs.length === 0}
          className="h-5 w-5 flex items-center justify-center rounded text-text-4 hover:text-accent disabled:opacity-40 transition-colors">
          <Download size={11} />
        </button>
        <button onClick={onClear} title="Clear" disabled={msgs.length === 0}
          className="h-5 w-5 flex items-center justify-center rounded text-text-4 hover:text-error disabled:opacity-40 transition-colors">
          <Trash2 size={11} />
        </button>
      </div>
      <div ref={ref} className="flex-1 overflow-y-auto bg-surface-0">
        {msgs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-center px-4">
            <Radio size={18} className="text-text-4 mb-2 opacity-40" />
            <p className="text-xs text-text-4">No messages yet</p>
          </div>
        ) : (
          msgs.map(msg => (
            <MessageItem key={msg.id} msg={msg} onRemove={() => onRemove(msg.id)} />
          ))
        )}
      </div>
    </div>
  )
}

// ─── preset manager ───────────────────────────────────────────────────────────

function PresetManager({
  protocol, content, headers, port,
  onLoad,
}: {
  protocol: Protocol
  content: string
  headers: { key: string; value: string }[]
  port: number | null
  onLoad: (preset: MessagePreset) => void
}) {
  const [presets, setPresets] = useState<MessagePreset[]>([])
  const [saveName, setSaveName] = useState('')
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)

  const fetchPresets = useCallback(async () => {
    const url = serverUrl(port, '/broker/presets/list')
    if (!url) return
    try {
      const res = await sidecarFetch(url)
      const data = await res.json()
      setPresets((data.presets ?? []).filter((p: MessagePreset) => p.protocol === protocol))
    } catch { /* ignore */ }
  }, [port, protocol])

  useEffect(() => { if (open) fetchPresets() }, [open, fetchPresets])

  const save = async () => {
    if (!saveName.trim()) return
    const url = serverUrl(port, '/broker/presets/save')
    if (!url) return
    setSaving(true)
    try {
      const hdrs: Record<string, string> = {}
      headers.filter(h => h.key).forEach(h => { hdrs[h.key] = h.value })
      await sidecarFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: saveName, protocol, content, headers: hdrs }),
      })
      setSaveName('')
      fetchPresets()
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    const url = serverUrl(port, `/broker/presets/delete?id=${encodeURIComponent(id)}`)
    if (!url) return
    await sidecarFetch(url, { method: 'POST' })
    fetchPresets()
  }

  return (
    <div className="border-t border-border-1">
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-text-4 hover:text-text-2 transition-colors">
        <BookMarked size={11} />
        <span className="flex-1 text-left">Presets</span>
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          <div className="flex gap-1.5">
            <input value={saveName} onChange={e => setSaveName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') save() }}
              placeholder="Preset name…" className={cn(inputClass, 'flex-1')} />
            <button onClick={save} disabled={!saveName.trim() || saving}
              className="px-2 py-1 bg-accent text-white rounded text-[11px] font-semibold disabled:opacity-50">
              {saving ? <Loader2 size={11} className="animate-spin" /> : 'Save'}
            </button>
          </div>
          {presets.length === 0 ? (
            <p className="text-[10px] text-text-4">No presets for {protocol} yet.</p>
          ) : (
            presets.map(p => (
              <div key={p.id} className="flex items-center gap-2 rounded border border-border-1 bg-surface-1 px-2 py-1.5">
                <span className="flex-1 text-xs text-text-2 truncate">{p.name}</span>
                <button onClick={() => onLoad(p)} title="Load" className="text-accent hover:text-accent/80">
                  <ExternalLink size={11} />
                </button>
                <button onClick={() => remove(p.id)} title="Delete" className="text-text-4 hover:text-error">
                  <Trash2 size={11} />
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ─── RabbitMQ panel ───────────────────────────────────────────────────────────

function RabbitMQPanel({ port, onMessages }: { port: number | null; onMessages: (msgs: BrokerMessage[]) => void }) {
  const [url, setUrl] = useState('amqp://guest:guest@localhost:5672/')
  const [exchange, setExchange] = useState('')
  const [queue, setQueue] = useState('adomnia.test')
  const [routingKey, setRoutingKey] = useState('adomnia.test')
  const [body, setBody] = useState('{\n  "event": "test",\n  "source": "adomnia"\n}')
  const [contentType, setContentType] = useState('application/json')
  const [persistent, setPersistent] = useState(false)
  const [autoAck, setAutoAck] = useState(true)
  const [maxWait, setMaxWait] = useState(5)
  const [maxMsgs, setMaxMsgs] = useState(20)
  const [headers, setHeaders] = useState<{ key: string; value: string }[]>([])
  const [tab, setTab] = useState<'publish' | 'consume' | 'info'>('publish')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ ok?: boolean; error?: string; [k: string]: unknown } | null>(null)

  useEffect(() => {
    const raw = localStorage.getItem('adomnia.broker.pending')
    if (!raw) return
    try {
      const pending = JSON.parse(raw) as { protocol?: string; rabbitmq?: { url?: string } }
      if (pending.protocol !== 'rabbitmq' || !pending.rabbitmq) return
      if (pending.rabbitmq.url) setUrl(pending.rabbitmq.url)
      localStorage.removeItem('adomnia.broker.pending')
    } catch {
      localStorage.removeItem('adomnia.broker.pending')
    }
  }, [])

  const post = async (path: string, payload: unknown) => {
    const url2 = serverUrl(port, path)
    if (!url2) return
    setLoading(true)
    setResult(null)
    try {
      const res = await sidecarFetch(url2, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await res.json()
      setResult(data)
      if (data.messages) onMessages(data.messages)
    } catch (e) {
      setResult({ ok: false, error: String(e) })
    } finally {
      setLoading(false)
    }
  }

  const hdrsObj: Record<string, string> = {}
  headers.filter(h => h.key).forEach(h => { hdrsObj[h.key] = h.value })

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded border border-border-1 bg-surface-1 p-3">
        <div className="flex items-center gap-2 mb-3">
          <Unplug size={13} className="text-[#f87171]" />
          <h3 className="text-xs font-semibold text-text-1">Connection</h3>
        </div>
        <ConnectionProfiles
          protocol="rabbitmq"
          config={{ url, exchange, queue }}
          onLoad={(saved) => {
            if (saved.url !== undefined) setUrl(saved.url)
            if (saved.exchange !== undefined) setExchange(saved.exchange)
            if (saved.queue !== undefined) setQueue(saved.queue)
          }}
        />
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-3">
            <Field label="AMQP URL">
              <input value={url} onChange={e => setUrl(e.target.value)} className={inputClass} placeholder="amqp://user:pass@host:5672/vhost" />
            </Field>
          </div>
          <Field label="Exchange">
            <input value={exchange} onChange={e => setExchange(e.target.value)} className={inputClass} placeholder="(default)" />
          </Field>
          <Field label="Queue">
            <input value={queue} onChange={e => setQueue(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Routing Key">
            <input value={routingKey} onChange={e => setRoutingKey(e.target.value)} className={inputClass} />
          </Field>
        </div>
      </div>

      <div className="flex gap-2">
        {(['publish', 'consume', 'info'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn('px-3 py-1.5 rounded text-xs font-semibold capitalize transition-colors',
              tab === t ? 'bg-[#f87171]/20 text-[#f87171] border border-[#f87171]/40' : 'text-text-3 hover:text-text-1 hover:bg-surface-2')}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'publish' && (
        <div className="rounded border border-border-1 bg-surface-1 p-3 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Content-Type">
              <input value={contentType} onChange={e => setContentType(e.target.value)} className={inputClass} />
            </Field>
            <CheckRow label="Persistent (durable)" checked={persistent} onChange={setPersistent} />
          </div>
          <Field label="Body">
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={8}
              className="px-3 py-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono outline-none focus:border-accent resize-y w-full" />
          </Field>
          <div>
            <span className={labelClass}>Headers</span>
            <KVEditor rows={headers} onChange={setHeaders} keyPlaceholder="x-header" />
          </div>
          <button onClick={() => post('/broker/rabbitmq/publish', { config: { url, exchange, queue }, routingKey, body, contentType, headers: hdrsObj, persistent })}
            disabled={loading || !url || !queue}
            className="self-start inline-flex items-center gap-2 rounded bg-[#f87171] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
            <Send size={13} /> {loading ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      )}

      {tab === 'consume' && (
        <div className="rounded border border-border-1 bg-surface-1 p-3 flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Max wait (s)">
              <input type="number" value={maxWait} min={1} max={30} onChange={e => setMaxWait(Number(e.target.value))} className={inputClass} />
            </Field>
            <Field label="Max messages">
              <input type="number" value={maxMsgs} min={1} max={200} onChange={e => setMaxMsgs(Number(e.target.value))} className={inputClass} />
            </Field>
            <CheckRow label="Auto-ack" checked={autoAck} onChange={setAutoAck} />
          </div>
          <button onClick={() => post('/broker/rabbitmq/consume', { config: { url, exchange, queue }, maxWait, maxMsgs, autoAck })}
            disabled={loading || !url || !queue}
            className="self-start inline-flex items-center gap-2 rounded bg-[#f87171] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
            <Timer size={13} /> {loading ? 'Consuming…' : 'Consume'}
          </button>
        </div>
      )}

      {tab === 'info' && (
        <div className="rounded border border-border-1 bg-surface-1 p-3 text-xs text-text-3 space-y-1.5">
          <p><span className="font-semibold text-text-2">Protocol:</span> AMQP 0-9-1</p>
          <p><span className="font-semibold text-text-2">Default port:</span> 5672 (TLS: 5671)</p>
          <p><span className="font-semibold text-text-2">URL format:</span> <span className="font-mono">amqp://user:pass@host:5672/vhost</span></p>
          <p><span className="font-semibold text-text-2">Exchange types:</span> direct, fanout, topic, headers</p>
          <p>For exchange/queue listing use the RabbitMQ Management Plugin at <span className="font-mono">http://host:15672</span></p>
        </div>
      )}

      {result && (
        <div className={cn('rounded border px-3 py-2 text-xs flex items-center gap-2',
          result.ok ? 'border-success/30 bg-success/8 text-success' : 'border-error/30 bg-error/8 text-error')}>
          {result.ok ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
          {result.ok ? `Published to exchange "${exchange || '(default)'}", routing key "${routingKey}"` : String(result.error)}
        </div>
      )}

      <PresetManager protocol="rabbitmq" content={body} headers={headers} port={port}
        onLoad={p => { setBody(p.content); if (p.headers) setHeaders(Object.entries(p.headers).map(([k, v]) => ({ key: k, value: v }))) }} />
    </div>
  )
}

// ─── MQTT panel ───────────────────────────────────────────────────────────────

function MQTTPanel({ port, onMessages }: { port: number | null; onMessages: (msgs: BrokerMessage[]) => void }) {
  const [broker, setBroker] = useState('tcp://localhost:1883')
  const [clientId, setClientId] = useState('adomnia-client')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [topic, setTopic] = useState('adomnia/test')
  const [payload, setPayload] = useState('{"event":"test"}')
  const [qos, setQoS] = useState<0 | 1 | 2>(0)
  const [retained, setRetained] = useState(false)
  const [maxWait, setMaxWait] = useState(5)
  const [maxMsgs, setMaxMsgs] = useState(20)
  const [tab, setTab] = useState<'publish' | 'subscribe'>('publish')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ ok?: boolean; error?: string; [k: string]: unknown } | null>(null)

  const cfg = { broker, clientId, username: username || undefined, password: password || undefined }

  const post = async (path: string, body: unknown) => {
    const url = serverUrl(port, path)
    if (!url) return
    setLoading(true); setResult(null)
    try {
      const res = await sidecarFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      setResult(data)
      if (data.messages) onMessages(data.messages)
    } catch (e) {
      setResult({ ok: false, error: String(e) })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded border border-border-1 bg-surface-1 p-3">
        <div className="flex items-center gap-2 mb-3">
          <Unplug size={13} className="text-[#34d399]" />
          <h3 className="text-xs font-semibold text-text-1">Connection</h3>
        </div>
        <ConnectionProfiles
          protocol="mqtt"
          config={{ broker, clientId, username, password }}
          onLoad={(saved) => {
            if (saved.broker !== undefined) setBroker(saved.broker)
            if (saved.clientId !== undefined) setClientId(saved.clientId)
            if (saved.username !== undefined) setUsername(saved.username)
            if (saved.password !== undefined) setPassword(saved.password)
          }}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Broker URL">
            <input value={broker} onChange={e => setBroker(e.target.value)} className={inputClass} placeholder="tcp://localhost:1883" />
          </Field>
          <Field label="Client ID">
            <input value={clientId} onChange={e => setClientId(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Username">
            <input value={username} onChange={e => setUsername(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Password">
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} className={inputClass} />
          </Field>
        </div>
        <button
          onClick={() => sendBrokerSecretToVault('MQTT password', password, `MQTT broker ${broker}`)}
          disabled={!password}
          className="mt-2 text-[10px] text-text-4 hover:text-accent disabled:opacity-40"
        >
          Send password to Vault
        </button>
      </div>

      <div className="flex gap-2">
        {(['publish', 'subscribe'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn('px-3 py-1.5 rounded text-xs font-semibold capitalize transition-colors',
              tab === t ? 'bg-[#34d399]/20 text-[#34d399] border border-[#34d399]/40' : 'text-text-3 hover:text-text-1 hover:bg-surface-2')}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'publish' && (
        <div className="rounded border border-border-1 bg-surface-1 p-3 flex flex-col gap-3">
          <div className="grid grid-cols-[1fr_80px_auto_auto] gap-3 items-end">
            <Field label="Topic">
              <input value={topic} onChange={e => setTopic(e.target.value)} className={inputClass} />
            </Field>
            <Field label="QoS">
              <select value={qos} onChange={e => setQoS(Number(e.target.value) as 0|1|2)} className={inputClass}>
                <option value={0}>0 – Fire</option>
                <option value={1}>1 – At least</option>
                <option value={2}>2 – Exactly</option>
              </select>
            </Field>
            <CheckRow label="Retained" checked={retained} onChange={setRetained} />
          </div>
          <Field label="Payload">
            <textarea value={payload} onChange={e => setPayload(e.target.value)} rows={6}
              className="px-3 py-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono outline-none focus:border-accent resize-y w-full" />
          </Field>
          <button onClick={() => post('/broker/mqtt/publish', { config: cfg, topic, payload, qos, retained })}
            disabled={loading || !broker || !topic}
            className="self-start inline-flex items-center gap-2 rounded bg-[#34d399] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
            <Send size={13} /> {loading ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      )}

      {tab === 'subscribe' && (
        <div className="rounded border border-border-1 bg-surface-1 p-3 flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Topic / Wildcard">
              <input value={topic} onChange={e => setTopic(e.target.value)} className={inputClass} placeholder="adomnia/# or sensors/+/temp" />
            </Field>
            <Field label="Max wait (s)">
              <input type="number" value={maxWait} min={1} max={30} onChange={e => setMaxWait(Number(e.target.value))} className={inputClass} />
            </Field>
            <Field label="Max messages">
              <input type="number" value={maxMsgs} min={1} max={200} onChange={e => setMaxMsgs(Number(e.target.value))} className={inputClass} />
            </Field>
          </div>
          <button onClick={() => post('/broker/mqtt/subscribe', { config: cfg, topic, qos, maxWait, maxMsgs })}
            disabled={loading || !broker || !topic}
            className="self-start inline-flex items-center gap-2 rounded bg-[#34d399] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
            <Timer size={13} /> {loading ? 'Subscribing…' : 'Subscribe'}
          </button>
        </div>
      )}

      {result && (
        <div className={cn('rounded border px-3 py-2 text-xs flex items-center gap-2',
          result.ok ? 'border-success/30 bg-success/8 text-success' : 'border-error/30 bg-error/8 text-error')}>
          {result.ok ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
          {result.ok
            ? (result.messages ? `Received ${(result.messages as unknown[]).length} messages` : `Published to topic "${topic}" (QoS ${qos})`)
            : String(result.error)}
        </div>
      )}

      <PresetManager protocol="mqtt" content={payload} headers={[]} port={port}
        onLoad={p => setPayload(p.content)} />
    </div>
  )
}

// ─── Redis panel ──────────────────────────────────────────────────────────────

function RedisPanel({ port, onMessages }: { port: number | null; onMessages: (msgs: BrokerMessage[]) => void }) {
  const [addr, setAddr] = useState('localhost:6379')
  const [password, setPassword] = useState('')
  const [dbNum, setDbNum] = useState(0)
  const [channel, setChannel] = useState('adomnia:events')
  const [message, setMessage] = useState('{"event":"test"}')
  const [maxWait, setMaxWait] = useState(5)
  const [maxMsgs, setMaxMsgs] = useState(20)
  const [tab, setTab] = useState<'publish' | 'subscribe'>('publish')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ ok?: boolean; error?: string; receivers?: number; [k: string]: unknown } | null>(null)

  useEffect(() => {
    const raw = localStorage.getItem('adomnia.broker.pending')
    if (!raw) return
    try {
      const pending = JSON.parse(raw) as { protocol?: string; redis?: { addr?: string } }
      if (pending.protocol !== 'redis' || !pending.redis) return
      if (pending.redis.addr) setAddr(pending.redis.addr)
      localStorage.removeItem('adomnia.broker.pending')
    } catch {
      localStorage.removeItem('adomnia.broker.pending')
    }
  }, [])

  const cfg = { addr, password: password || undefined, db: dbNum }

  const post = async (path: string, body: unknown) => {
    const url = serverUrl(port, path)
    if (!url) return
    setLoading(true); setResult(null)
    try {
      const res = await sidecarFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      setResult(data)
      if (data.messages) onMessages(data.messages)
    } catch (e) {
      setResult({ ok: false, error: String(e) })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded border border-border-1 bg-surface-1 p-3">
        <div className="flex items-center gap-2 mb-3">
          <Database size={13} className="text-[#60a5fa]" />
          <h3 className="text-xs font-semibold text-text-1">Connection</h3>
        </div>
        <ConnectionProfiles
          protocol="redis"
          config={{ addr, password, dbNum }}
          onLoad={(saved) => {
            if (saved.addr !== undefined) setAddr(saved.addr)
            if (saved.password !== undefined) setPassword(saved.password)
            if (saved.dbNum !== undefined) setDbNum(saved.dbNum)
          }}
        />
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-1">
            <Field label="Address">
              <input value={addr} onChange={e => setAddr(e.target.value)} className={inputClass} placeholder="localhost:6379" />
            </Field>
          </div>
          <Field label="Password">
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} className={inputClass} />
          </Field>
          <Field label="DB Index">
            <input type="number" value={dbNum} min={0} max={15} onChange={e => setDbNum(Number(e.target.value))} className={inputClass} />
          </Field>
        </div>
        <button
          onClick={() => sendBrokerSecretToVault('Redis password', password, `Redis ${addr} database ${dbNum}`)}
          disabled={!password}
          className="mt-2 text-[10px] text-text-4 hover:text-accent disabled:opacity-40"
        >
          Send password to Vault
        </button>
      </div>

      <div className="flex gap-2">
        {(['publish', 'subscribe'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn('px-3 py-1.5 rounded text-xs font-semibold capitalize transition-colors',
              tab === t ? 'bg-[#60a5fa]/20 text-[#60a5fa] border border-[#60a5fa]/40' : 'text-text-3 hover:text-text-1 hover:bg-surface-2')}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'publish' && (
        <div className="rounded border border-border-1 bg-surface-1 p-3 flex flex-col gap-3">
          <Field label="Channel">
            <input value={channel} onChange={e => setChannel(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Message">
            <textarea value={message} onChange={e => setMessage(e.target.value)} rows={6}
              className="px-3 py-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono outline-none focus:border-accent resize-y w-full" />
          </Field>
          <button onClick={() => post('/broker/redis/publish', { config: cfg, channel, message })}
            disabled={loading || !addr || !channel}
            className="self-start inline-flex items-center gap-2 rounded bg-[#60a5fa] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
            <Send size={13} /> {loading ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      )}

      {tab === 'subscribe' && (
        <div className="rounded border border-border-1 bg-surface-1 p-3 flex flex-col gap-3">
          <Field label="Channels (comma-separated or pattern)">
            <input value={channel} onChange={e => setChannel(e.target.value)} className={inputClass} placeholder="chan1,chan2 or adomnia:*" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Max wait (s)">
              <input type="number" value={maxWait} min={1} max={30} onChange={e => setMaxWait(Number(e.target.value))} className={inputClass} />
            </Field>
            <Field label="Max messages">
              <input type="number" value={maxMsgs} min={1} max={200} onChange={e => setMaxMsgs(Number(e.target.value))} className={inputClass} />
            </Field>
          </div>
          <button onClick={() => post('/broker/redis/subscribe', { config: cfg, channels: channel.split(',').map(c => c.trim()).filter(Boolean), maxWait, maxMsgs })}
            disabled={loading || !addr || !channel}
            className="self-start inline-flex items-center gap-2 rounded bg-[#60a5fa] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
            <Timer size={13} /> {loading ? 'Subscribing…' : 'Subscribe'}
          </button>
        </div>
      )}

      {result && (
        <div className={cn('rounded border px-3 py-2 text-xs flex items-center gap-2',
          result.ok ? 'border-success/30 bg-success/8 text-success' : 'border-error/30 bg-error/8 text-error')}>
          {result.ok ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
          {result.ok
            ? (result.messages ? `Received ${(result.messages as unknown[]).length} messages`
                : `Published to "${channel}" — ${result.receivers ?? 0} active subscriber(s)`)
            : String(result.error)}
        </div>
      )}

      <PresetManager protocol="redis" content={message} headers={[]} port={port}
        onLoad={p => setMessage(p.content)} />
    </div>
  )
}

// ─── NATS panel ───────────────────────────────────────────────────────────────

function NATSPanel({ port, onMessages }: { port: number | null; onMessages: (msgs: BrokerMessage[]) => void }) {
  const [natsUrl, setNatsUrl] = useState('nats://localhost:4222')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('')
  const [subject, setSubject] = useState('adomnia.events')
  const [payload, setPayload] = useState('{"event":"test"}')
  const [headers, setHeaders] = useState<{ key: string; value: string }[]>([])
  const [maxWait, setMaxWait] = useState(5)
  const [maxMsgs, setMaxMsgs] = useState(20)
  const [tab, setTab] = useState<'publish' | 'subscribe'>('publish')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ ok?: boolean; error?: string; [k: string]: unknown } | null>(null)

  const cfg = { url: natsUrl, username: username || undefined, password: password || undefined, token: token || undefined }
  const hdrsObj: Record<string, string> = {}
  headers.filter(h => h.key).forEach(h => { hdrsObj[h.key] = h.value })

  const post = async (path: string, body: unknown) => {
    const url = serverUrl(port, path)
    if (!url) return
    setLoading(true); setResult(null)
    try {
      const res = await sidecarFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      setResult(data)
      if (data.messages) onMessages(data.messages)
    } catch (e) {
      setResult({ ok: false, error: String(e) })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded border border-border-1 bg-surface-1 p-3">
        <div className="flex items-center gap-2 mb-3">
          <Activity size={13} className="text-[#a78bfa]" />
          <h3 className="text-xs font-semibold text-text-1">Connection</h3>
        </div>
        <ConnectionProfiles
          protocol="nats"
          config={{ natsUrl, username, password, token }}
          onLoad={(saved) => {
            if (saved.natsUrl !== undefined) setNatsUrl(saved.natsUrl)
            if (saved.username !== undefined) setUsername(saved.username)
            if (saved.password !== undefined) setPassword(saved.password)
            if (saved.token !== undefined) setToken(saved.token)
          }}
        />
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-1">
            <Field label="NATS URL">
              <input value={natsUrl} onChange={e => setNatsUrl(e.target.value)} className={inputClass} placeholder="nats://localhost:4222" />
            </Field>
          </div>
          <Field label="Username">
            <input value={username} onChange={e => setUsername(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Password">
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} className={inputClass} />
          </Field>
          <div className="col-span-3">
            <Field label="Auth Token (alternative to user/pass)">
              <input value={token} onChange={e => setToken(e.target.value)} className={inputClass} type="password" />
            </Field>
          </div>
        </div>
        <div className="mt-2 flex gap-3">
          <button
            onClick={() => sendBrokerSecretToVault('NATS password', password, `NATS ${natsUrl}`)}
            disabled={!password}
            className="text-[10px] text-text-4 hover:text-accent disabled:opacity-40"
          >
            Send password to Vault
          </button>
          <button
            onClick={() => sendBrokerSecretToVault('NATS token', token, `NATS ${natsUrl}`)}
            disabled={!token}
            className="text-[10px] text-text-4 hover:text-accent disabled:opacity-40"
          >
            Send token to Vault
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        {(['publish', 'subscribe'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn('px-3 py-1.5 rounded text-xs font-semibold capitalize transition-colors',
              tab === t ? 'bg-[#a78bfa]/20 text-[#a78bfa] border border-[#a78bfa]/40' : 'text-text-3 hover:text-text-1 hover:bg-surface-2')}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'publish' && (
        <div className="rounded border border-border-1 bg-surface-1 p-3 flex flex-col gap-3">
          <Field label="Subject">
            <input value={subject} onChange={e => setSubject(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Payload">
            <textarea value={payload} onChange={e => setPayload(e.target.value)} rows={6}
              className="px-3 py-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono outline-none focus:border-accent resize-y w-full" />
          </Field>
          <div>
            <span className={labelClass}>Headers (NATS 2.2+)</span>
            <KVEditor rows={headers} onChange={setHeaders} keyPlaceholder="Nats-Header" />
          </div>
          <button onClick={() => post('/broker/nats/publish', { config: cfg, subject, payload, headers: hdrsObj })}
            disabled={loading || !natsUrl || !subject}
            className="self-start inline-flex items-center gap-2 rounded bg-[#a78bfa] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
            <Send size={13} /> {loading ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      )}

      {tab === 'subscribe' && (
        <div className="rounded border border-border-1 bg-surface-1 p-3 flex flex-col gap-3">
          <Field label="Subject / Wildcard">
            <input value={subject} onChange={e => setSubject(e.target.value)} className={inputClass} placeholder="adomnia.> or foo.*" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Max wait (s)">
              <input type="number" value={maxWait} min={1} max={30} onChange={e => setMaxWait(Number(e.target.value))} className={inputClass} />
            </Field>
            <Field label="Max messages">
              <input type="number" value={maxMsgs} min={1} max={200} onChange={e => setMaxMsgs(Number(e.target.value))} className={inputClass} />
            </Field>
          </div>
          <button onClick={() => post('/broker/nats/subscribe', { config: cfg, subject, maxWait, maxMsgs })}
            disabled={loading || !natsUrl || !subject}
            className="self-start inline-flex items-center gap-2 rounded bg-[#a78bfa] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
            <Timer size={13} /> {loading ? 'Subscribing…' : 'Subscribe'}
          </button>
        </div>
      )}

      {result && (
        <div className={cn('rounded border px-3 py-2 text-xs flex items-center gap-2',
          result.ok ? 'border-success/30 bg-success/8 text-success' : 'border-error/30 bg-error/8 text-error')}>
          {result.ok ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
          {result.ok
            ? (result.messages ? `Received ${(result.messages as unknown[]).length} messages` : `Published to subject "${subject}"`)
            : String(result.error)}
        </div>
      )}

      <PresetManager protocol="nats" content={payload} headers={headers} port={port}
        onLoad={p => { setPayload(p.content); if (p.headers) setHeaders(Object.entries(p.headers).map(([k, v]) => ({ key: k, value: v }))) }} />
    </div>
  )
}

// ─── main BrokerStudioPanel ───────────────────────────────────────────────────

export function BrokerStudioPanel() {
  const port = useServerPort()
  const [protocol, setProtocol] = useState<Protocol>('kafka')
  const [messages, setMessages] = useState<BrokerMessage[]>([])

  useEffect(() => {
    const raw = localStorage.getItem('adomnia.broker.pending')
    if (!raw) return
    try {
      const pending = JSON.parse(raw) as { protocol?: Protocol }
      if (pending.protocol && PROTOCOL_DEFS.some((def) => def.id === pending.protocol)) {
        setProtocol(pending.protocol)
      }
    } catch {
      localStorage.removeItem('adomnia.broker.pending')
    }
  }, [])

  const addMessages = useCallback((newMsgs: BrokerMessage[]) => {
    setMessages(prev => [...prev, ...newMsgs])
  }, [])

  const exportMessages = () => {
    const blob = new Blob([JSON.stringify(messages, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `broker-messages-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const activeDef = PROTOCOL_DEFS.find(p => p.id === protocol)!

  return (
    <div className="flex-1 min-h-0 overflow-hidden flex">
      {/* ── Protocol sidebar ── */}
      <div className="w-36 flex-shrink-0 border-r border-border-1 bg-surface-0 flex flex-col">
        <div className="px-3 py-3 border-b border-border-1">
          <p className="text-[9px] font-semibold uppercase tracking-widest text-text-4">Protocol</p>
        </div>
        <div className="flex-1 py-1">
          {PROTOCOL_DEFS.map(p => (
            <button key={p.id} onClick={() => setProtocol(p.id)}
              className={cn('w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors',
                protocol === p.id
                  ? 'bg-surface-2 text-text-1'
                  : 'text-text-3 hover:text-text-1 hover:bg-surface-1',
              )}>
              {protocol === p.id && (
                <span className="absolute left-0 w-[3px] h-5 rounded-r" style={{ backgroundColor: p.color }} />
              )}
              <div className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: `${p.color}22` }}>
                <Radio size={11} style={{ color: p.color }} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold leading-tight">{p.label}</p>
                <p className="text-[9px] text-text-4 leading-tight">:{p.port}</p>
              </div>
            </button>
          ))}
        </div>

        {/* message count badge */}
        <div className="px-3 py-2 border-t border-border-1">
          <div className="flex items-center gap-2 text-[10px] text-text-4">
            <List size={11} />
            <span>{messages.length} msg{messages.length !== 1 ? 's' : ''}</span>
            {messages.length > 0 && (
              <button onClick={() => setMessages([])} title="Clear all" className="ml-auto text-text-4 hover:text-error transition-colors">
                <X size={10} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-1 flex-shrink-0 bg-surface-0">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: activeDef.color }} />
              <h2 className="text-sm font-semibold text-text-1">{activeDef.label}</h2>
              <span className="text-[10px] text-text-4 font-mono">:{activeDef.port}</span>
            </div>
            <p className="text-[10px] text-text-4 mt-0.5">{activeDef.desc}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn('flex items-center gap-1.5 text-[11px]', port ? 'text-success' : 'text-error')}>
              <span className={cn('w-1.5 h-1.5 rounded-full', port ? 'bg-success' : 'bg-error')} />
              {port ? `Backend :${port}` : 'Backend offline'}
            </span>
          </div>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-[1fr_320px]">
          {/* left: protocol panels */}
          <div className="overflow-y-auto p-5 border-r border-border-1">
            {protocol === 'kafka'    && <KafkaPanel embedded onMessages={addMessages} />}
            {protocol === 'rabbitmq' && <RabbitMQPanel port={port} onMessages={addMessages} />}
            {protocol === 'mqtt'     && <MQTTPanel     port={port} onMessages={addMessages} />}
            {protocol === 'redis'    && <RedisPanel    port={port} onMessages={addMessages} />}
            {protocol === 'nats'     && <NATSPanel     port={port} onMessages={addMessages} />}
          </div>

          {/* right: message log */}
          <div className="flex flex-col min-h-0 bg-surface-0">
            <MessageLog
              messages={messages}
              onClear={() => setMessages([])}
              onRemove={id => setMessages(prev => prev.filter(m => m.id !== id))}
              onExport={exportMessages}
            />

            {/* local credential scope */}
            <div className="px-3 py-2 border-t border-border-1 flex items-center gap-2 text-[10px] text-text-4">
              <Lock size={10} />
              <span>Connection profiles, including credentials, stay in local storage only. Use Vault for managed secret reuse.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
