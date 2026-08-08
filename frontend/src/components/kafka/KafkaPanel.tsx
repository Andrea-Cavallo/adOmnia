import { useEffect, useMemo, useState } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  Eye,
  Gauge,
  KeyRound,
  Layers,
  ListTree,
  Lock,
  Pencil,
  Plus,
  Radio,
  RefreshCcw,
  Search,
  Send,
  Settings,
  Split,
  Timer,
  Trash2,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useServerPort, serverUrl, sidecarFetch } from '@/lib/useServerPort'
import { confirm } from '@/lib/confirmDialog'
import { cn } from '@/lib/utils'
import { resolveBrokerPayload } from '@/lib/brokerConnections'
import { ConnectionProfiles } from './ConnectionProfiles'

type Tab = 'overview' | 'topics' | 'groups' | 'messages' | 'produce' | 'load'
type ProduceMode = 'single' | 'bulk'

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

interface KafkaBaseResult {
  ok?: boolean
  error?: string
}

interface KafkaResult extends KafkaBaseResult {
  topic?: string
  partition?: number
  offset?: number
  count?: number
  successes?: number
  failures?: number
  totalMessages?: number
  throughput?: number
  avgMs?: number
  p50Ms?: number
  p95Ms?: number
  p99Ms?: number
  errorRate?: number
  lastPartition?: number
  lastOffset?: number
  messages?: KafkaMessage[]
  topics?: string[]
  brokers?: Array<{ id?: number; addr?: string; controller?: boolean }>
}

interface ClusterOverview extends KafkaBaseResult {
  health?: 'healthy' | 'degraded' | 'critical'
  controllerId?: number
  brokerCount?: number
  topicCount?: number
  internalTopicCount?: number
  partitionCount?: number
  underReplicated?: number
  offlinePartitions?: number
  brokers?: Array<{ id?: number; addr?: string; controller?: boolean }>
  topics?: string[]
}

interface TopicPartition {
  id: number
  leader: number
  replicas: number[]
  isr: number[]
  offlineReplicas?: number[]
  oldestOffset: number
  latestOffset: number
  messages: number
}

interface TopicConfig {
  name: string
  value: string
  readOnly: boolean
  default: boolean
  source: string
  sensitive: boolean
}

interface TopicDetail extends KafkaBaseResult {
  topic?: string
  isInternal?: boolean
  partitions?: TopicPartition[]
  configs?: TopicConfig[]
}

interface ConsumerGroupPartition {
  topic: string
  partition: number
  offset: number
  latestOffset: number
  lag: number
  metadata?: string
  error?: string
}

interface ConsumerGroupMember {
  memberId: string
  clientId: string
  clientHost: string
  assignments?: Record<string, number[]>
}

interface ConsumerGroupInfo {
  groupId: string
  state: string
  protocol?: string
  memberCount: number
  totalLag: number
  members: ConsumerGroupMember[]
  partitions: ConsumerGroupPartition[]
}

interface ConsumerGroupsResult extends KafkaBaseResult {
  groups?: ConsumerGroupInfo[]
}

interface BrokerMessage {
  id: string
  timestamp: string
  topic: string
  content: string
  headers?: Record<string, string>
  metadata?: Record<string, string>
}

const mechanisms = ['PLAIN', 'SCRAM-SHA-256', 'SCRAM-SHA-512']
const inputClass = 'h-8 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none focus:border-accent'
const textAreaClass = 'px-3 py-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono outline-none focus:border-accent resize-y'
const labelClass = 'text-[10px] text-text-4 uppercase tracking-wider'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  )
}

function Metric({ icon: Icon, label, value, tone = 'default' }: { icon: LucideIcon; label: string; value: string; tone?: 'default' | 'good' | 'warn' | 'bad' }) {
  return (
    <div className="min-w-0 rounded border border-border-1 bg-surface-1 px-3 py-2">
      <div className="flex items-center gap-2">
        <Icon size={14} className={cn(tone === 'good' && 'text-success', tone === 'warn' && 'text-warning', tone === 'bad' && 'text-error', tone === 'default' && 'text-accent')} />
        <span className="text-[10px] uppercase tracking-wider text-text-4">{label}</span>
      </div>
      <p className="mt-1 truncate text-sm font-semibold text-text-1">{value}</p>
    </div>
  )
}

function HeadersEditor({ rows, onChange }: { rows: KVRow[]; onChange: (rows: KVRow[]) => void }) {
  return (
    <div className="space-y-1.5">
      {rows.map((row, index) => (
        <div key={index} className="grid grid-cols-[150px_1fr_26px] gap-1.5">
          <input value={row.key} onChange={(event) => onChange(rows.map((r, i) => i === index ? { ...r, key: event.target.value } : r))} className={cn(inputClass, 'h-7 font-mono')} placeholder="header" />
          <input value={row.value} onChange={(event) => onChange(rows.map((r, i) => i === index ? { ...r, value: event.target.value } : r))} className={cn(inputClass, 'h-7 font-mono')} placeholder="value" />
          <button type="button" onClick={() => onChange(rows.filter((_, i) => i !== index))} title="Remove header" className="grid place-items-center text-text-4 hover:text-error">
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rows, { key: '', value: '' }])} className="inline-flex items-center gap-1 text-[11px] text-accent hover:text-accent/80">
        <Plus size={12} /> Add header
      </button>
    </div>
  )
}

function JsonResult({ result }: { result: unknown }) {
  if (!result) {
    return (
      <div className="flex min-h-[220px] flex-col items-center justify-center rounded border border-dashed border-border-2 bg-surface-1/60 text-center">
        <Radio size={22} className="mb-2 text-text-4" />
        <p className="text-xs font-semibold text-text-2">No Kafka response yet</p>
        <p className="mt-1 text-[11px] text-text-4">Run an action to inspect the raw backend output.</p>
      </div>
    )
  }
  return (
    <pre className="max-h-[calc(100vh-190px)] overflow-auto rounded border border-border-1 bg-surface-1 p-3 text-xs font-mono text-text-2 whitespace-pre-wrap">
      {JSON.stringify(result, null, 2)}
    </pre>
  )
}

export function KafkaPanel({
  onMessages,
  embedded = false,
}: {
  onMessages?: (msgs: BrokerMessage[]) => void
  embedded?: boolean
}) {
  const port = useServerPort()
  const [tab, setTab] = useState<Tab>('overview')
  const [produceMode, setProduceMode] = useState<ProduceMode>('single')
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
  const [varyField, setVaryField] = useState('sequence')
  const [loadConcurrency, setLoadConcurrency] = useState(8)
  const [loadTotalMsgs, setLoadTotalMsgs] = useState(1000)
  const [loadUseDuration, setLoadUseDuration] = useState(false)
  const [loadDurationS, setLoadDurationS] = useState(15)
  const [loadRampUpMs, setLoadRampUpMs] = useState(1000)
  const [maxWait, setMaxWait] = useState(5)
  const [maxMsgs, setMaxMsgs] = useState(25)
  const [fromStart, setFromStart] = useState(false)

  const [overview, setOverview] = useState<ClusterOverview | null>(null)
  const [topicsResult, setTopicsResult] = useState<KafkaResult | null>(null)
  const [topicDetail, setTopicDetail] = useState<TopicDetail | null>(null)
  const [topicFilter, setTopicFilter] = useState('')
  const [newTopic, setNewTopic] = useState('')
  const [newPartitions, setNewPartitions] = useState(3)
  const [newReplication, setNewReplication] = useState(1)
  const [configRows, setConfigRows] = useState<KVRow[]>([{ key: 'retention.ms', value: '604800000' }])
  const [deleteConfigName, setDeleteConfigName] = useState('')
  const [groupResult, setGroupResult] = useState<ConsumerGroupsResult | null>(null)
  const [selectedGroup, setSelectedGroup] = useState('')
  const [resetMode, setResetMode] = useState('latest')
  const [resetOffset, setResetOffset] = useState(0)
  const [browsePartition, setBrowsePartition] = useState('')
  const [browseOffset, setBrowseOffset] = useState('')
  const [browseTimestamp, setBrowseTimestamp] = useState('')
  const [tail, setTail] = useState(false)
  const [keyFilter, setKeyFilter] = useState('')
  const [valueFilter, setValueFilter] = useState('')
  const [headerKeyFilter, setHeaderKeyFilter] = useState('')
  const [headerValueFilter, setHeaderValueFilter] = useState('')
  const [browseResult, setBrowseResult] = useState<KafkaResult | null>(null)
  const [actionResult, setActionResult] = useState<unknown>(null)
  const [loading, setLoading] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const raw = sessionStorage.getItem('adomnia.broker.pending') ?? localStorage.getItem('adomnia.broker.pending')
    if (!raw) return
    try {
      const pending = JSON.parse(raw) as { protocol?: string; kafka?: Partial<BrokerConfig> }
      if (pending.protocol !== 'kafka' || !pending.kafka) return
      setCfg((current) => ({ ...current, ...pending.kafka }))
      sessionStorage.removeItem('adomnia.broker.pending')
      localStorage.removeItem('adomnia.broker.pending')
    } catch {
      sessionStorage.removeItem('adomnia.broker.pending')
      localStorage.removeItem('adomnia.broker.pending')
    }
  }, [])

  const brokers = useMemo(() => cfg.brokers.split(',').map((broker) => broker.trim()).filter(Boolean), [cfg.brokers])
  const headerPayload = useMemo(() => Object.fromEntries(headers.filter((header) => header.key).map((header) => [header.key, header.value])), [headers])
  const configPayload = useMemo(() => ({
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
  }), [brokers, cfg])
  const producePayload = useMemo(() => ({
    config: configPayload,
    key,
    value,
    headers: headerPayload,
    partition: partition === '' ? undefined : Number(partition),
  }), [configPayload, headerPayload, key, partition, value])
  const filteredTopics = useMemo(() => (topicsResult?.topics ?? overview?.topics ?? []).filter((topic) => topic.toLowerCase().includes(topicFilter.toLowerCase())), [overview?.topics, topicFilter, topicsResult?.topics])
  const selectedGroupInfo = useMemo(() => groupResult?.groups?.find((group) => group.groupId === selectedGroup) ?? groupResult?.groups?.[0], [groupResult?.groups, selectedGroup])

  const post = async <T extends KafkaBaseResult>(path: string, body: unknown, label: string): Promise<T | null> => {
    const url = serverUrl(port, path)
    if (!url) {
      setError('Backend not ready')
      return null
    }
    setLoading(label)
    setError('')
    try {
      const response = await sidecarFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(await resolveBrokerPayload(body)),
      })
      const data = await response.json() as T
      setActionResult(data)
      if (!response.ok || data.ok === false) {
        setError(data.error || 'Request failed')
      }
      return data
    } catch (err) {
      setError(String(err))
      return null
    } finally {
      setLoading('')
    }
  }

  const refreshOverview = async () => {
    const data = await post<ClusterOverview>('/kafka/cluster-overview', { config: configPayload }, 'overview')
    if (data?.ok) setOverview(data)
  }

  const listTopics = async () => {
    const data = await post<KafkaResult>('/kafka/topics', configPayload, 'topics')
    if (data?.ok) setTopicsResult(data)
  }

  const loadTopicDetail = async (topic = cfg.topic) => {
    if (!topic) return
    setCfg((current) => ({ ...current, topic }))
    const data = await post<TopicDetail>('/kafka/topic-detail', { config: configPayload, topic }, 'topic-detail')
    if (data?.ok) setTopicDetail(data)
  }

  const createTopic = async () => {
    const name = newTopic.trim()
    if (!name) return
    const configs = Object.fromEntries(configRows.filter((row) => row.key && row.value).map((row) => [row.key, row.value]))
    const data = await post<KafkaResult>('/kafka/topic-create', {
      config: configPayload,
      topic: name,
      partitions: newPartitions,
      replicationFactor: newReplication,
      configs,
    }, 'topic-create')
    if (data?.ok) {
      setCfg((current) => ({ ...current, topic: name }))
      setNewTopic('')
      await listTopics()
      await loadTopicDetail(name)
    }
  }

  const updateTopic = async () => {
    const configs = Object.fromEntries(configRows.filter((row) => row.key && row.value).map((row) => [row.key, row.value]))
    const deleteConfigs = deleteConfigName.trim() ? [deleteConfigName.trim()] : []
    const data = await post<KafkaResult>('/kafka/topic-update', { config: configPayload, topic: cfg.topic, configs, deleteConfigs }, 'topic-update')
    if (data?.ok) await loadTopicDetail(cfg.topic)
  }

  const deleteTopic = async () => {
    if (!cfg.topic) return
    const ok = await confirm({
      title: 'Delete topic',
      message: `Delete topic "${cfg.topic}"? This cannot be undone from adOmnia.`,
      confirmLabel: 'Delete topic',
      variant: 'danger',
    })
    if (!ok) return
    const data = await post<KafkaResult>('/kafka/topic-delete', { config: configPayload, topic: cfg.topic }, 'topic-delete')
    if (data?.ok) {
      setTopicDetail(null)
      await listTopics()
    }
  }

  const listGroups = async () => {
    const data = await post<ConsumerGroupsResult>('/kafka/consumer-groups', { config: configPayload, topic: cfg.topic }, 'groups')
    if (data?.ok) {
      setGroupResult(data)
      setSelectedGroup((current) => current || data.groups?.[0]?.groupId || '')
    }
  }

  const resetGroupOffset = async (partitionId: number) => {
    const groupId = selectedGroupInfo?.groupId
    if (!groupId || !cfg.topic) return
    const body = { config: configPayload, group: groupId, topic: cfg.topic, partition: partitionId, mode: resetMode, offset: resetOffset }
    const data = await post<KafkaResult>('/kafka/reset-offset', body, 'reset-offset')
    if (data?.ok) await listGroups()
  }

  const browseMessages = async () => {
    const timestampMs = browseTimestamp ? new Date(browseTimestamp).getTime() : undefined
    const data = await post<KafkaResult>('/kafka/browse', {
      config: configPayload,
      topic: cfg.topic,
      partition: browsePartition === '' ? undefined : Number(browsePartition),
      offset: browseOffset === '' ? undefined : Number(browseOffset),
      timestampMs: Number.isFinite(timestampMs) ? timestampMs : undefined,
      maxMsgs,
      maxWait,
      tail,
      keyContains: keyFilter || undefined,
      valueContains: valueFilter || undefined,
      headerKey: headerKeyFilter || undefined,
      headerValue: headerValueFilter || undefined,
    }, 'browse')
    if (data?.ok) {
      setBrowseResult(data)
      if (data.messages?.length && onMessages) {
        onMessages(data.messages.map((message) => ({
          id: crypto.randomUUID(),
          timestamp: message.timestamp ?? new Date().toISOString(),
          topic: cfg.topic,
          content: message.value ?? '',
          headers: message.headers,
          metadata: {
            partition: String(message.partition ?? ''),
            offset: String(message.offset ?? ''),
            key: message.key ?? '',
          },
        })))
      }
    }
  }

  const runProduce = async () => {
    const path = produceMode === 'bulk' ? '/kafka/bulk-produce' : '/kafka/produce'
    const body = produceMode === 'bulk' ? { ...producePayload, count: bulkCount, delayMs: bulkDelayMs, varyField } : producePayload
    await post<KafkaResult>(path, body, 'produce')
  }

  const runLoad = async () => {
    await post<KafkaResult>('/kafka/loadtest', {
      ...producePayload,
      concurrency: loadConcurrency,
      totalMsgs: loadUseDuration ? undefined : loadTotalMsgs,
      durationS: loadUseDuration ? loadDurationS : undefined,
      rampUpMs: loadRampUpMs,
      varyField,
    }, 'load')
  }

  const runConsume = async () => {
    const data = await post<KafkaResult>('/kafka/consume', { config: configPayload, maxWait, maxMsgs, fromStart }, 'consume')
    if (data?.messages?.length && onMessages) {
      onMessages(data.messages.map((message) => ({
        id: crypto.randomUUID(),
        timestamp: message.timestamp ?? new Date().toISOString(),
        topic: cfg.topic,
        content: message.value ?? '',
        headers: message.headers,
        metadata: {
          partition: String(message.partition ?? ''),
          offset: String(message.offset ?? ''),
          key: message.key ?? '',
        },
      })))
    }
  }

  const tabClass = (item: Tab) => cn(
    'inline-flex items-center gap-2 rounded px-3 py-2 text-xs font-semibold transition-colors',
    tab === item ? 'bg-accent text-white' : 'text-text-3 hover:bg-surface-2 hover:text-text-1'
  )

  const busy = (label: string) => loading === label

  return (
    <div className={cn('flex-1 min-h-0 bg-surface-0', embedded ? '' : 'overflow-auto')}>
      <div className={cn('grid min-h-full', !embedded && 'grid-cols-[minmax(760px,1fr)_360px]')}>
        <section className={cn('min-w-0', !embedded && 'p-5')}>
          {!embedded && (
            <div className="mb-5 flex items-center justify-between border-b border-border-1 pb-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-accent">Kafka Studio</p>
                <h2 className="mt-1 text-lg font-semibold text-text-1">Cluster, topics, groups and messages</h2>
                <p className="mt-1 text-xs text-text-4">Kafka UI-style administration with adOmnia's local-first broker tooling.</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn('h-2 w-2 rounded-full', port ? 'bg-success' : 'bg-error')} />
                <span className="text-[11px] text-text-4">{port ? `Backend :${port}` : 'Backend offline'}</span>
              </div>
            </div>
          )}

          <div className={cn('mb-4 grid gap-2', embedded ? 'grid-cols-3' : 'grid-cols-4')}>
            <Metric icon={Database} label="Brokers" value={brokers.length ? brokers.join(', ') : 'required'} />
            <Metric icon={ListTree} label="Topic" value={cfg.topic || 'required'} />
            <Metric icon={KeyRound} label="Group" value={cfg.groupId || 'ephemeral'} />
            {!embedded && <Metric icon={Lock} label="Security" value={`${cfg.tls ? 'TLS' : 'PLAINTEXT'} / ${cfg.saslEnabled ? cfg.saslMechanism : 'NO SASL'}`} />}
          </div>

          <ConnectionCard cfg={cfg} setCfg={setCfg} />

          <div className="my-4 flex flex-wrap gap-2">
            <button className={tabClass('overview')} onClick={() => setTab('overview')}><Gauge size={14} /> Cluster</button>
            <button className={tabClass('topics')} onClick={() => setTab('topics')}><ListTree size={14} /> Topics</button>
            <button className={tabClass('groups')} onClick={() => setTab('groups')}><Users size={14} /> Groups</button>
            <button className={tabClass('messages')} onClick={() => setTab('messages')}><Search size={14} /> Messages</button>
            <button className={tabClass('produce')} onClick={() => setTab('produce')}><Send size={14} /> Produce</button>
            <button className={tabClass('load')} onClick={() => setTab('load')}><Activity size={14} /> Load</button>
          </div>

          {tab === 'overview' && (
            <section className="space-y-4">
              <div className="flex items-center justify-between rounded border border-border-1 bg-surface-1 p-3">
                <div>
                  <h3 className="text-sm font-semibold text-text-1">Kafka Cluster Overview</h3>
                  <p className="mt-1 text-[11px] text-text-4">Broker inventory, controller, topic/partition counts and basic partition health.</p>
                </div>
                <button onClick={refreshOverview} disabled={!!loading || brokers.length === 0} className="inline-flex items-center gap-2 rounded bg-accent px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
                  <RefreshCcw size={14} /> {busy('overview') ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>
              <div className="grid grid-cols-4 gap-2">
                <Metric icon={CheckCircle2} label="Health" value={overview?.health ?? '-'} tone={overview?.health === 'healthy' ? 'good' : overview?.health === 'critical' ? 'bad' : 'warn'} />
                <Metric icon={Database} label="Brokers" value={String(overview?.brokerCount ?? '-')} />
                <Metric icon={ListTree} label="Topics" value={`${overview?.topicCount ?? '-'} (${overview?.internalTopicCount ?? 0} internal)`} />
                <Metric icon={Split} label="Partitions" value={String(overview?.partitionCount ?? '-')} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Metric icon={Gauge} label="Controller" value={String(overview?.controllerId ?? '-')} />
                <Metric icon={AlertTriangle} label="Under replicated" value={String(overview?.underReplicated ?? '-')} tone={(overview?.underReplicated ?? 0) > 0 ? 'warn' : 'good'} />
                <Metric icon={AlertTriangle} label="Offline partitions" value={String(overview?.offlinePartitions ?? '-')} tone={(overview?.offlinePartitions ?? 0) > 0 ? 'bad' : 'good'} />
              </div>
              <BrokerTable brokers={overview?.brokers ?? []} />
            </section>
          )}

          {tab === 'topics' && (
            <section className="grid grid-cols-[300px_1fr] gap-4">
              <div className="rounded border border-border-1 bg-surface-1 p-3">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-text-1">Topic Explorer</h3>
                  <button onClick={listTopics} disabled={!!loading || brokers.length === 0} title="List topics" className="grid h-8 w-8 place-items-center rounded bg-surface-2 text-text-3 hover:text-accent disabled:opacity-50">
                    <RefreshCcw size={14} className={busy('topics') ? 'animate-spin' : ''} />
                  </button>
                </div>
                <input value={topicFilter} onChange={(event) => setTopicFilter(event.target.value)} className={cn(inputClass, 'mb-2 w-full')} placeholder="Filter topics" />
                <div className="max-h-[420px] overflow-auto rounded border border-border-1 bg-surface-0">
                  {filteredTopics.length === 0 ? (
                    <p className="px-3 py-4 text-xs text-text-4">No topics loaded.</p>
                  ) : filteredTopics.map((topic) => (
                    <button key={topic} onClick={() => void loadTopicDetail(topic)} className={cn('flex w-full items-center justify-between gap-2 border-b border-border-1/50 px-3 py-2 text-left text-xs last:border-b-0 hover:bg-surface-2', cfg.topic === topic && 'bg-accent/10 text-accent')}>
                      <span className="truncate font-mono">{topic}</span>
                      <Eye size={12} />
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded border border-border-1 bg-surface-1 p-3">
                  <h3 className="text-sm font-semibold text-text-1">Create / edit topic</h3>
                  <div className="mt-3 grid grid-cols-[1fr_110px_110px] gap-3">
                    <Field label="New topic"><input value={newTopic} onChange={(event) => setNewTopic(event.target.value)} className={inputClass} placeholder="payments.events" /></Field>
                    <Field label="Partitions"><input type="number" min={1} value={newPartitions} onChange={(event) => setNewPartitions(Number(event.target.value))} className={inputClass} /></Field>
                    <Field label="Replication"><input type="number" min={1} value={newReplication} onChange={(event) => setNewReplication(Number(event.target.value))} className={inputClass} /></Field>
                  </div>
                  <div className="mt-3">
                    <span className={labelClass}>Config changes</span>
                    <div className="mt-1"><HeadersEditor rows={configRows} onChange={setConfigRows} /></div>
                  </div>
                  <div className="mt-3 grid grid-cols-[1fr_auto_auto_auto] gap-2">
                    <input value={deleteConfigName} onChange={(event) => setDeleteConfigName(event.target.value)} className={inputClass} placeholder="Config key to delete/reset" />
                    <button onClick={createTopic} disabled={!!loading || !newTopic.trim()} className="inline-flex items-center gap-2 rounded bg-accent px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><Plus size={14} /> Create</button>
                    <button onClick={updateTopic} disabled={!!loading || !cfg.topic} className="inline-flex items-center gap-2 rounded border border-border-2 px-3 py-2 text-xs font-semibold text-text-2 hover:text-accent disabled:opacity-50"><Pencil size={14} /> Update</button>
                    <button onClick={deleteTopic} disabled={!!loading || !cfg.topic} className="inline-flex items-center gap-2 rounded border border-error/40 px-3 py-2 text-xs font-semibold text-error disabled:opacity-50"><Trash2 size={14} /> Delete</button>
                  </div>
                </div>

                <TopicDetailView detail={topicDetail} onRefresh={() => void loadTopicDetail(cfg.topic)} />
              </div>
            </section>
          )}

          {tab === 'groups' && (
            <section className="grid grid-cols-[300px_1fr] gap-4">
              <div className="rounded border border-border-1 bg-surface-1 p-3">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-text-1">Consumer Groups</h3>
                  <button onClick={listGroups} disabled={!!loading || brokers.length === 0} className="grid h-8 w-8 place-items-center rounded bg-surface-2 text-text-3 hover:text-accent disabled:opacity-50">
                    <RefreshCcw size={14} className={busy('groups') ? 'animate-spin' : ''} />
                  </button>
                </div>
                <p className="mb-3 text-[11px] text-text-4">Lag is calculated against committed offsets for the selected topic when possible.</p>
                <div className="max-h-[460px] overflow-auto rounded border border-border-1 bg-surface-0">
                  {(groupResult?.groups ?? []).length === 0 ? (
                    <p className="px-3 py-4 text-xs text-text-4">No groups loaded.</p>
                  ) : groupResult?.groups?.map((group) => (
                    <button key={group.groupId} onClick={() => setSelectedGroup(group.groupId)} className={cn('w-full border-b border-border-1/50 px-3 py-2 text-left last:border-b-0 hover:bg-surface-2', selectedGroupInfo?.groupId === group.groupId && 'bg-accent/10')}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-xs text-text-1">{group.groupId}</span>
                        <span className={cn('text-[10px]', group.totalLag > 0 ? 'text-warning' : 'text-success')}>{group.totalLag} lag</span>
                      </div>
                      <p className="mt-1 text-[10px] text-text-4">{group.state || 'unknown'} / {group.memberCount} members</p>
                    </button>
                  ))}
                </div>
              </div>
              <ConsumerGroupDetail group={selectedGroupInfo} topic={cfg.topic} resetMode={resetMode} setResetMode={setResetMode} resetOffset={resetOffset} setResetOffset={setResetOffset} onReset={resetGroupOffset} />
            </section>
          )}

          {tab === 'messages' && (
            <section className="space-y-4">
              <div className="rounded border border-border-1 bg-surface-1 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-text-1">Message Browser</h3>
                    <p className="mt-1 text-[11px] text-text-4">Browse by partition, offset or timestamp; filter key, value and headers; tail live messages.</p>
                  </div>
                  <button onClick={browseMessages} disabled={!!loading || !cfg.topic || brokers.length === 0} className="inline-flex items-center gap-2 rounded bg-accent px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
                    <Search size={14} /> {busy('browse') ? 'Browsing...' : 'Browse'}
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-5 gap-3">
                  <Field label="Partition"><input value={browsePartition} onChange={(event) => setBrowsePartition(event.target.value)} className={inputClass} placeholder="all" /></Field>
                  <Field label="Offset"><input value={browseOffset} onChange={(event) => setBrowseOffset(event.target.value)} className={inputClass} placeholder="oldest" /></Field>
                  <Field label="Timestamp"><input type="datetime-local" value={browseTimestamp} onChange={(event) => setBrowseTimestamp(event.target.value)} className={inputClass} /></Field>
                  <Field label="Max messages"><input type="number" min={1} max={500} value={maxMsgs} onChange={(event) => setMaxMsgs(Number(event.target.value))} className={inputClass} /></Field>
                  <Field label="Max wait"><input type="number" min={1} max={30} value={maxWait} onChange={(event) => setMaxWait(Number(event.target.value))} className={inputClass} /></Field>
                </div>
                <div className="mt-3 grid grid-cols-4 gap-3">
                  <Field label="Key contains"><input value={keyFilter} onChange={(event) => setKeyFilter(event.target.value)} className={inputClass} /></Field>
                  <Field label="Value contains"><input value={valueFilter} onChange={(event) => setValueFilter(event.target.value)} className={inputClass} /></Field>
                  <Field label="Header key"><input value={headerKeyFilter} onChange={(event) => setHeaderKeyFilter(event.target.value)} className={inputClass} /></Field>
                  <Field label="Header value"><input value={headerValueFilter} onChange={(event) => setHeaderValueFilter(event.target.value)} className={inputClass} /></Field>
                </div>
                <label className="mt-3 inline-flex items-center gap-2 text-xs text-text-2">
                  <input type="checkbox" checked={tail} onChange={(event) => setTail(event.target.checked)} className="accent-accent" />
                  Tail from latest offset and wait for new messages
                </label>
              </div>
              <MessageList messages={browseResult?.messages ?? []} empty="No messages returned for the current browse query." />
            </section>
          )}

          {tab === 'produce' && (
            <section className="space-y-4">
              <div className="rounded border border-border-1 bg-surface-1 p-3">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-text-1">Producer</h3>
                  <div className="inline-flex rounded border border-border-1 bg-surface-0 p-1">
                    <button onClick={() => setProduceMode('single')} className={cn('rounded px-3 py-1 text-xs', produceMode === 'single' ? 'bg-accent text-white' : 'text-text-3')}>Single</button>
                    <button onClick={() => setProduceMode('bulk')} className={cn('rounded px-3 py-1 text-xs', produceMode === 'bulk' ? 'bg-accent text-white' : 'text-text-3')}>Bulk</button>
                  </div>
                </div>
                <div className="grid grid-cols-[1fr_140px] gap-3">
                  <Field label="Message key"><input value={key} onChange={(event) => setKey(event.target.value)} className={inputClass} /></Field>
                  <Field label="Partition"><input value={partition} onChange={(event) => setPartition(event.target.value)} className={inputClass} placeholder="optional" /></Field>
                </div>
                <Field label="Value"><textarea value={value} onChange={(event) => setValue(event.target.value)} rows={9} className={cn(textAreaClass, 'mt-1')} /></Field>
                <div className="mt-3">
                  <span className={labelClass}>Headers</span>
                  <div className="mt-1"><HeadersEditor rows={headers} onChange={setHeaders} /></div>
                </div>
                {produceMode === 'bulk' && (
                  <div className="mt-3 grid grid-cols-3 gap-3 border-t border-border-1 pt-3">
                    <Field label="Count"><input type="number" min={1} max={10000} value={bulkCount} onChange={(event) => setBulkCount(Number(event.target.value))} className={inputClass} /></Field>
                    <Field label="Delay ms"><input type="number" min={0} value={bulkDelayMs} onChange={(event) => setBulkDelayMs(Number(event.target.value))} className={inputClass} /></Field>
                    <Field label="JSON vary field"><input value={varyField} onChange={(event) => setVaryField(event.target.value)} className={inputClass} /></Field>
                  </div>
                )}
                <button onClick={runProduce} disabled={!!loading || !cfg.topic || brokers.length === 0} className="mt-4 inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
                  <Send size={14} /> {busy('produce') ? 'Sending...' : produceMode === 'bulk' ? 'Bulk produce' : 'Produce'}
                </button>
              </div>
            </section>
          )}

          {tab === 'load' && (
            <section className="space-y-4">
              <div className="rounded border border-border-1 bg-surface-1 p-3">
                <h3 className="text-sm font-semibold text-text-1">Producer load test</h3>
                <p className="mt-1 text-[11px] text-text-4">Send messages concurrently and measure broker acknowledgement latency and throughput.</p>
                <div className="mt-3 grid grid-cols-4 gap-3">
                  <Field label="Concurrency"><input type="number" min={1} max={100} value={loadConcurrency} onChange={(event) => setLoadConcurrency(Number(event.target.value))} className={inputClass} /></Field>
                  <Field label={loadUseDuration ? 'Duration seconds' : 'Total messages'}>
                    <input type="number" min={1} max={loadUseDuration ? 300 : 100000} value={loadUseDuration ? loadDurationS : loadTotalMsgs} onChange={(event) => loadUseDuration ? setLoadDurationS(Number(event.target.value)) : setLoadTotalMsgs(Number(event.target.value))} className={inputClass} />
                  </Field>
                  <Field label="Ramp-up ms"><input type="number" min={0} value={loadRampUpMs} onChange={(event) => setLoadRampUpMs(Number(event.target.value))} className={inputClass} /></Field>
                  <label className="flex items-end gap-2 pb-2 text-xs text-text-2"><input type="checkbox" checked={loadUseDuration} onChange={(event) => setLoadUseDuration(event.target.checked)} className="accent-accent" /> Run for duration</label>
                </div>
                <div className="mt-3 grid grid-cols-[220px_1fr] gap-3">
                  <Field label="JSON vary field"><input value={varyField} onChange={(event) => setVaryField(event.target.value)} className={inputClass} /></Field>
                  <div className="flex items-end gap-2">
                    <button onClick={runLoad} disabled={!!loading || !cfg.topic || brokers.length === 0} className="inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
                      <Activity size={14} /> {busy('load') ? 'Running...' : 'Run load'}
                    </button>
                    <button onClick={runConsume} disabled={!!loading || !cfg.topic || brokers.length === 0} className="inline-flex items-center gap-2 rounded border border-border-2 px-4 py-2 text-xs font-semibold text-text-2 hover:text-accent disabled:opacity-50">
                      <Timer size={14} /> {busy('consume') ? 'Consuming...' : 'Quick consume'}
                    </button>
                    <label className="ml-2 flex items-center gap-2 pb-2 text-xs text-text-2"><input type="checkbox" checked={fromStart} onChange={(event) => setFromStart(event.target.checked)} className="accent-accent" /> From start</label>
                  </div>
                </div>
              </div>
            </section>
          )}

          {embedded && error && <div className="mt-4 rounded border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">{error}</div>}
        </section>

        {!embedded && (
          <aside className="border-l border-border-1 bg-surface-0 p-5">
            <div className="mb-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-accent">Activity</p>
              <h3 className="mt-1 text-sm font-semibold text-text-1">Kafka result</h3>
              <p className="mt-1 text-[11px] leading-relaxed text-text-4">Raw responses, admin mutations and message browser output appear here.</p>
            </div>
            {error && <div className="mb-4 rounded border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">{error}</div>}
            <JsonResult result={actionResult} />
            <details className="mt-4 rounded border border-border-1 bg-surface-1 p-3">
              <summary className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-text-2">
                <Lock size={13} className="text-accent" />
                Connection security details
              </summary>
              <div className="mt-3 space-y-2 text-[11px] text-text-4">
                <p><span className="font-mono text-text-2">TLS</span> encrypts the transport to the configured broker.</p>
                <p><span className="font-mono text-text-2">SASL</span> supports PLAIN and SCRAM authentication mechanisms.</p>
                <p>Credentials remain local; save secrets to Vault when reuse is needed.</p>
              </div>
            </details>
          </aside>
        )}
      </div>
    </div>
  )
}

function ConnectionCard({ cfg, setCfg }: { cfg: BrokerConfig; setCfg: Dispatch<SetStateAction<BrokerConfig>> }) {
  return (
    <div className="rounded border border-border-1 bg-surface-1 p-3">
      <div className="mb-3 flex items-center gap-2">
        <Radio size={14} className="text-accent" />
        <h3 className="text-xs font-semibold text-text-1">Connection</h3>
      </div>
      <ConnectionProfiles protocol="kafka" config={cfg} onLoad={(saved) => setCfg((current) => ({ ...current, ...saved }))} />
      <div className="grid grid-cols-4 gap-3">
        <Field label="Brokers"><input value={cfg.brokers} onChange={(event) => setCfg({ ...cfg, brokers: event.target.value })} className={inputClass} /></Field>
        <Field label="Topic"><input value={cfg.topic} onChange={(event) => setCfg({ ...cfg, topic: event.target.value })} className={inputClass} /></Field>
        <Field label="Group ID"><input value={cfg.groupId} onChange={(event) => setCfg({ ...cfg, groupId: event.target.value })} className={inputClass} /></Field>
        <Field label="Client ID"><input value={cfg.clientId} onChange={(event) => setCfg({ ...cfg, clientId: event.target.value })} className={inputClass} /></Field>
      </div>
      <div className="mt-3 flex gap-3">
        <label className="flex h-8 items-center gap-2 rounded border border-border-2 bg-surface-2 px-2 text-xs text-text-2">
          <input type="checkbox" checked={cfg.tls} onChange={(event) => setCfg({ ...cfg, tls: event.target.checked })} className="accent-accent" />
          TLS
        </label>
        <label className="flex h-8 items-center gap-2 rounded border border-border-2 bg-surface-2 px-2 text-xs text-text-2">
          <input type="checkbox" checked={cfg.saslEnabled} onChange={(event) => setCfg({ ...cfg, saslEnabled: event.target.checked })} className="accent-accent" />
          SASL
        </label>
      </div>
      {cfg.saslEnabled && (
        <>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <select value={cfg.saslMechanism} onChange={(event) => setCfg({ ...cfg, saslMechanism: event.target.value })} className={inputClass}>{mechanisms.map((item) => <option key={item}>{item}</option>)}</select>
            <input value={cfg.saslUsername} onChange={(event) => setCfg({ ...cfg, saslUsername: event.target.value })} placeholder="username" className={inputClass} />
            <input type="password" value={cfg.saslPassword} onChange={(event) => setCfg({ ...cfg, saslPassword: event.target.value })} placeholder="password" className={inputClass} />
          </div>
        </>
      )}
    </div>
  )
}

function BrokerTable({ brokers }: { brokers: Array<{ id?: number; addr?: string; controller?: boolean }> }) {
  return (
    <div className="rounded border border-border-1 bg-surface-1">
      <div className="border-b border-border-1 px-3 py-2 text-xs font-semibold text-text-1">Brokers</div>
      {brokers.length === 0 ? (
        <p className="px-3 py-4 text-xs text-text-4">No broker data loaded.</p>
      ) : brokers.map((broker) => (
        <div key={`${broker.id}-${broker.addr}`} className="grid grid-cols-[90px_1fr_110px] gap-3 border-b border-border-1/50 px-3 py-2 text-xs last:border-b-0">
          <span className="font-mono text-accent">#{broker.id ?? '-'}</span>
          <span className="font-mono text-text-2">{broker.addr}</span>
          <span className={cn('text-[11px]', broker.controller ? 'text-success' : 'text-text-4')}>{broker.controller ? 'controller' : 'broker'}</span>
        </div>
      ))}
    </div>
  )
}

function TopicDetailView({ detail, onRefresh }: { detail: TopicDetail | null; onRefresh: () => void }) {
  if (!detail) {
    return (
      <div className="rounded border border-dashed border-border-2 bg-surface-1/60 p-8 text-center">
        <ListTree size={24} className="mx-auto mb-2 text-text-4" />
        <p className="text-xs font-semibold text-text-2">Select a topic to inspect partitions and configs.</p>
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <div className="rounded border border-border-1 bg-surface-1 p-3">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="font-mono text-sm font-semibold text-text-1">{detail.topic}</h3>
            <p className="mt-1 text-[11px] text-text-4">{detail.isInternal ? 'Internal topic' : 'User topic'} / {detail.partitions?.length ?? 0} partitions</p>
          </div>
          <button onClick={onRefresh} className="grid h-8 w-8 place-items-center rounded bg-surface-2 text-text-3 hover:text-accent"><RefreshCcw size={14} /></button>
        </div>
        <div className="max-h-64 overflow-auto rounded border border-border-1 bg-surface-0">
          {(detail.partitions ?? []).map((partition) => (
            <div key={partition.id} className="grid grid-cols-[56px_70px_1fr_1fr_110px] gap-3 border-b border-border-1/50 px-3 py-2 text-xs last:border-b-0">
              <span className="font-mono text-accent">p{partition.id}</span>
              <span className="font-mono text-text-3">L{partition.leader}</span>
              <span className="truncate text-text-3">replicas {partition.replicas.join(', ')}</span>
              <span className="truncate text-text-3">ISR {partition.isr.join(', ')}</span>
              <span className="font-mono text-text-2">{partition.oldestOffset} - {partition.latestOffset}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded border border-border-1 bg-surface-1 p-3">
        <div className="mb-2 flex items-center gap-2"><Settings size={14} className="text-accent" /><h3 className="text-xs font-semibold text-text-1">Topic configs</h3></div>
        <div className="max-h-72 overflow-auto rounded border border-border-1 bg-surface-0">
          {(detail.configs ?? []).slice(0, 80).map((config) => (
            <div key={config.name} className="grid grid-cols-[220px_1fr_90px] gap-3 border-b border-border-1/50 px-3 py-2 text-xs last:border-b-0">
              <span className="font-mono text-text-2">{config.name}</span>
              <span className="truncate font-mono text-text-3">{config.sensitive ? '(sensitive)' : config.value}</span>
              <span className={cn('text-[10px]', config.readOnly ? 'text-text-4' : 'text-accent')}>{config.readOnly ? 'read-only' : config.source}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ConsumerGroupDetail({
  group,
  topic,
  resetMode,
  setResetMode,
  resetOffset,
  setResetOffset,
  onReset,
}: {
  group?: ConsumerGroupInfo
  topic: string
  resetMode: string
  setResetMode: (mode: string) => void
  resetOffset: number
  setResetOffset: (offset: number) => void
  onReset: (partition: number) => void
}) {
  if (!group) {
    return (
      <div className="rounded border border-dashed border-border-2 bg-surface-1/60 p-8 text-center">
        <Users size={24} className="mx-auto mb-2 text-text-4" />
        <p className="text-xs font-semibold text-text-2">Load consumer groups to inspect lag and members.</p>
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-2">
        <Metric icon={Users} label="Group" value={group.groupId} />
        <Metric icon={Activity} label="State" value={group.state || '-'} />
        <Metric icon={Database} label="Members" value={String(group.memberCount)} />
        <Metric icon={AlertTriangle} label="Lag" value={String(group.totalLag)} tone={group.totalLag > 0 ? 'warn' : 'good'} />
      </div>
      <div className="rounded border border-border-1 bg-surface-1 p-3">
        <div className="mb-3 grid grid-cols-[140px_160px_1fr] gap-3">
          <Field label="Reset mode">
            <select value={resetMode} onChange={(event) => setResetMode(event.target.value)} className={inputClass}>
              <option value="latest">Latest</option>
              <option value="earliest">Earliest</option>
              <option value="custom">Custom offset</option>
            </select>
          </Field>
          <Field label="Custom offset"><input type="number" value={resetOffset} onChange={(event) => setResetOffset(Number(event.target.value))} className={inputClass} disabled={resetMode !== 'custom'} /></Field>
          <p className="self-end pb-2 text-[11px] text-text-4">Offset reset applies per partition for topic <span className="font-mono text-text-2">{topic}</span>.</p>
        </div>
        <div className="max-h-64 overflow-auto rounded border border-border-1 bg-surface-0">
          {group.partitions.length === 0 ? (
            <p className="px-3 py-4 text-xs text-text-4">No committed offsets found for this topic/group.</p>
          ) : group.partitions.map((partition) => (
            <div key={`${partition.topic}-${partition.partition}`} className="grid grid-cols-[1fr_70px_90px_90px_70px_80px] gap-3 border-b border-border-1/50 px-3 py-2 text-xs last:border-b-0">
              <span className="truncate font-mono text-text-2">{partition.topic}</span>
              <span className="font-mono text-accent">p{partition.partition}</span>
              <span className="font-mono text-text-3">{partition.offset}</span>
              <span className="font-mono text-text-3">{partition.latestOffset}</span>
              <span className={cn(partition.lag > 0 ? 'text-warning' : 'text-success')}>{partition.lag}</span>
              <button onClick={() => onReset(partition.partition)} className="text-accent hover:text-accent/80">Reset</button>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded border border-border-1 bg-surface-1 p-3">
        <h3 className="mb-2 text-xs font-semibold text-text-1">Members</h3>
        <div className="max-h-48 overflow-auto rounded border border-border-1 bg-surface-0">
          {group.members.length === 0 ? <p className="px-3 py-4 text-xs text-text-4">No active members.</p> : group.members.map((member) => (
            <div key={member.memberId} className="border-b border-border-1/50 px-3 py-2 text-xs last:border-b-0">
              <p className="truncate font-mono text-text-2">{member.memberId}</p>
              <p className="mt-1 text-[10px] text-text-4">{member.clientId} / {member.clientHost}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function MessageList({ messages, empty }: { messages: KafkaMessage[]; empty: string }) {
  return (
    <div className="rounded border border-border-1 bg-surface-1 p-3">
      <div className="mb-2 flex items-center gap-2"><Layers size={14} className="text-accent" /><h3 className="text-xs font-semibold text-text-1">Messages</h3></div>
      <div className="max-h-[460px] overflow-auto rounded border border-border-1 bg-surface-0">
        {messages.length === 0 ? (
          <p className="px-3 py-4 text-xs text-text-4">{empty}</p>
        ) : messages.map((message, index) => (
          <div key={`${message.partition}-${message.offset}-${index}`} className="grid grid-cols-[70px_90px_180px_1fr] gap-3 border-b border-border-1/50 px-3 py-2 text-xs last:border-b-0">
            <span className="font-mono text-accent">p{message.partition ?? '-'}</span>
            <span className="font-mono text-text-4">@{message.offset ?? '-'}</span>
            <div className="min-w-0">
              <p className="truncate font-mono text-text-2">{message.key || '(no key)'}</p>
              <p className="mt-1 text-[10px] text-text-4">{message.timestamp}</p>
            </div>
            <div className="min-w-0">
              <p className="whitespace-pre-wrap break-words font-mono text-text-2">{message.value}</p>
              {message.headers && Object.keys(message.headers).length > 0 && <p className="mt-2 truncate font-mono text-[10px] text-text-4">headers {JSON.stringify(message.headers)}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
