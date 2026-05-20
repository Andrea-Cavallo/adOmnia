import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  CheckCircle2,
  Database,
  KeyRound,
  ListTree,
  Lock,
  Plus,
  Radio,
  Send,
  ShieldCheck,
  Timer,
  Trash2,
} from 'lucide-react'
import { useServerPort, serverUrl } from '@/lib/useServerPort'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app'

type Tab = 'produce' | 'bulk' | 'consume' | 'topics'

interface BrokerConfig {
  brokers: string
  topic: string
  groupId: string
  clientId: string
  tls: boolean
  saslEnabled: boolean
  saslMechanism: string
  saslUsername: string
  saslPassword: string
}

interface KVRow {
  key: string
  value: string
}

interface KafkaMessage {
  key?: string
  value?: string
  partition?: number
  offset?: number
  timestamp?: string
  headers?: Record<string, string>
}

interface KafkaResult {
  ok?: boolean
  error?: string
  topic?: string
  partition?: number
  offset?: number
  timestamp?: string
  count?: number
  successes?: number
  failures?: number
  totalMs?: number
  throughput?: number
  lastPartition?: number
  lastOffset?: number
  messages?: KafkaMessage[]
  topics?: string[]
  brokers?: Array<{ id?: number; addr?: string }>
}

const mechanisms = ['PLAIN', 'SCRAM-SHA-256', 'SCRAM-SHA-512']

function sendKafkaSecretToVault(name: string, value: string, note: string) {
  if (!value) return
  localStorage.setItem('adomnia.vault.pendingSecret', JSON.stringify({ name, value, note }))
  useAppStore.getState().setActiveRail('vault')
}

const inputClass = 'h-8 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none focus:border-accent'
const labelClass = 'text-[10px] text-text-4 uppercase tracking-wider'

function HeadersEditor({ rows, onChange }: { rows: KVRow[]; onChange: (rows: KVRow[]) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((row, index) => (
        <div key={index} className="grid grid-cols-[160px_1fr_24px] gap-1.5">
          <input
            value={row.key}
            onChange={(e) => onChange(rows.map((r, i) => i === index ? { ...r, key: e.target.value } : r))}
            placeholder="header"
            className={cn(inputClass, 'h-7 font-mono')}
          />
          <input
            value={row.value}
            onChange={(e) => onChange(rows.map((r, i) => i === index ? { ...r, value: e.target.value } : r))}
            placeholder="value"
            className={cn(inputClass, 'h-7 font-mono')}
          />
          <button onClick={() => onChange(rows.filter((_, i) => i !== index))} className="grid place-items-center text-text-4 hover:text-error">
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <button onClick={() => onChange([...rows, { key: '', value: '' }])} className="self-start inline-flex items-center gap-1 text-[11px] text-accent hover:text-accent/80">
        <Plus size={12} /> Add header
      </button>
    </div>
  )
}

function InfoPill({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded border border-border-1 bg-surface-1 px-3 py-2">
      <Icon size={14} className="shrink-0 text-accent" />
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-text-4">{label}</p>
        <p className="truncate text-xs font-semibold text-text-1">{value}</p>
      </div>
    </div>
  )
}

function BackendContract() {
  const rows = [
    ['/kafka/produce', 'Single message', 'key, value, headers, optional partition'],
    ['/kafka/bulk-produce', 'Bulk producer', 'count capped at 10,000, optional delay and JSON vary field'],
    ['/kafka/consume', 'Consumer group', 'maxWait capped at 30s, maxMsgs capped at 100'],
    ['/kafka/topics', 'Discovery', 'topic list plus broker id/address metadata'],
  ]

  return (
    <div className="rounded border border-border-1 bg-surface-1 p-3">
      <div className="mb-3 flex items-center gap-2">
        <Database size={14} className="text-accent" />
        <h3 className="text-xs font-semibold text-text-1">Backend contract</h3>
      </div>
      <div className="space-y-2">
        {rows.map(([path, title, detail]) => (
          <div key={path} className="rounded border border-border-1 bg-surface-0 px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[11px] text-accent-light">{path}</span>
              <span className="shrink-0 text-[11px] font-semibold text-text-2">{title}</span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-text-4">{detail}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function ResultPanel({ result }: { result: KafkaResult | null }) {
  if (!result) {
    return (
      <div className="flex min-h-[220px] flex-col items-center justify-center rounded border border-dashed border-border-2 bg-surface-1/60 text-center">
        <Radio size={22} className="mb-2 text-text-4" />
        <p className="text-xs font-semibold text-text-2">No Kafka response yet</p>
        <p className="mt-1 text-[11px] text-text-4">Run produce, consume, or topic discovery to inspect backend output here.</p>
      </div>
    )
  }

  return (
    <div className="rounded border border-border-1 bg-surface-1">
      <div className="flex items-center justify-between border-b border-border-1 px-3 py-2">
        <div className="flex items-center gap-2">
          <CheckCircle2 size={14} className={result.ok === false ? 'text-error' : 'text-success'} />
          <span className="text-xs font-semibold text-text-1">{result.ok === false ? 'Request failed' : 'Backend response'}</span>
        </div>
        {result.topic && <span className="font-mono text-[11px] text-text-4">{result.topic}</span>}
      </div>

      {(result.offset !== undefined || result.partition !== undefined || result.successes !== undefined || result.count !== undefined) && (
        <div className="grid grid-cols-4 gap-2 border-b border-border-1 p-3">
          <InfoPill icon={ListTree} label="Partition" value={String(result.partition ?? result.lastPartition ?? '-')} />
          <InfoPill icon={Activity} label="Offset" value={String(result.offset ?? result.lastOffset ?? '-')} />
          <InfoPill icon={Send} label="Success" value={String(result.successes ?? result.count ?? '-')} />
          <InfoPill icon={Timer} label="Throughput" value={result.throughput !== undefined ? `${result.throughput}/s` : '-'} />
        </div>
      )}

      {result.topics && (
        <div className="grid grid-cols-[1fr_260px] gap-3 p-3">
          <div>
            <p className={labelClass}>Topics</p>
            <div className="mt-2 max-h-52 overflow-auto rounded border border-border-1 bg-surface-0">
              {result.topics.map((topic) => (
                <div key={topic} className="border-b border-border-1/50 px-3 py-2 font-mono text-xs text-text-1 last:border-b-0">{topic}</div>
              ))}
            </div>
          </div>
          <div>
            <p className={labelClass}>Brokers</p>
            <div className="mt-2 max-h-52 overflow-auto rounded border border-border-1 bg-surface-0">
              {(result.brokers ?? []).map((broker) => (
                <div key={`${broker.id}-${broker.addr}`} className="border-b border-border-1/50 px-3 py-2 text-xs last:border-b-0">
                  <span className="font-mono text-accent-light">{broker.id ?? '-'}</span>
                  <span className="ml-3 font-mono text-text-3">{broker.addr}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {result.messages && (
        <div className="p-3">
          <p className={labelClass}>Messages</p>
          <div className="mt-2 max-h-72 overflow-auto rounded border border-border-1 bg-surface-0">
            {result.messages.length === 0 ? (
              <p className="px-3 py-4 text-xs text-text-4">No messages received before timeout.</p>
            ) : result.messages.map((message, index) => (
              <div key={`${message.partition}-${message.offset}-${index}`} className="grid grid-cols-[64px_90px_1fr] gap-3 border-b border-border-1/50 px-3 py-2 text-xs last:border-b-0">
                <span className="font-mono text-accent-light">p{message.partition ?? '-'}</span>
                <span className="font-mono text-text-4">@{message.offset ?? '-'}</span>
                <div className="min-w-0">
                  <p className="truncate font-mono text-text-1">{message.key || '(no key)'}</p>
                  <p className="mt-1 whitespace-pre-wrap break-words font-mono text-text-3">{message.value}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <details className="border-t border-border-1">
        <summary className="cursor-pointer px-3 py-2 text-[11px] text-text-4 hover:text-text-2">Raw JSON</summary>
        <pre className="max-h-72 overflow-auto px-3 pb-3 text-xs text-text-2 font-mono whitespace-pre-wrap">
          {JSON.stringify(result, null, 2)}
        </pre>
      </details>
    </div>
  )
}

interface BrokerMessage {
  id: string
  timestamp: string
  topic: string
  content: string
  headers?: Record<string, string>
  metadata?: Record<string, string>
}

export function KafkaPanel({ onMessages }: { onMessages?: (msgs: BrokerMessage[]) => void }) {
  const port = useServerPort()
  const [tab, setTab] = useState<Tab>('produce')
  const [cfg, setCfg] = useState<BrokerConfig>({
    brokers: 'localhost:19092',
    topic: 'adomnia.lab.events',
    groupId: 'adomnia-lab-group',
    clientId: 'adomnia-ui',
    tls: false,
    saslEnabled: false,
    saslMechanism: 'PLAIN',
    saslUsername: '',
    saslPassword: '',
  })
  const [key, setKey] = useState('order-created')
  const [value, setValue] = useState('{\n  "event": "order.created",\n  "sequence": 1,\n  "source": "adomnia"\n}')
  const [headers, setHeaders] = useState<KVRow[]>([{ key: 'content-type', value: 'application/json' }])
  const [partition, setPartition] = useState('')
  const [bulkCount, setBulkCount] = useState(10)
  const [bulkDelayMs, setBulkDelayMs] = useState(0)
  const [bulkVaryField, setBulkVaryField] = useState('sequence')
  const [maxWait, setMaxWait] = useState(5)
  const [maxMsgs, setMaxMsgs] = useState(10)
  const [fromStart, setFromStart] = useState(false)
  const [result, setResult] = useState<KafkaResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const raw = localStorage.getItem('adomnia.broker.pending')
    if (!raw) return
    try {
      const pending = JSON.parse(raw) as { protocol?: string; kafka?: Partial<BrokerConfig> }
      if (pending.protocol !== 'kafka' || !pending.kafka) return
      setCfg((current) => ({ ...current, ...pending.kafka }))
      localStorage.removeItem('adomnia.broker.pending')
    } catch {
      localStorage.removeItem('adomnia.broker.pending')
    }
  }, [])

  const brokers = useMemo(() => cfg.brokers.split(',').map((b) => b.trim()).filter(Boolean), [cfg.brokers])
  const headerPayload = useMemo(() => Object.fromEntries(headers.filter((h) => h.key).map((h) => [h.key, h.value])), [headers])

  const configPayload = {
    brokers,
    topic: cfg.topic,
    groupId: cfg.groupId || undefined,
    clientId: cfg.clientId || undefined,
    tls: cfg.tls,
    sasl: cfg.saslEnabled ? {
      enabled: true,
      mechanism: cfg.saslMechanism,
      username: cfg.saslUsername,
      password: cfg.saslPassword,
    } : undefined,
  }

  const producePayload = {
    config: configPayload,
    key,
    value,
    headers: headerPayload,
    partition: partition === '' ? undefined : Number(partition),
  }

  const post = async (path: string, body: unknown) => {
    const url = serverUrl(port, path)
    if (!url) {
      setError('Backend not ready')
      return
    }
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json() as KafkaResult
      setResult(data)
      if (!res.ok || data.ok === false) {
        setError(data.error || 'Request failed')
      } else if (path === '/kafka/consume' && data.messages?.length && onMessages) {
        const topic = (body as { config?: { topic?: string } }).config?.topic ?? 'kafka'
        onMessages(data.messages.map(m => ({
          id: crypto.randomUUID(),
          timestamp: m.timestamp ?? new Date().toISOString(),
          topic,
          content: m.value ?? '',
          headers: m.headers,
          metadata: {
            partition: String(m.partition ?? ''),
            offset: String(m.offset ?? ''),
            key: m.key ?? '',
          },
        })))
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const tabClass = (item: Tab) =>
    cn(
      'inline-flex items-center gap-2 rounded px-3 py-2 text-xs font-semibold transition-colors',
      tab === item ? 'bg-accent text-white' : 'text-text-3 hover:bg-surface-2 hover:text-text-1'
    )

  return (
    <div className="flex-1 min-h-0 overflow-auto bg-surface-0">
      <div className="grid min-h-full grid-cols-[minmax(620px,1fr)_420px]">
        <section className="min-w-0 p-5">
          <div className="mb-5 flex items-center justify-between border-b border-border-1 pb-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-accent">PUB / SUB</p>
              <h2 className="mt-1 text-lg font-semibold text-text-1">Kafka Workbench</h2>
              <p className="mt-1 text-xs text-text-4">Produce, bulk produce, consume with groups, and inspect topics through the local backend.</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={cn('h-2 w-2 rounded-full', port ? 'bg-success' : 'bg-error')} />
              <span className="text-[11px] text-text-4">{port ? `Backend :${port}` : 'Backend offline'}</span>
            </div>
          </div>

          <div className="mb-4 grid grid-cols-4 gap-2">
            <InfoPill icon={Database} label="Brokers" value={brokers.length ? brokers.join(', ') : 'required'} />
            <InfoPill icon={ListTree} label="Topic" value={cfg.topic || 'required'} />
            <InfoPill icon={KeyRound} label="Group" value={cfg.groupId || 'ephemeral'} />
            <InfoPill icon={ShieldCheck} label="Security" value={`${cfg.tls ? 'TLS' : 'PLAINTEXT'} / ${cfg.saslEnabled ? cfg.saslMechanism : 'NO SASL'}`} />
          </div>

          <div className="rounded border border-border-1 bg-surface-1 p-3">
            <div className="mb-3 flex items-center gap-2">
              <Radio size={14} className="text-accent" />
              <h3 className="text-xs font-semibold text-text-1">Connection</h3>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Brokers</span>
                <input value={cfg.brokers} onChange={(e) => setCfg({ ...cfg, brokers: e.target.value })} className={inputClass} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Topic</span>
                <input value={cfg.topic} onChange={(e) => setCfg({ ...cfg, topic: e.target.value })} className={inputClass} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Group ID</span>
                <input value={cfg.groupId} onChange={(e) => setCfg({ ...cfg, groupId: e.target.value })} className={inputClass} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Client ID</span>
                <input value={cfg.clientId} onChange={(e) => setCfg({ ...cfg, clientId: e.target.value })} className={inputClass} />
              </label>
            </div>

            <div className="mt-3 grid grid-cols-[120px_120px_150px_1fr_1fr] gap-3">
              <label className="flex items-center gap-2 rounded border border-border-2 bg-surface-2 px-2 text-xs text-text-2">
                <input type="checkbox" checked={cfg.tls} onChange={(e) => setCfg({ ...cfg, tls: e.target.checked })} className="accent-accent" />
                TLS
              </label>
              <label className="flex items-center gap-2 rounded border border-border-2 bg-surface-2 px-2 text-xs text-text-2">
                <input type="checkbox" checked={cfg.saslEnabled} onChange={(e) => setCfg({ ...cfg, saslEnabled: e.target.checked })} className="accent-accent" />
                SASL
              </label>
              <select value={cfg.saslMechanism} disabled={!cfg.saslEnabled} onChange={(e) => setCfg({ ...cfg, saslMechanism: e.target.value })} className={cn(inputClass, !cfg.saslEnabled && 'opacity-50')}>
                {mechanisms.map((item) => <option key={item}>{item}</option>)}
              </select>
              <input value={cfg.saslUsername} disabled={!cfg.saslEnabled} onChange={(e) => setCfg({ ...cfg, saslUsername: e.target.value })} placeholder="username" className={cn(inputClass, !cfg.saslEnabled && 'opacity-50')} />
              <input type="password" value={cfg.saslPassword} disabled={!cfg.saslEnabled} onChange={(e) => setCfg({ ...cfg, saslPassword: e.target.value })} placeholder="password" className={cn(inputClass, !cfg.saslEnabled && 'opacity-50')} />
            </div>
            <button
              onClick={() => sendKafkaSecretToVault('Kafka SASL password', cfg.saslPassword, `Kafka brokers ${cfg.brokers}`)}
              disabled={!cfg.saslEnabled || !cfg.saslPassword}
              className="mt-2 text-[10px] text-text-4 hover:text-accent disabled:opacity-40"
            >
              Send SASL password to Vault
            </button>
          </div>

          <div className="my-4 flex gap-2">
            <button className={tabClass('produce')} onClick={() => setTab('produce')}><Send size={14} /> Produce</button>
            <button className={tabClass('bulk')} onClick={() => setTab('bulk')}><Activity size={14} /> Bulk</button>
            <button className={tabClass('consume')} onClick={() => setTab('consume')}><Timer size={14} /> Consume</button>
            <button className={tabClass('topics')} onClick={() => setTab('topics')}><ListTree size={14} /> Topics</button>
          </div>

          {(tab === 'produce' || tab === 'bulk') && (
            <div className="rounded border border-border-1 bg-surface-1 p-3">
              <div className="grid grid-cols-[1fr_140px] gap-3">
                <label className="flex flex-col gap-1">
                  <span className={labelClass}>Message key</span>
                  <input value={key} onChange={(e) => setKey(e.target.value)} className={inputClass} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={labelClass}>Partition</span>
                  <input value={partition} onChange={(e) => setPartition(e.target.value)} placeholder="optional" className={inputClass} />
                </label>
              </div>
              <label className="mt-3 flex flex-col gap-1">
                <span className={labelClass}>Value</span>
                <textarea value={value} onChange={(e) => setValue(e.target.value)} rows={8} className="px-3 py-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono outline-none focus:border-accent resize-y" />
              </label>
              <div className="mt-3">
                <span className={labelClass}>Headers</span>
                <div className="mt-1">
                  <HeadersEditor rows={headers} onChange={setHeaders} />
                </div>
              </div>

              {tab === 'bulk' && (
                <div className="mt-3 grid grid-cols-3 gap-3 border-t border-border-1 pt-3">
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>Count</span>
                    <input type="number" value={bulkCount} min={1} max={10000} onChange={(e) => setBulkCount(Number(e.target.value))} className={inputClass} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>Delay ms</span>
                    <input type="number" value={bulkDelayMs} min={0} onChange={(e) => setBulkDelayMs(Number(e.target.value))} className={inputClass} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>JSON vary field</span>
                    <input value={bulkVaryField} onChange={(e) => setBulkVaryField(e.target.value)} className={inputClass} />
                  </label>
                </div>
              )}

              <button
                onClick={() => tab === 'bulk'
                  ? post('/kafka/bulk-produce', { ...producePayload, count: bulkCount, delayMs: bulkDelayMs, varyField: bulkVaryField })
                  : post('/kafka/produce', producePayload)}
                disabled={loading || !cfg.topic || brokers.length === 0}
                className="mt-4 inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                <Send size={14} /> {loading ? 'Sending...' : tab === 'bulk' ? 'Bulk Produce' : 'Produce'}
              </button>
            </div>
          )}

          {tab === 'consume' && (
            <div className="rounded border border-border-1 bg-surface-1 p-3">
              <div className="grid grid-cols-[140px_140px_1fr] gap-3">
                <label className="flex flex-col gap-1">
                  <span className={labelClass}>Max wait seconds</span>
                  <input type="number" value={maxWait} min={1} max={30} onChange={(e) => setMaxWait(Number(e.target.value))} className={inputClass} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={labelClass}>Max messages</span>
                  <input type="number" value={maxMsgs} min={1} max={100} onChange={(e) => setMaxMsgs(Number(e.target.value))} className={inputClass} />
                </label>
                <label className="flex items-end gap-2 pb-2 text-xs text-text-2">
                  <input type="checkbox" checked={fromStart} onChange={(e) => setFromStart(e.target.checked)} className="accent-accent" />
                  Consume from beginning when group has no committed offset
                </label>
              </div>
              <button onClick={() => post('/kafka/consume', { config: configPayload, maxWait, maxMsgs, fromStart })} disabled={loading || !cfg.topic || brokers.length === 0} className="mt-4 inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
                <Timer size={14} /> {loading ? 'Consuming...' : 'Consume'}
              </button>
            </div>
          )}

          {tab === 'topics' && (
            <div className="rounded border border-border-1 bg-surface-1 p-3">
              <p className="text-xs text-text-3">Uses Sarama client discovery and returns every topic plus broker id/address metadata.</p>
              <button onClick={() => post('/kafka/topics', configPayload)} disabled={loading || brokers.length === 0} className="mt-4 inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
                <ListTree size={14} /> {loading ? 'Loading...' : 'List Topics'}
              </button>
            </div>
          )}
        </section>

        <aside className="border-l border-border-1 bg-surface-0 p-5">
          <BackendContract />

          <div className="mt-4 rounded border border-border-1 bg-surface-1 p-3">
            <div className="mb-3 flex items-center gap-2">
              <Lock size={14} className="text-accent" />
              <h3 className="text-xs font-semibold text-text-1">Security mapping</h3>
            </div>
            <div className="space-y-2 text-[11px] text-text-4">
              <p><span className="font-mono text-text-2">tls</span> enables Sarama TLS transport.</p>
              <p><span className="font-mono text-text-2">sasl.mechanism</span> supports PLAIN, SCRAM-SHA-256, SCRAM-SHA-512.</p>
              <p><span className="font-mono text-text-2">clientId</span> is sent to Kafka for broker-side logs and quotas.</p>
            </div>
          </div>

          {error && <div className="mt-4 rounded border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">{error}</div>}

          <div className="mt-4">
            <ResultPanel result={result} />
          </div>
        </aside>
      </div>
    </div>
  )
}
