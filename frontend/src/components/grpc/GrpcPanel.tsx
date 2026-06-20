import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Braces,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Download,
  FileCode2,
  FolderOpen,
  Gauge,
  History,
  Layers,
  ListTree,
  Loader2,
  Lock,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Server,
  Settings2,
  Shield,
  SplitSquareHorizontal,
  Trash2,
  Upload,
  Wand2,
  X,
} from 'lucide-react'
import { useServerPort, serverUrl, sidecarFetch } from '@/lib/useServerPort'
import { cn } from '@/lib/utils'
import { safeSetItem } from '@/lib/safeLocalStorage'

const CONNECTIONS_KEY = 'adomnia.grpc.connections'
const HISTORY_KEY = 'adomnia.grpc.history'
const MAX_HISTORY = 40

interface GrpcConnectionProfile {
  id: string
  name: string
  address: string
  useTls: boolean
  caCertPath?: string
  clientCertPath?: string
  clientKeyPath?: string
}

interface ServiceInfo {
  name: string
  methods: MethodInfo[]
}

interface MethodInfo {
  name: string
  input_type: string
  output_type: string
  client_streaming: boolean
  server_streaming: boolean
}

interface FieldInfo {
  name: string
  proto_name?: string
  type: string
  kind?: string
  number: number
  repeated: boolean
  map?: boolean
  required?: boolean
  optional?: boolean
  oneof?: boolean
  oneof_name?: string
  oneof_fields?: FieldInfo[]
  message_type?: string
  enum_type?: string
  enum_values?: EnumValueInfo[]
  key_type?: string
  value_type?: string
  default_value?: unknown
  description?: string
}

interface EnumValueInfo {
  name: string
  number: number
}

interface DescriptorPayload {
  services: ServiceInfo[]
  schemas?: Record<string, FieldInfo[]>
  enums?: Record<string, EnumValueInfo[]>
  files?: string[]
}

interface MetadataRow {
  id: string
  key: string
  value: string
}

interface InvokeResponse {
  response?: unknown
  messages?: unknown[]
  error?: string
  status: string
  time_ms?: number
  response_metadata?: Record<string, string>
}

interface HistoryRow {
  id: string
  timestamp: string
  address: string
  service: string
  method: string
  rpcType: string
  status: string
  durationMs: number
  requestBytes: number
  responseBytes: number
  metadataCount: number
  error?: string
  requestJson: string
  responseJson: string
}

type SourceKind = 'empty' | 'reflection' | 'proto' | 'protoset'
type MainTab = 'form' | 'raw' | 'response'
type BottomTab = 'response' | 'raw' | 'metadata' | 'trailers' | 'logs' | 'history'
type InspectorTab = 'details' | 'request' | 'response' | 'hints'

const newId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const defaultMetadata = (): MetadataRow[] => [
  { id: newId(), key: 'authorization', value: 'Bearer demo-token-12345' },
  { id: newId(), key: 'x-client', value: 'adOmnia-gRPC' },
  { id: newId(), key: 'x-trace-id', value: newId() },
]

const loadJson = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

const saveJson = (key: string, value: unknown) => {
  safeSetItem(key, JSON.stringify(value))
}

const methodType = (method?: MethodInfo) => {
  if (!method) return 'Unary'
  if (method.client_streaming && method.server_streaming) return 'Bidi Streaming'
  if (method.client_streaming) return 'Client Streaming'
  if (method.server_streaming) return 'Server Streaming'
  return 'Unary'
}

const methodTone = (method?: MethodInfo) => {
  if (!method) return 'border-border-2 bg-surface-3 text-text-3'
  if (method.client_streaming && method.server_streaming) return 'border-accent/40 bg-accent/15 text-accent-light'
  if (method.client_streaming) return 'border-warning/40 bg-warning/10 text-warning'
  if (method.server_streaming) return 'border-info/40 bg-info/10 text-info'
  return 'border-success/35 bg-success/10 text-success'
}

const packageName = (service: string) => {
  const parts = service.split('.')
  return parts.length > 1 ? parts.slice(0, -1).join('.') : 'default'
}

const jsonSize = (value: string) => new Blob([value]).size

const safePretty = (text: string) => JSON.stringify(JSON.parse(text || '{}'), null, 2)

const isValidJson = (text: string) => {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

const sampleValueForField = (field: FieldInfo, schemas: Record<string, FieldInfo[]> = {}, depth = 0): unknown => {
  const lower = field.type.toLowerCase()
  const kind = (field.kind || '').toLowerCase()
  if (field.oneof) return {}
  if (field.map) return {}
  if (field.repeated) return []
  if (field.enum_values?.length) return field.enum_values[0]?.name ?? ''
  if (kind === 'bool' || lower.includes('bool')) return false
  if (kind.includes('int') || kind.includes('float') || kind.includes('double') || lower.includes('int') || lower.includes('float') || lower.includes('double')) return 0
  if (kind === 'bytes' || lower.includes('bytes')) return ''
  if (lower.includes('google.protobuf.timestamp')) return new Date().toISOString()
  if (field.message_type && schemas[field.message_type] && depth < 3) return buildObjectFromFields(schemas[field.message_type], schemas, depth + 1)
  if (field.type.includes('.')) return {}
  if (field.default_value !== undefined && field.default_value !== null) return field.default_value
  return ''
}

const buildObjectFromFields = (fields: FieldInfo[], schemas: Record<string, FieldInfo[]> = {}, depth = 0) => {
  const next: Record<string, unknown> = {}
  for (const field of fields) {
    if (field.oneof) continue
    next[field.name] = sampleValueForField(field, schemas, depth)
  }
  return next
}

async function postJson<T>(port: number | null, path: string, body: unknown): Promise<T> {
  const url = serverUrl(port, path)
  if (!url) throw new Error('Backend sidecar non pronto. Apri la app desktop Wails o riavvia il dev server.')
  const res = await sidecarFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const raw = await res.text()
  let parsed: unknown = null
  try {
    parsed = raw ? JSON.parse(raw) : null
  } catch {
    parsed = { error: raw }
  }
  if (!res.ok) {
    const message = typeof parsed === 'object' && parsed && 'error' in parsed
      ? String((parsed as { error?: unknown }).error)
      : raw || `HTTP ${res.status}`
    throw new Error(message)
  }
  return parsed as T
}

function StatusPill({ connected, loading }: { connected: boolean; loading: boolean }) {
  return (
    <div className={cn(
      'h-8 px-3 rounded-md border flex items-center gap-2 text-xs font-medium shrink-0',
      connected
        ? 'bg-success/10 border-success/30 text-success'
        : 'bg-surface-2 border-border-2 text-text-3',
    )}>
      {loading ? <Loader2 size={13} className="animate-spin" /> : <span className={cn('h-2 w-2 rounded-full', connected ? 'bg-success' : 'bg-text-4')} />}
      {connected ? 'Connected' : 'Disconnected'}
    </div>
  )
}

function RpcBadge({ method }: { method?: MethodInfo }) {
  return (
    <span className={cn('rounded px-2 py-0.5 text-[10px] font-semibold border whitespace-nowrap', methodTone(method))}>
      {methodType(method)}
    </span>
  )
}

function IconButton({
  children,
  onClick,
  disabled,
  title,
  primary,
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  title?: string
  primary?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'h-8 px-3 rounded-md border text-xs font-medium flex items-center gap-2 transition-colors disabled:opacity-45 disabled:cursor-not-allowed',
        primary
          ? 'bg-accent text-white border-accent hover:bg-accent-hover'
          : 'bg-surface-2 text-text-2 border-border-2 hover:border-accent/45 hover:text-text-1',
      )}
    >
      {children}
    </button>
  )
}

function GrpcConnectionBar({
  address,
  useTls,
  connected,
  loading,
  profiles,
  showTls,
  onAddressChange,
  onTlsChange,
  onReflect,
  onInvoke,
  onLoadTest,
  onDisconnect,
  onSave,
  onLoadProfile,
  onToggleTls,
  onUploadProto,
  onUploadProtoset,
}: {
  address: string
  useTls: boolean
  connected: boolean
  loading: boolean
  profiles: GrpcConnectionProfile[]
  showTls: boolean
  onAddressChange: (value: string) => void
  onTlsChange: (value: boolean) => void
  onReflect: () => void
  onInvoke: () => void
  onLoadTest: () => void
  onDisconnect: () => void
  onSave: () => void
  onLoadProfile: (profile: GrpcConnectionProfile) => void
  onToggleTls: () => void
  onUploadProto: () => void
  onUploadProtoset: () => void
}) {
  return (
    <div className="border-b border-border-1 bg-surface-0/95 px-4 py-3">
      <div className="flex items-center gap-3 min-w-0">
        <StatusPill connected={connected} loading={loading} />
        <div className="h-9 flex-1 min-w-[220px] bg-surface-2 border border-border-2 rounded-md flex items-center gap-2 px-3 focus-within:border-accent/60">
          <Server size={14} className="text-accent shrink-0" />
          <input
            value={address}
            onChange={(event) => onAddressChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onReflect()
            }}
            placeholder="localhost:50051"
            className="flex-1 bg-transparent outline-none text-sm text-text-1 font-mono placeholder:text-text-4 min-w-0"
          />
          {profiles.length > 0 && (
            <select
              aria-label="Recent gRPC connections"
              onChange={(event) => {
                const profile = profiles.find((item) => item.id === event.target.value)
                if (profile) onLoadProfile(profile)
                event.currentTarget.value = ''
              }}
              className="w-36 h-7 bg-surface-1 border border-border-2 rounded text-[11px] text-text-3 outline-none"
              defaultValue=""
            >
              <option value="">Recent</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name}</option>
              ))}
            </select>
          )}
        </div>
        <label className="h-8 px-3 rounded-md border border-border-2 bg-surface-2 text-xs text-text-2 flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={useTls}
            onChange={(event) => onTlsChange(event.target.checked)}
            className="accent-accent"
          />
          TLS
        </label>
        <IconButton onClick={onToggleTls} title="TLS and mTLS settings">
          <Shield size={13} />
          TLS Settings
          <ChevronDown size={12} className={cn('transition-transform', showTls && 'rotate-180')} />
        </IconButton>
        <IconButton onClick={onReflect} disabled={loading || !address} primary>
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Reflect
        </IconButton>
        <IconButton onClick={onUploadProto}>
          <Upload size={13} />
          Proto
        </IconButton>
        <IconButton onClick={onUploadProtoset} title="Upload a compiled FileDescriptorSet / protoset">
          <FileCode2 size={13} />
          Protoset
        </IconButton>
        <IconButton onClick={connected ? onDisconnect : onReflect} disabled={loading || !address}>
          {connected ? <X size={13} /> : <Lock size={13} />}
          {connected ? 'Disconnect' : 'Connect'}
        </IconButton>
        <IconButton onClick={onSave} disabled={!address}>
          <Save size={13} />
          Save
        </IconButton>
        <IconButton onClick={onInvoke} disabled={loading || !connected} primary>
          <Play size={13} />
          Invoke
        </IconButton>
        <IconButton onClick={onLoadTest} disabled={loading || !connected} title="Run a gRPC load test">
          <Gauge size={13} />
          Load Test
        </IconButton>
      </div>
    </div>
  )
}

function GrpcTlsSettingsDrawer({
  open,
  useTls,
  caCertPath,
  clientCertPath,
  clientKeyPath,
  onUseTlsChange,
  onCaChange,
  onClientCertChange,
  onClientKeyChange,
}: {
  open: boolean
  useTls: boolean
  caCertPath: string
  clientCertPath: string
  clientKeyPath: string
  onUseTlsChange: (value: boolean) => void
  onCaChange: (value: string) => void
  onClientCertChange: (value: string) => void
  onClientKeyChange: (value: string) => void
}) {
  if (!open) return null
  return (
    <div className="mx-4 mt-3 rounded-md border border-border-1 bg-surface-1 p-3">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-xs font-semibold text-text-1">TLS / mTLS</p>
          <p className="text-[11px] text-text-4">Plaintext and TLS are active. Custom CA and client certificates are staged for the backend TLS profile.</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-text-3">
          <input type="checkbox" checked={useTls} onChange={(event) => onUseTlsChange(event.target.checked)} className="accent-accent" />
          Use TLS
        </label>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <PathInput label="CA certificate" value={caCertPath} onChange={onCaChange} placeholder="C:\\certs\\ca.pem" />
        <PathInput label="Client certificate" value={clientCertPath} onChange={onClientCertChange} placeholder="C:\\certs\\client.pem" />
        <PathInput label="Client key" value={clientKeyPath} onChange={onClientKeyChange} placeholder="C:\\certs\\client-key.pem" />
      </div>
    </div>
  )
}

function PathInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-text-4">
      {label}
      <div className="h-8 bg-surface-2 border border-border-2 rounded flex items-center gap-2 px-2">
        <FolderOpen size={12} className="text-text-4" />
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent outline-none text-[11px] normal-case tracking-normal text-text-2 font-mono placeholder:text-text-4"
        />
      </div>
    </label>
  )
}

function GrpcServicesExplorer({
  services,
  selectedService,
  selectedMethod,
  search,
  sourceKind,
  sourceName,
  connected,
  onSearch,
  onSelect,
  onRefresh,
  onUploadProto,
}: {
  services: ServiceInfo[]
  selectedService: string
  selectedMethod: string
  search: string
  sourceKind: SourceKind
  sourceName: string
  connected: boolean
  onSearch: (value: string) => void
  onSelect: (service: string, method: string) => void
  onRefresh: () => void
  onUploadProto: () => void
}) {
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return services
    return services
      .map((service) => ({
        ...service,
        methods: service.methods.filter((method) =>
          service.name.toLowerCase().includes(q) || method.name.toLowerCase().includes(q),
        ),
      }))
      .filter((service) => service.name.toLowerCase().includes(q) || service.methods.length > 0)
  }, [search, services])

  return (
    <aside className="w-[300px] shrink-0 border-r border-border-1 bg-surface-1/80 flex flex-col min-h-0">
      <div className="p-3 border-b border-border-1">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-semibold text-text-1">Services</p>
            <p className="text-[11px] text-text-4">{services.length} services discovered</p>
          </div>
          <button onClick={onRefresh} className="h-7 w-7 rounded border border-border-2 bg-surface-2 text-text-3 hover:text-accent" title="Refresh reflection">
            <RefreshCw size={13} className="mx-auto" />
          </button>
        </div>
        <div className="h-8 rounded-md border border-border-2 bg-surface-2 flex items-center gap-2 px-2">
          <Search size={13} className="text-text-4" />
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search services..."
            className="min-w-0 flex-1 bg-transparent outline-none text-xs text-text-2 placeholder:text-text-4"
          />
        </div>
      </div>
      <div className="flex-1 overflow-auto py-2">
        {filtered.length === 0 ? (
          <div className="p-4 text-xs text-text-4">No services match the current search.</div>
        ) : (
          filtered.map((service) => (
            <div key={service.name} className="px-2 py-1">
              <button
                onClick={() => onSelect(service.name, service.methods[0]?.name ?? '')}
                className={cn(
                  'w-full min-w-0 flex items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-surface-2',
                  selectedService === service.name && 'bg-accent/10',
                )}
              >
                <ChevronRight size={13} className={cn('shrink-0 text-text-4 transition-transform', selectedService === service.name && 'rotate-90 text-accent')} />
                <div className="min-w-0 flex-1">
                  <p className={cn('truncate text-xs font-semibold', selectedService === service.name ? 'text-accent-light' : 'text-text-2')}>
                    {service.name}
                  </p>
                  <p className="text-[10px] text-text-4">{service.methods.length} methods</p>
                </div>
              </button>
              {(selectedService === service.name || search) && (
                <div className="ml-6 mt-1 border-l border-border-2">
                  {service.methods.map((method) => (
                    <button
                      key={method.name}
                      onClick={() => onSelect(service.name, method.name)}
                      className={cn(
                        'w-full min-w-0 flex items-center gap-2 px-2 py-1.5 rounded-r-md text-left hover:bg-surface-2',
                        selectedService === service.name && selectedMethod === method.name && 'bg-accent/15',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate text-xs text-text-2">{method.name}</span>
                      <RpcBadge method={method} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
      <div className="m-3 rounded-md border border-border-1 bg-surface-2 p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-text-1">Proto Source</p>
          <span className={cn(
            'rounded px-2 py-0.5 text-[10px] font-semibold',
            connected ? 'bg-success/10 text-success' : 'bg-surface-3 text-text-4',
          )}>
            {connected ? 'Live' : 'Offline'}
          </span>
        </div>
        <p className="mt-2 text-[11px] text-text-3">
          {sourceKind === 'reflection' ? 'Server reflection' : sourceKind === 'proto' ? sourceName || 'Uploaded .proto' : sourceKind === 'protoset' ? 'Uploaded protoset' : 'No descriptors loaded'}
        </p>
        <p className="text-[10px] text-text-4 mt-1">Last refreshed: {connected ? 'just now' : 'not connected'}</p>
        <button onClick={onUploadProto} className="mt-3 h-8 w-full rounded-md border border-border-2 bg-surface-1 text-xs text-text-2 hover:border-accent/45 hover:text-accent flex items-center justify-center gap-2">
          <Upload size={13} />
          Upload .proto File
        </button>
      </div>
    </aside>
  )
}

function GrpcRequestMetadataTable({ metadata, onChange }: { metadata: MetadataRow[]; onChange: (rows: MetadataRow[]) => void }) {
  return (
    <section className="rounded-md border border-border-1 bg-surface-1 p-3">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-text-1">Request Metadata</p>
          <p className="text-[11px] text-text-4">Headers are preserved for this workspace session.</p>
        </div>
        <button
          onClick={() => onChange([...metadata, { id: newId(), key: '', value: '' }])}
          className="h-7 px-2 rounded border border-border-2 bg-surface-2 text-xs text-accent hover:border-accent/45 flex items-center gap-1.5"
        >
          <Plus size={12} />
          Add Metadata
        </button>
      </div>
      <div className="grid grid-cols-[24px_1fr_1fr_30px] gap-1 text-[10px] uppercase tracking-wider text-text-4 mb-1 px-1">
        <span />
        <span>Key</span>
        <span>Value</span>
        <span />
      </div>
      <div className="space-y-1">
        {metadata.map((row, index) => (
          <div key={row.id} className="grid grid-cols-[24px_1fr_1fr_30px] gap-1 items-center">
            <span className="text-center text-text-4 text-xs">-</span>
            <input
              value={row.key}
              onChange={(event) => {
                const next = [...metadata]
                next[index] = { ...row, key: event.target.value }
                onChange(next)
              }}
              placeholder="authorization"
              className="h-8 rounded border border-border-2 bg-surface-2 px-2 text-xs text-text-1 font-mono outline-none focus:border-accent/60"
            />
            <input
              value={row.value}
              onChange={(event) => {
                const next = [...metadata]
                next[index] = { ...row, value: event.target.value }
                onChange(next)
              }}
              placeholder="Bearer token"
              className="h-8 rounded border border-border-2 bg-surface-2 px-2 text-xs text-text-1 font-mono outline-none focus:border-accent/60"
            />
            <button onClick={() => onChange(metadata.filter((item) => item.id !== row.id))} className="h-8 w-8 rounded border border-border-2 bg-surface-2 text-error hover:bg-error/10">
              <Trash2 size={13} className="mx-auto" />
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}

function GrpcDynamicRequestForm({
  fields,
  schemas,
  values,
  streaming,
  streamMessages,
  onValueChange,
  onStreamMessagesChange,
}: {
  fields: FieldInfo[]
  schemas: Record<string, FieldInfo[]>
  values: Record<string, unknown>
  streaming: boolean
  streamMessages: string[]
  onValueChange: (values: Record<string, unknown>) => void
  onStreamMessagesChange: (messages: string[]) => void
}) {
  if (streaming) {
    return (
      <section className="rounded-md border border-border-1 bg-surface-1 p-3">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-semibold text-text-1">Streaming Request Messages</p>
            <p className="text-[11px] text-text-4">Messages are prepared upfront and sent in order, matching grpcui's stream model.</p>
          </div>
          <button
            onClick={() => onStreamMessagesChange([...streamMessages, JSON.stringify(buildObjectFromFields(fields, schemas), null, 2)])}
            className="h-7 px-2 rounded border border-border-2 bg-surface-2 text-xs text-accent hover:border-accent/45 flex items-center gap-1.5"
          >
            <Plus size={12} />
            Add Message
          </button>
        </div>
        <div className="space-y-2">
          {streamMessages.map((message, index) => (
            <div key={index} className="rounded border border-border-2 bg-surface-2 overflow-hidden">
              <div className="h-8 px-3 border-b border-border-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-text-2">Message #{index + 1}</span>
                <div className="flex items-center gap-2">
                  <span className={cn('text-[10px]', isValidJson(message) ? 'text-success' : 'text-error')}>{isValidJson(message) ? 'valid' : 'invalid'}</span>
                  <button
                    onClick={() => {
                      const next = [...streamMessages]
                      try { next[index] = JSON.stringify(JSON.parse(message), null, 2) } catch {}
                      onStreamMessagesChange(next)
                    }}
                    className="text-[11px] text-text-4 hover:text-accent"
                  >
                    Format
                  </button>
                  <button
                    onClick={() => {
                      const next = [...streamMessages]
                      next[index] = JSON.stringify(buildObjectFromFields(fields, schemas), null, 2)
                      onStreamMessagesChange(next)
                    }}
                    className="text-[11px] text-text-4 hover:text-accent"
                  >
                    Clear
                  </button>
                  <button onClick={() => onStreamMessagesChange([...streamMessages, message])} className="text-[11px] text-text-4 hover:text-accent">Duplicate</button>
                  <button onClick={() => onStreamMessagesChange(streamMessages.filter((_, i) => i !== index))} className="text-[11px] text-error hover:text-error">Remove</button>
                </div>
              </div>
              <textarea
                value={message}
                onChange={(event) => {
                  const next = [...streamMessages]
                  next[index] = event.target.value
                  onStreamMessagesChange(next)
                }}
                spellCheck={false}
                className="h-32 w-full resize-y bg-transparent p-3 text-xs text-text-1 font-mono outline-none"
              />
            </div>
          ))}
        </div>
      </section>
    )
  }

  return (
    <section className="rounded-md border border-border-1 bg-surface-1 p-3">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-text-1">Request Data</p>
          <p className="text-[11px] text-text-4">{fields.length ? 'Generated from protobuf reflection fields.' : 'Schema not described yet; edit JSON in the Raw Request tab.'}</p>
        </div>
        <span className="rounded bg-surface-3 px-2 py-0.5 text-[10px] text-text-4">{fields.length} fields</span>
      </div>
      {fields.length === 0 ? (
        <div className="rounded border border-dashed border-border-2 p-5 text-xs text-text-4">
          No field descriptor is available. Reflection can describe real server schemas; uploaded proto files currently populate service/method discovery.
        </div>
      ) : (
        <div className="space-y-2">
          {fields.map((field) => (
            <GrpcFieldRenderer
              key={field.name}
              field={field}
              schemas={schemas}
              value={values[field.name]}
              onChange={(value) => onValueChange({ ...values, [field.name]: value })}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function GrpcFieldRenderer({
  field,
  value,
  schemas,
  onChange,
  depth = 0,
}: {
  field: FieldInfo
  value: unknown
  schemas: Record<string, FieldInfo[]>
  onChange: (value: unknown) => void
  depth?: number
}) {
  const lower = field.type.toLowerCase()
  const kind = (field.kind || '').toLowerCase()
  const isBool = kind === 'bool' || lower.includes('bool')
  const isNumber = kind.includes('int') || kind.includes('float') || kind.includes('double') || lower.includes('int') || lower.includes('float') || lower.includes('double')
  const nestedFields = field.message_type ? schemas[field.message_type] : undefined
  const fieldValue = value === undefined ? sampleValueForField(field, schemas) : value

  if (field.oneof) {
    const current = typeof value === 'object' && value && !Array.isArray(value) ? value as Record<string, unknown> : {}
    const selected = Object.keys(current)[0] ?? ''
    const selectedField = field.oneof_fields?.find((choice) => choice.name === selected)
    return (
      <div className="rounded border border-accent/30 bg-accent/5 p-3">
        <div className="flex items-center gap-2 mb-2">
          <p className="text-xs font-semibold text-text-1">{field.name}</p>
          <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">oneof</span>
        </div>
        <select
          value={selected}
          onChange={(event) => {
            const choice = field.oneof_fields?.find((item) => item.name === event.target.value)
            onChange(choice ? { [choice.name]: sampleValueForField(choice, schemas) } : {})
          }}
          className="h-8 w-full rounded border border-border-2 bg-surface-1 px-2 text-xs text-text-1 outline-none focus:border-accent/60"
        >
          <option value="">None</option>
          {field.oneof_fields?.map((choice) => <option key={choice.name} value={choice.name}>{choice.name} · {choice.type}</option>)}
        </select>
        {selectedField && (
          <div className="mt-2">
            <GrpcFieldRenderer
              field={selectedField}
              value={current[selectedField.name]}
              schemas={schemas}
              depth={depth + 1}
              onChange={(next) => onChange({ [selectedField.name]: next })}
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="rounded border border-border-2 bg-surface-2 p-3">
      <div className="flex items-center gap-2 mb-2">
        <p className="text-xs font-semibold text-text-1">{field.name}</p>
        <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-mono text-text-3">{field.type}</span>
        {field.repeated && <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">repeated</span>}
        {field.map && <span className="rounded bg-info/10 px-1.5 py-0.5 text-[10px] text-info">map</span>}
        {field.optional && <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-text-4">optional</span>}
        {field.required && <span className="rounded bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning">required</span>}
        <span className="ml-auto text-[10px] text-text-4">#{field.number}</span>
      </div>
      {field.enum_values?.length ? (
        <select
          value={String(fieldValue ?? '')}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 w-full rounded border border-border-2 bg-surface-1 px-2 text-xs text-text-1 outline-none focus:border-accent/60"
        >
          {field.enum_values.map((item) => <option key={item.name} value={item.name}>{item.name} ({item.number})</option>)}
        </select>
      ) : field.repeated || field.map ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => onChange(field.repeated ? [...(Array.isArray(fieldValue) ? fieldValue : []), sampleValueForField({ ...field, repeated: false }, schemas)] : { ...(typeof fieldValue === 'object' && fieldValue && !Array.isArray(fieldValue) ? fieldValue as Record<string, unknown> : {}), key: sampleValueForField({ ...field, repeated: false, map: false, type: field.value_type || 'string', kind: field.value_type || 'string' }, schemas) })}
              className="h-7 px-2 rounded border border-border-2 bg-surface-1 text-xs text-accent hover:border-accent/45"
            >
              {field.repeated ? 'Add item' : 'Add key'}
            </button>
            <span className="text-[10px] text-text-4">{field.map ? `${field.key_type || 'string'} -> ${field.value_type || field.type}` : 'JSON array'}</span>
          </div>
          <textarea
            value={JSON.stringify(fieldValue ?? (field.repeated ? [] : {}), null, 2)}
            onChange={(event) => {
              try { onChange(JSON.parse(event.target.value)) } catch { onChange(event.target.value) }
            }}
            spellCheck={false}
            className="h-24 w-full resize-y rounded border border-border-2 bg-surface-1 p-2 text-xs text-text-1 font-mono outline-none focus:border-accent/60"
          />
        </div>
      ) : nestedFields && depth < 4 ? (
        <div className="rounded border border-border-2 bg-surface-1 p-2 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-text-4 font-mono">{field.message_type}</span>
            <button
              onClick={() => onChange(buildObjectFromFields(nestedFields, schemas, depth + 1))}
              className="text-[11px] text-accent hover:text-accent-light"
            >
              Reset object
            </button>
          </div>
          {nestedFields.map((nested) => (
            <GrpcFieldRenderer
              key={nested.name}
              field={nested}
              value={(typeof fieldValue === 'object' && fieldValue && !Array.isArray(fieldValue) ? (fieldValue as Record<string, unknown>)[nested.name] : undefined)}
              schemas={schemas}
              depth={depth + 1}
              onChange={(next) => onChange({ ...(typeof fieldValue === 'object' && fieldValue && !Array.isArray(fieldValue) ? fieldValue as Record<string, unknown> : {}), [nested.name]: next })}
            />
          ))}
        </div>
      ) : isBool ? (
        <label className="inline-flex items-center gap-2 text-xs text-text-2">
          <input type="checkbox" checked={Boolean(fieldValue)} onChange={(event) => onChange(event.target.checked)} className="accent-accent" />
          Present / true
        </label>
      ) : isNumber ? (
        <input
          type="number"
          value={typeof fieldValue === 'number' ? fieldValue : 0}
          onChange={(event) => onChange(Number(event.target.value))}
          className="h-8 w-full rounded border border-border-2 bg-surface-1 px-2 text-xs text-text-1 font-mono outline-none focus:border-accent/60"
        />
      ) : lower.includes('timestamp') ? (
        <input
          type="datetime-local"
          value={String(fieldValue ?? '').replace('Z', '').slice(0, 16)}
          onChange={(event) => onChange(event.target.value ? `${event.target.value}:00Z` : '')}
          className="h-8 w-full rounded border border-border-2 bg-surface-1 px-2 text-xs text-text-1 font-mono outline-none focus:border-accent/60"
        />
      ) : field.message_type ? (
        <textarea
          value={typeof fieldValue === 'object' ? JSON.stringify(fieldValue ?? {}, null, 2) : String(fieldValue ?? '{}')}
          onChange={(event) => {
            try { onChange(JSON.parse(event.target.value)) } catch { onChange(event.target.value) }
          }}
          spellCheck={false}
          className="h-24 w-full resize-y rounded border border-border-2 bg-surface-1 p-2 text-xs text-text-1 font-mono outline-none focus:border-accent/60"
        />
      ) : (
        <input
          value={String(fieldValue ?? '')}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 w-full rounded border border-border-2 bg-surface-1 px-2 text-xs text-text-1 font-mono outline-none focus:border-accent/60"
        />
      )}
    </div>
  )
}

function GrpcRawJsonEditor({
  rawJson,
  streaming,
  jsonError,
  onChange,
  onPrettify,
  onCopy,
}: {
  rawJson: string
  streaming: boolean
  jsonError: string
  onChange: (value: string) => void
  onPrettify: () => void
  onCopy: () => void
}) {
  return (
    <section className="rounded-md border border-border-1 bg-surface-1 overflow-hidden">
      <div className="h-10 px-3 border-b border-border-1 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-text-1">Raw Request JSON</p>
          <p className="text-[10px] text-text-4">{streaming ? 'Streaming requests are represented as a JSON array.' : 'Uses protobuf JSON mapping.'}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onPrettify} className="h-7 px-2 rounded border border-border-2 bg-surface-2 text-xs text-text-2 hover:text-accent flex items-center gap-1.5">
            <Wand2 size={12} />
            Format
          </button>
          <button onClick={onCopy} className="h-7 px-2 rounded border border-border-2 bg-surface-2 text-xs text-text-2 hover:text-accent flex items-center gap-1.5">
            <Copy size={12} />
            Copy
          </button>
        </div>
      </div>
      {jsonError && (
        <div className="m-3 rounded border border-error/30 bg-error/10 px-3 py-2 text-xs text-error font-mono">{jsonError}</div>
      )}
      <textarea
        value={rawJson}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        className="h-[420px] w-full resize-none bg-surface-0 p-4 text-xs leading-5 text-text-1 font-mono outline-none"
      />
    </section>
  )
}

function GrpcMethodInspector({
  method,
  service,
  requestFields,
  responseFields,
  sourceKind,
  sourceName,
}: {
  method?: MethodInfo
  service: string
  requestFields: FieldInfo[]
  responseFields: FieldInfo[]
  sourceKind: SourceKind
  sourceName: string
}) {
  const [tab, setTab] = useState<InspectorTab>('details')
  return (
    <aside className="w-[360px] shrink-0 border-l border-border-1 bg-surface-1/80 flex flex-col min-h-0">
      <div className="h-12 px-4 border-b border-border-1 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-text-1">Method Inspector</p>
          <p className="text-[10px] text-text-4">Descriptor and validation context</p>
        </div>
        <Settings2 size={14} className="text-text-4" />
      </div>
      <div className="px-3 pt-3 flex items-center gap-2 border-b border-border-1">
        {(['details', 'request', 'response', 'hints'] as InspectorTab[]).map((item) => (
          <button
            key={item}
            onClick={() => setTab(item)}
            className={cn('px-2 pb-2 text-xs capitalize border-b-2', tab === item ? 'border-accent text-accent' : 'border-transparent text-text-4 hover:text-text-2')}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto p-3">
        {!method ? (
          <div className="rounded border border-dashed border-border-2 p-4 text-xs text-text-4">Select a method to inspect request and response schemas.</div>
        ) : tab === 'details' ? (
          <div className="space-y-3">
            <InspectorRow label="Full Method" value={`/${service}/${method.name}`} />
            <InspectorRow label="RPC Type" value={methodType(method)} badge />
            <InspectorRow label="Package" value={packageName(service)} />
            <InspectorRow label="Proto Source" value={sourceKind === 'reflection' ? 'Server reflection' : sourceName || sourceKind} />
            <InspectorRow label="Request Type" value={method.input_type} />
            <InspectorRow label="Response Type" value={method.output_type} />
          </div>
        ) : tab === 'request' ? (
          <SchemaPreview title={method.input_type} fields={requestFields} />
        ) : tab === 'response' ? (
          <SchemaPreview title={method.output_type} fields={responseFields} />
        ) : (
          <div className="space-y-2 text-xs text-text-3">
            <Hint text="Reflection-backed methods can generate fields and invoke RPCs directly." good={sourceKind === 'reflection'} />
            <Hint text="Uploaded .proto files populate service discovery. Invocation still needs live reflection descriptors in the current backend." good={sourceKind !== 'proto'} />
            <Hint text="Client and bidirectional streams are sent as prepared message arrays, matching grpcui's upfront stream model." good />
            <Hint text="Custom CA and mTLS paths are visible in the UI and ready for backend TLS-profile wiring." />
          </div>
        )}
      </div>
    </aside>
  )
}

function InspectorRow({ label, value, badge }: { label: string; value: string; badge?: boolean }) {
  return (
    <div>
      <p className="mb-1 text-[10px] uppercase tracking-wider text-text-4">{label}</p>
      <div className={cn('rounded border border-border-2 bg-surface-2 px-2 py-2 text-xs font-mono text-text-2 break-all', badge && 'inline-block text-accent')}>
        {value}
      </div>
    </div>
  )
}

function SchemaPreview({ title, fields }: { title: string; fields: FieldInfo[] }) {
  return (
    <div>
      <p className="mb-3 text-xs font-semibold text-accent">{title}</p>
      {fields.length === 0 ? (
        <div className="rounded border border-dashed border-border-2 p-4 text-xs text-text-4">Schema preview is not available for this source yet.</div>
      ) : (
        <pre className="rounded border border-border-2 bg-surface-0 p-3 text-[11px] leading-5 text-text-2 font-mono overflow-auto">{`message ${title.split('.').pop()} {\n${fields.map((field) => `  ${field.repeated ? 'repeated ' : ''}${field.type} ${field.name} = ${field.number};`).join('\n')}\n}`}</pre>
      )}
    </div>
  )
}

function Hint({ text, good }: { text: string; good?: boolean }) {
  return (
    <div className="rounded border border-border-2 bg-surface-2 p-3 flex items-start gap-2">
      {good ? <CheckCircle2 size={14} className="text-success mt-0.5 shrink-0" /> : <AlertTriangle size={14} className="text-warning mt-0.5 shrink-0" />}
      <span>{text}</span>
    </div>
  )
}

function GrpcResponsePanel({
  tab,
  result,
  history,
  logs,
  onTab,
  onCopy,
  onRerun,
  onRestore,
  onClearHistory,
}: {
  tab: BottomTab
  result: InvokeResponse | null
  history: HistoryRow[]
  logs: string[]
  onTab: (tab: BottomTab) => void
  onCopy: () => void
  onRerun: (row: HistoryRow) => void
  onRestore: (row: HistoryRow) => void
  onClearHistory: () => void
}) {
  const responseBody = result ? JSON.stringify(result.messages ?? result.response ?? {}, null, 2) : ''
  const rawResponse = result ? JSON.stringify(result, null, 2) : ''
  const metadata = result?.response_metadata ?? {}

  return (
    <section className="h-[260px] border-t border-border-1 bg-surface-1 flex flex-col min-h-0">
      <div className="h-11 px-3 border-b border-border-1 flex items-center justify-between">
        <div className="flex items-center gap-1">
          {(['response', 'raw', 'metadata', 'trailers', 'logs', 'history'] as BottomTab[]).map((item) => (
            <button
              key={item}
              onClick={() => onTab(item)}
              className={cn('h-8 px-3 rounded text-xs capitalize', tab === item ? 'bg-accent/15 text-accent' : 'text-text-4 hover:text-text-2 hover:bg-surface-2')}
            >
              {item === 'raw' ? 'Raw JSON' : item}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-xs text-text-4">
          {result && (
            <>
              <span className={cn('rounded px-2 py-0.5 font-semibold', result.error ? 'bg-error/10 text-error' : 'bg-success/10 text-success')}>
                {result.status}
              </span>
              <span>Duration: <span className="text-accent">{result.time_ms ?? 0} ms</span></span>
              <span>{new Date().toLocaleTimeString()}</span>
            </>
          )}
          <button onClick={onCopy} className="h-7 px-2 rounded border border-border-2 bg-surface-2 text-xs text-text-2 hover:text-accent flex items-center gap-1.5">
            <Copy size={12} />
            Copy
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {tab === 'response' && (
          <pre className="p-4 text-xs leading-5 text-text-2 font-mono whitespace-pre-wrap">{result ? responseBody : 'No response yet. Invoke a selected RPC to inspect headers, messages, trailers and status.'}</pre>
        )}
        {tab === 'raw' && (
          <pre className="p-4 text-xs leading-5 text-text-2 font-mono whitespace-pre-wrap">{rawResponse || '{}'}</pre>
        )}
        {tab === 'metadata' && (
          <KeyValueBlock data={metadata} empty="No response headers captured yet." />
        )}
        {tab === 'trailers' && (
          <div className="p-4 text-xs text-text-4">Trailer collection is not exposed by the current sidecar response yet. Status and headers are shown above.</div>
        )}
        {tab === 'logs' && (
          <div className="p-4 space-y-1">
            {logs.length === 0 ? <p className="text-xs text-text-4">No gRPC logs yet.</p> : logs.map((line, index) => (
              <p key={index} className="text-xs font-mono text-text-3">{line}</p>
            ))}
          </div>
        )}
        {tab === 'history' && (
          <GrpcCallHistory history={history} onRerun={onRerun} onRestore={onRestore} onClear={onClearHistory} />
        )}
      </div>
    </section>
  )
}

function KeyValueBlock({ data, empty }: { data: Record<string, string>; empty: string }) {
  const entries = Object.entries(data)
  if (entries.length === 0) return <div className="p-4 text-xs text-text-4">{empty}</div>
  return (
    <div className="p-4 grid grid-cols-[220px_1fr] gap-x-4 gap-y-2 text-xs">
      {entries.map(([key, value]) => (
        <div key={key} className="contents">
          <span className="font-mono text-text-4">{key}</span>
          <span className="font-mono text-text-2 break-all">{value}</span>
        </div>
      ))}
    </div>
  )
}

function GrpcCallHistory({
  history,
  onRerun,
  onRestore,
  onClear,
}: {
  history: HistoryRow[]
  onRerun: (row: HistoryRow) => void
  onRestore: (row: HistoryRow) => void
  onClear: () => void
}) {
  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-text-1">Call History</p>
        <button onClick={onClear} className="h-7 px-2 rounded border border-border-2 bg-surface-2 text-xs text-text-3 hover:text-error">Clear</button>
      </div>
      <div className="rounded border border-border-1 overflow-hidden">
        <div className="grid grid-cols-[130px_1fr_120px_90px_90px_140px] bg-surface-2 px-3 py-2 text-[10px] uppercase tracking-wider text-text-4">
          <span>Time</span>
          <span>Method</span>
          <span>Type</span>
          <span>Status</span>
          <span>Duration</span>
          <span>Actions</span>
        </div>
        {history.length === 0 ? (
          <div className="p-4 text-xs text-text-4">No calls yet.</div>
        ) : history.map((row) => (
          <div key={row.id} className="grid grid-cols-[130px_1fr_120px_90px_90px_140px] px-3 py-2 border-t border-border-1 text-xs items-center">
            <span className="text-text-4">{new Date(row.timestamp).toLocaleTimeString()}</span>
            <span className="text-text-2 truncate">{row.service}/{row.method}</span>
            <span className="text-text-4">{row.rpcType}</span>
            <span className={row.error ? 'text-error' : 'text-success'}>{row.status}</span>
            <span className="text-accent">{row.durationMs} ms</span>
            <span className="flex items-center gap-2">
              <button onClick={() => onRerun(row)} className="text-accent hover:text-accent-light">Rerun</button>
              <button onClick={() => onRestore(row)} className="text-text-3 hover:text-text-1">Restore</button>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function GrpcRequestWorkspace({
  services,
  service,
  method,
  requestFields,
  schemas,
  values,
  rawJson,
  streamMessages,
  metadata,
  activeTab,
  jsonError,
  lastResult,
  onService,
  onMethod,
  onValues,
  onRawJson,
  onStreamMessages,
  onMetadata,
  onTab,
  onPrettify,
  onCopyRaw,
}: {
  services: ServiceInfo[]
  service: string
  method: MethodInfo | undefined
  requestFields: FieldInfo[]
  schemas: Record<string, FieldInfo[]>
  values: Record<string, unknown>
  rawJson: string
  streamMessages: string[]
  metadata: MetadataRow[]
  activeTab: MainTab
  jsonError: string
  lastResult: InvokeResponse | null
  onService: (service: string) => void
  onMethod: (method: string) => void
  onValues: (values: Record<string, unknown>) => void
  onRawJson: (json: string) => void
  onStreamMessages: (messages: string[]) => void
  onMetadata: (rows: MetadataRow[]) => void
  onTab: (tab: MainTab) => void
  onPrettify: () => void
  onCopyRaw: () => void
}) {
  const currentService = services.find((item) => item.name === service)
  return (
    <main className="flex-1 min-w-0 min-h-0 flex flex-col bg-surface-0">
      <div className="border-b border-border-1 bg-surface-1 px-3 py-3">
        <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-3 items-end">
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-text-4">
            Service
            <select value={service} onChange={(event) => onService(event.target.value)} className="h-9 rounded-md border border-border-2 bg-surface-2 px-3 text-xs normal-case tracking-normal text-text-1 outline-none focus:border-accent/60">
              <option value="">Select service</option>
              {services.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-text-4">
            Method
            <select value={method?.name ?? ''} onChange={(event) => onMethod(event.target.value)} className="h-9 rounded-md border border-border-2 bg-surface-2 px-3 text-xs normal-case tracking-normal text-text-1 outline-none focus:border-accent/60">
              <option value="">Select method</option>
              {currentService?.methods.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
            </select>
          </label>
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wider text-text-4">RPC Type</p>
            <div className="h-9 flex items-center"><RpcBadge method={method} /></div>
          </div>
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wider text-text-4">Proto</p>
            <div className="h-9 flex items-center rounded border border-border-2 bg-surface-2 px-3 text-xs font-mono text-text-3">{method ? packageName(service) : '-'}</div>
          </div>
        </div>
      </div>
      <div className="px-3 pt-3 flex items-center gap-1 border-b border-border-1">
        {(['form', 'raw', 'response'] as MainTab[]).map((item) => (
          <button
            key={item}
            onClick={() => onTab(item)}
            className={cn('h-9 px-4 text-xs border-b-2 capitalize', activeTab === item ? 'border-accent text-accent' : 'border-transparent text-text-4 hover:text-text-2')}
          >
            {item === 'form' ? 'Request Form' : item === 'raw' ? 'Raw Request JSON' : 'Response'}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-3 space-y-3">
        {activeTab === 'form' && (
          <>
            <GrpcRequestMetadataTable metadata={metadata} onChange={onMetadata} />
            <GrpcDynamicRequestForm
              fields={requestFields}
              schemas={schemas}
              values={values}
              streaming={Boolean(method?.client_streaming)}
              streamMessages={streamMessages}
              onValueChange={onValues}
              onStreamMessagesChange={onStreamMessages}
            />
          </>
        )}
        {activeTab === 'raw' && (
          <GrpcRawJsonEditor rawJson={rawJson} streaming={Boolean(method?.client_streaming)} jsonError={jsonError} onChange={onRawJson} onPrettify={onPrettify} onCopy={onCopyRaw} />
        )}
        {activeTab === 'response' && (
          <div className="rounded-md border border-border-1 bg-surface-1 overflow-hidden">
            <div className="h-10 px-3 border-b border-border-1 flex items-center justify-between">
              <p className="text-sm font-semibold text-text-1">Last Response</p>
              {lastResult && <span className={cn('rounded px-2 py-0.5 text-xs', lastResult.error ? 'bg-error/10 text-error' : 'bg-success/10 text-success')}>{lastResult.status}</span>}
            </div>
            <pre className="h-[460px] overflow-auto p-4 text-xs leading-5 text-text-2 font-mono whitespace-pre-wrap">{lastResult ? JSON.stringify(lastResult.messages ?? lastResult.response ?? lastResult, null, 2) : 'No response yet.'}</pre>
          </div>
        )}
      </div>
    </main>
  )
}

interface GrpcLoadTestResult {
  totalRequests: number
  successful: number
  failed: number
  totalTimeMs: number
  avgMs: number
  minMs: number
  maxMs: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  throughput: number
  errorRate: number
}

function GrpcLoadTestDialog({ port, address, service, method, payload, tls, onClose }: { port: number | null; address: string; service: string; method: string; payload: string; tls: boolean; onClose: () => void }) {
  const [concurrency, setConcurrency] = useState(5)
  const [totalReqs, setTotalReqs] = useState(100)
  const [timeoutMs, setTimeoutMs] = useState(5000)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<GrpcLoadTestResult | null>(null)

  const run = async () => {
    setRunning(true)
    setError('')
    setResult(null)
    try {
      JSON.parse(payload || '{}')
      setResult(await postJson<GrpcLoadTestResult>(port, '/loadtest/grpc', { address, service, method, payload: payload || '{}', tls, concurrency, totalReqs, timeoutMs }))
    } catch (event) {
      setError(event instanceof Error ? event.message : String(event))
    } finally { setRunning(false) }
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" onClick={onClose}>
    <div className="w-full max-w-2xl rounded-lg border border-border-2 bg-surface-1 shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center gap-2 border-b border-border-1 px-4 py-3"><Gauge size={15} className="text-accent" /><div className="min-w-0 flex-1"><div className="text-sm font-semibold text-text-1">gRPC Load Test</div><div className="truncate font-mono text-[10px] text-text-4">{address} · {service}/{method}</div></div><button onClick={onClose} className="text-text-4 hover:text-text-1"><X size={15} /></button></div>
      <div className="flex flex-col gap-4 p-4">
        <div className="grid grid-cols-3 gap-3">{[
          ['Concurrency', concurrency, setConcurrency, 1, 50],
          ['Requests', totalReqs, setTotalReqs, 1, 5000],
          ['Timeout (ms)', timeoutMs, setTimeoutMs, 100, 60000],
        ].map(([label, value, setter, min, max]) => <label key={String(label)} className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-text-4">{label as string}<input type="number" value={value as number} min={min as number} max={max as number} onChange={(event) => (setter as (value: number) => void)(Number(event.target.value))} className="h-8 rounded border border-border-2 bg-surface-2 px-2 text-xs text-text-1 outline-none focus:border-accent" /></label>)}</div>
        {error && <div className="rounded border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">{error}</div>}
        {result && <div className="grid grid-cols-4 gap-2">{[
          ['Total', result.totalRequests], ['Success', result.successful], ['Failed', result.failed], ['Req/s', result.throughput.toFixed(1)],
          ['Avg', `${result.avgMs.toFixed(1)}ms`], ['p50', `${result.p50Ms.toFixed(1)}ms`], ['p95', `${result.p95Ms.toFixed(1)}ms`], ['p99', `${result.p99Ms.toFixed(1)}ms`],
        ].map(([label, value]) => <div key={String(label)} className="rounded border border-border-1 bg-surface-2 p-2"><div className="text-[9px] uppercase text-text-4">{label}</div><div className="mt-1 font-mono text-xs font-semibold text-text-1">{value}</div></div>)}</div>}
        <div className="flex justify-end gap-2"><button onClick={onClose} className="rounded border border-border-2 px-3 py-1.5 text-xs text-text-2">Close</button><button onClick={() => void run()} disabled={running || !port} className="flex items-center gap-1.5 rounded bg-accent px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40"><Play size={11} />{running ? 'Running…' : 'Run load test'}</button></div>
      </div>
    </div>
  </div>
}

export function GrpcPanel() {
  const port = useServerPort()
  const protoInputRef = useRef<HTMLInputElement>(null)
  const protosetInputRef = useRef<HTMLInputElement>(null)
  const [address, setAddress] = useState('localhost:50051')
  const [useTls, setUseTls] = useState(false)
  const [caCertPath, setCaCertPath] = useState('')
  const [clientCertPath, setClientCertPath] = useState('')
  const [clientKeyPath, setClientKeyPath] = useState('')
  const [showTls, setShowTls] = useState(false)
  const [services, setServices] = useState<ServiceInfo[]>([])
  const [selectedService, setSelectedService] = useState('')
  const [selectedMethod, setSelectedMethod] = useState('')
  const [requestFields, setRequestFields] = useState<FieldInfo[]>([])
  const [responseFields, setResponseFields] = useState<FieldInfo[]>([])
  const [descriptorSchemas, setDescriptorSchemas] = useState<Record<string, FieldInfo[]>>({})
  const [requestValues, setRequestValues] = useState<Record<string, unknown>>({})
  const [rawJson, setRawJson] = useState('{}')
  const [streamMessages, setStreamMessages] = useState<string[]>(['{}'])
  const [metadata, setMetadata] = useState<MetadataRow[]>(defaultMetadata)
  const [sourceKind, setSourceKind] = useState<SourceKind>('empty')
  const [sourceName, setSourceName] = useState('')
  const [serviceSearch, setServiceSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')
  const [jsonError, setJsonError] = useState('')
  const [logs, setLogs] = useState<string[]>([])
  const [lastResult, setLastResult] = useState<InvokeResponse | null>(null)
  const [mainTab, setMainTab] = useState<MainTab>('form')
  const [bottomTab, setBottomTab] = useState<BottomTab>('response')
  const [profiles, setProfiles] = useState<GrpcConnectionProfile[]>(() => loadJson(CONNECTIONS_KEY, []))
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>(() => loadJson(HISTORY_KEY, []))
  const [showLoadTest, setShowLoadTest] = useState(false)

  const currentService = services.find((service) => service.name === selectedService)
  const currentMethod = currentService?.methods.find((method) => method.name === selectedMethod)

  useEffect(() => saveJson(CONNECTIONS_KEY, profiles), [profiles])
  useEffect(() => saveJson(HISTORY_KEY, historyRows), [historyRows])

  useEffect(() => {
    if (!currentMethod) return
    const nextValues = buildObjectFromFields(requestFields, descriptorSchemas)
    setRequestValues(nextValues)
    setRawJson(JSON.stringify(currentMethod.client_streaming ? [nextValues] : nextValues, null, 2))
    if (currentMethod.client_streaming) setStreamMessages([JSON.stringify(nextValues, null, 2)])
  }, [currentMethod?.input_type])

  const log = (line: string) => {
    setLogs((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev].slice(0, 80))
  }

  const metadataObject = () => {
    const out: Record<string, string> = {}
    metadata.forEach((row) => {
      if (row.key.trim()) out[row.key.trim()] = row.value
    })
    return out
  }

  const loadDescriptorFields = async (
    serviceName: string,
    methodName: string,
    loadedServices = services,
    descriptorSource: SourceKind = sourceKind,
  ) => {
    const service = loadedServices.find((item) => item.name === serviceName)
    const method = service?.methods.find((item) => item.name === methodName)
    if (!method || descriptorSource === 'proto' || descriptorSource === 'protoset') {
      const localRequestFields = method ? descriptorSchemas[method.input_type] ?? [] : []
      const localResponseFields = method ? descriptorSchemas[method.output_type] ?? [] : []
      setRequestFields(localRequestFields)
      setResponseFields(localResponseFields)
      if (method) {
        const generated = buildObjectFromFields(localRequestFields, descriptorSchemas)
        setRequestValues(generated)
        setRawJson(JSON.stringify(method.client_streaming ? [generated] : generated, null, 2))
        if (method.client_streaming) setStreamMessages([JSON.stringify(generated, null, 2)])
      }
      return
    }
    try {
      const [request, response] = await Promise.all([
        postJson<{ fields: FieldInfo[]; schemas?: Record<string, FieldInfo[]> }>(port, '/grpc/describe', {
          address,
          tls: useTls,
          ca_cert_path: caCertPath,
          client_cert_path: clientCertPath,
          client_key_path: clientKeyPath,
          message_type: method.input_type,
          metadata: metadataObject(),
        }),
        postJson<{ fields: FieldInfo[]; schemas?: Record<string, FieldInfo[]> }>(port, '/grpc/describe', {
          address,
          tls: useTls,
          ca_cert_path: caCertPath,
          client_cert_path: clientCertPath,
          client_key_path: clientKeyPath,
          message_type: method.output_type,
          metadata: metadataObject(),
        }),
      ])
      const nextSchemas = { ...descriptorSchemas, ...(request.schemas ?? {}), ...(response.schemas ?? {}) }
      setDescriptorSchemas(nextSchemas)
      setRequestFields(request.fields ?? [])
      setResponseFields(response.fields ?? [])
      const generated = buildObjectFromFields(request.fields ?? [], nextSchemas)
      setRequestValues(generated)
      setRawJson(JSON.stringify(method.client_streaming ? [generated] : generated, null, 2))
      if (method.client_streaming) setStreamMessages([JSON.stringify(generated, null, 2)])
      log(`described ${method.input_type} -> ${method.output_type}`)
    } catch (event) {
      setRequestFields([])
      setResponseFields([])
      log(`describe failed: ${event instanceof Error ? event.message : String(event)}`)
    }
  }

  const selectMethod = (serviceName: string, methodName: string, loadedServices = services, descriptorSource: SourceKind = sourceKind) => {
    setSelectedService(serviceName)
    setSelectedMethod(methodName)
    if (methodName) void loadDescriptorFields(serviceName, methodName, loadedServices, descriptorSource)
  }

  const handleReflect = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await postJson<DescriptorPayload>(port, '/grpc/reflect', {
        address,
        tls: useTls,
        ca_cert_path: caCertPath,
        client_cert_path: clientCertPath,
        client_key_path: clientKeyPath,
        metadata: metadataObject(),
      })
      const nextServices = data.services ?? []
      setServices(nextServices)
      setDescriptorSchemas(data.schemas ?? {})
      setSourceKind('reflection')
      setSourceName(address)
      setConnected(true)
      log(`reflection loaded ${nextServices.length} services from ${address}`)
      const firstService = nextServices[0]
      const firstMethod = firstService?.methods[0]
      if (firstService && firstMethod) selectMethod(firstService.name, firstMethod.name, nextServices, 'reflection')
    } catch (event) {
      const message = event instanceof Error ? event.message : String(event)
      setError(message)
      setConnected(false)
      log(`reflection error: ${message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleProtoFile = async (file: File | undefined) => {
    if (!file) return
    setLoading(true)
    setError('')
    try {
      const data = await postJson<DescriptorPayload>(port, '/grpc/parse-proto', { source: await file.text() })
      const nextServices = data.services ?? []
      const nextSchemas = data.schemas ?? {}
      if (nextServices.length === 0) throw new Error('No service/rpc definitions found in this .proto file.')
      setServices(nextServices)
      setDescriptorSchemas(nextSchemas)
      setSourceKind('proto')
      setSourceName(file.name)
      setConnected(true)
      setRequestFields([])
      setResponseFields([])
      log(`loaded ${file.name} with ${nextServices.length} services`)
      const firstService = nextServices[0]
      const firstMethod = firstService?.methods[0]
      if (firstService && firstMethod) {
        setSelectedService(firstService.name)
        setSelectedMethod(firstMethod.name)
        setRequestFields(nextSchemas[firstMethod.input_type] ?? [])
        setResponseFields(nextSchemas[firstMethod.output_type] ?? [])
        const generated = buildObjectFromFields(nextSchemas[firstMethod.input_type] ?? [], nextSchemas)
        setRequestValues(generated)
        setRawJson(JSON.stringify(firstMethod.client_streaming ? [generated] : generated, null, 2))
        if (firstMethod.client_streaming) setStreamMessages([JSON.stringify(generated, null, 2)])
      }
    } catch (event) {
      const message = event instanceof Error ? event.message : String(event)
      setError(message)
      log(`proto parse error: ${message}`)
    } finally {
      setLoading(false)
      if (protoInputRef.current) protoInputRef.current.value = ''
    }
  }

  const handleProtoFiles = async (fileList: FileList | null | undefined) => {
    const files = Array.from(fileList ?? [])
    if (files.length === 0) return
    if (files.length === 1) {
      await handleProtoFile(files[0])
      return
    }
    setLoading(true)
    setError('')
    try {
      const sources: Record<string, string> = {}
      const entryFiles: string[] = []
      for (const file of files) {
        const relative = ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name).replace(/\\/g, '/')
        sources[relative] = await file.text()
        entryFiles.push(relative)
      }
      const data = await postJson<DescriptorPayload>(port, '/grpc/parse-proto', { files: sources, entry_files: entryFiles })
      const nextServices = data.services ?? []
      const nextSchemas = data.schemas ?? {}
      if (nextServices.length === 0) throw new Error('No service/rpc definitions found in the selected .proto files.')
      setServices(nextServices)
      setDescriptorSchemas(nextSchemas)
      setSourceKind('proto')
      setSourceName(`${files.length} proto files`)
      setConnected(true)
      log(`loaded ${files.length} proto files with ${nextServices.length} services`)
      const firstService = nextServices[0]
      const firstMethod = firstService?.methods[0]
      if (firstService && firstMethod) {
        setSelectedService(firstService.name)
        setSelectedMethod(firstMethod.name)
        setRequestFields(nextSchemas[firstMethod.input_type] ?? [])
        setResponseFields(nextSchemas[firstMethod.output_type] ?? [])
        const generated = buildObjectFromFields(nextSchemas[firstMethod.input_type] ?? [], nextSchemas)
        setRequestValues(generated)
        setRawJson(JSON.stringify(firstMethod.client_streaming ? [generated] : generated, null, 2))
        if (firstMethod.client_streaming) setStreamMessages([JSON.stringify(generated, null, 2)])
      }
    } catch (event) {
      const message = event instanceof Error ? event.message : String(event)
      setError(message)
      log(`proto import error: ${message}`)
    } finally {
      setLoading(false)
      if (protoInputRef.current) protoInputRef.current.value = ''
    }
  }

  const handleProtosetFile = async (file: File | undefined) => {
    if (!file) return
    setLoading(true)
    setError('')
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      const data = await postJson<DescriptorPayload>(port, '/grpc/parse-protoset', { base64: btoa(binary) })
      const nextServices = data.services ?? []
      const nextSchemas = data.schemas ?? {}
      if (nextServices.length === 0) throw new Error('No services found in this FileDescriptorSet/protoset.')
      setServices(nextServices)
      setDescriptorSchemas(nextSchemas)
      setSourceKind('protoset')
      setSourceName(file.name)
      setConnected(true)
      setRequestFields([])
      setResponseFields([])
      log(`loaded protoset ${file.name} with ${nextServices.length} services`)
      const firstService = nextServices[0]
      const firstMethod = firstService?.methods[0]
      if (firstService && firstMethod) {
        setSelectedService(firstService.name)
        setSelectedMethod(firstMethod.name)
        setRequestFields(nextSchemas[firstMethod.input_type] ?? [])
        setResponseFields(nextSchemas[firstMethod.output_type] ?? [])
        const generated = buildObjectFromFields(nextSchemas[firstMethod.input_type] ?? [], nextSchemas)
        setRequestValues(generated)
        setRawJson(JSON.stringify(firstMethod.client_streaming ? [generated] : generated, null, 2))
        if (firstMethod.client_streaming) setStreamMessages([JSON.stringify(generated, null, 2)])
      }
    } catch (event) {
      const message = event instanceof Error ? event.message : String(event)
      setError(message)
      log(`protoset parse error: ${message}`)
    } finally {
      setLoading(false)
      if (protosetInputRef.current) protosetInputRef.current.value = ''
    }
  }

  const handleProtoset = () => {
    protosetInputRef.current?.click()
  }

  const syncFormToRaw = (values: Record<string, unknown>) => {
    setRequestValues(values)
    if (!currentMethod?.client_streaming) setRawJson(JSON.stringify(values, null, 2))
  }

  const handleRawChange = (value: string) => {
    setRawJson(value)
    try {
      const parsed = JSON.parse(value) as unknown
      setJsonError('')
      if (currentMethod?.client_streaming) {
        if (Array.isArray(parsed)) setStreamMessages(parsed.map((item) => JSON.stringify(item, null, 2)))
      } else if (typeof parsed === 'object' && parsed && !Array.isArray(parsed)) {
        setRequestValues(parsed as Record<string, unknown>)
      }
    } catch (event) {
      setJsonError(event instanceof Error ? event.message : 'Invalid JSON')
    }
  }

  const buildRequest = () => {
    if (!currentMethod) throw new Error('Select a service and method first.')
    if (currentMethod.client_streaming) {
      const raw = rawJson.trim().startsWith('[') ? rawJson : `[${streamMessages.join(',')}]`
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) throw new Error('Streaming request must be a JSON array.')
      return { payload: {}, messages: parsed }
    }
    const parsed = JSON.parse(rawJson || '{}') as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Unary/server-stream request must be a JSON object.')
    return { payload: parsed, messages: undefined }
  }

  const handleInvoke = async () => {
    if (!currentMethod) {
      setError('Select a service and method first.')
      return
    }
    setLoading(true)
    setError('')
    setLastResult(null)
    try {
      const request = buildRequest()
      const started = Date.now()
      const result = await postJson<InvokeResponse>(port, '/grpc/invoke', {
        address,
        tls: useTls,
        ca_cert_path: caCertPath,
        client_cert_path: clientCertPath,
        client_key_path: clientKeyPath,
        service: selectedService,
        method: selectedMethod,
        payload: request.payload,
        messages: request.messages,
        metadata: metadataObject(),
      })
      const duration = result.time_ms ?? Date.now() - started
      setLastResult(result)
      setBottomTab('response')
      setMainTab('response')
      const requestJson = JSON.stringify(request.messages ?? request.payload, null, 2)
      const responseJson = JSON.stringify(result, null, 2)
      const historyRow: HistoryRow = {
        id: newId(),
        timestamp: new Date().toISOString(),
        address,
        service: selectedService,
        method: selectedMethod,
        rpcType: methodType(currentMethod),
        status: result.status,
        durationMs: duration,
        requestBytes: jsonSize(requestJson),
        responseBytes: jsonSize(responseJson),
        metadataCount: Object.keys(metadataObject()).length,
        error: result.error,
        requestJson,
        responseJson,
      }
      setHistoryRows((prev) => [historyRow, ...prev].slice(0, MAX_HISTORY))
      log(`${selectedService}/${selectedMethod} -> ${result.status} in ${duration} ms`)
      if (result.error) setError(result.error)
    } catch (event) {
      const message = event instanceof Error ? event.message : String(event)
      setError(message)
      setJsonError(message)
      log(`invoke error: ${message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleRerunHistory = async (row: HistoryRow) => {
    setLoading(true)
    setError('')
    try {
      const parsed = JSON.parse(row.requestJson) as unknown
      const isStream = Array.isArray(parsed)
      const started = Date.now()
      const result = await postJson<InvokeResponse>(port, '/grpc/invoke', {
        address: row.address,
        tls: useTls,
        ca_cert_path: caCertPath,
        client_cert_path: clientCertPath,
        client_key_path: clientKeyPath,
        service: row.service,
        method: row.method,
        payload: isStream ? {} : parsed,
        messages: isStream ? parsed : undefined,
        metadata: metadataObject(),
      })
      const duration = result.time_ms ?? Date.now() - started
      setAddress(row.address)
      setSelectedService(row.service)
      setSelectedMethod(row.method)
      setRawJson(row.requestJson)
      setLastResult(result)
      setMainTab('response')
      setBottomTab('response')
      const responseJson = JSON.stringify(result, null, 2)
      setHistoryRows((prev) => [{
        ...row,
        id: newId(),
        timestamp: new Date().toISOString(),
        status: result.status,
        durationMs: duration,
        responseBytes: jsonSize(responseJson),
        metadataCount: Object.keys(metadataObject()).length,
        error: result.error,
        responseJson,
      }, ...prev].slice(0, MAX_HISTORY))
      log(`reran ${row.service}/${row.method} -> ${result.status} in ${duration} ms`)
      if (result.error) setError(result.error)
    } catch (event) {
      const message = event instanceof Error ? event.message : String(event)
      setError(message)
      log(`history rerun error: ${message}`)
    } finally {
      setLoading(false)
    }
  }

  const saveProfile = () => {
    const profile: GrpcConnectionProfile = {
      id: newId(),
      name: address,
      address,
      useTls,
      caCertPath,
      clientCertPath,
      clientKeyPath,
    }
    setProfiles((prev) => [profile, ...prev.filter((item) => item.address !== address)].slice(0, 12))
    log(`saved connection ${address}`)
  }

  const restoreHistory = (row: HistoryRow) => {
    setAddress(row.address)
    setSelectedService(row.service)
    setSelectedMethod(row.method)
    setRawJson(row.requestJson)
    setMainTab('raw')
    log(`restored request ${row.service}/${row.method}`)
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-surface-0 text-text-1">
      <input ref={protoInputRef} type="file" accept=".proto" multiple className="hidden" onChange={(event) => handleProtoFiles(event.target.files)} />
      <input ref={protosetInputRef} type="file" accept=".protoset,.pb,.bin,.desc" className="hidden" onChange={(event) => handleProtosetFile(event.target.files?.[0])} />
      <GrpcConnectionBar
        address={address}
        useTls={useTls}
        connected={connected}
        loading={loading}
        profiles={profiles}
        showTls={showTls}
        onAddressChange={setAddress}
        onTlsChange={setUseTls}
        onReflect={handleReflect}
        onInvoke={handleInvoke}
        onLoadTest={() => {
          if (currentMethod?.client_streaming) {
            setError('Load testing currently supports unary and server-streaming methods, not client-streaming RPCs.')
            return
          }
          setShowLoadTest(true)
        }}
        onDisconnect={() => {
          setConnected(false)
          setServices([])
          setSourceKind('empty')
          log(`disconnected from ${address}`)
        }}
        onSave={saveProfile}
        onLoadProfile={(profile) => {
          setAddress(profile.address)
          setUseTls(profile.useTls)
          setCaCertPath(profile.caCertPath ?? '')
          setClientCertPath(profile.clientCertPath ?? '')
          setClientKeyPath(profile.clientKeyPath ?? '')
        }}
        onToggleTls={() => setShowTls((open) => !open)}
        onUploadProto={() => protoInputRef.current?.click()}
        onUploadProtoset={handleProtoset}
      />
      <GrpcTlsSettingsDrawer
        open={showTls}
        useTls={useTls}
        caCertPath={caCertPath}
        clientCertPath={clientCertPath}
        clientKeyPath={clientKeyPath}
        onUseTlsChange={setUseTls}
        onCaChange={setCaCertPath}
        onClientCertChange={setClientCertPath}
        onClientKeyChange={setClientKeyPath}
      />
      {showLoadTest && currentMethod && !currentMethod.client_streaming && <GrpcLoadTestDialog port={port} address={address} service={selectedService} method={selectedMethod} payload={rawJson} tls={useTls} onClose={() => setShowLoadTest(false)} />}
      {error && (
        <div className="mx-4 mt-3 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs text-error flex items-center gap-2">
          <AlertTriangle size={14} />
          <span className="font-mono">{error}</span>
        </div>
      )}
      <div className="flex-1 min-h-0 flex mt-3 border-t border-border-1">
        <GrpcServicesExplorer
          services={services}
          selectedService={selectedService}
          selectedMethod={selectedMethod}
          search={serviceSearch}
          sourceKind={sourceKind}
          sourceName={sourceName}
          connected={connected}
          onSearch={setServiceSearch}
          onSelect={(service, method) => selectMethod(service, method)}
          onRefresh={handleReflect}
          onUploadProto={() => protoInputRef.current?.click()}
        />
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          {services.length === 0 ? (
            <div className="flex-1 m-3 rounded-md border border-dashed border-border-2 bg-surface-1/50 flex items-center justify-center">
              <div className="max-w-md text-center">
                <div className="mx-auto mb-4 h-12 w-12 rounded-lg border border-border-2 bg-surface-2 flex items-center justify-center text-accent">
                  <SplitSquareHorizontal size={22} />
                </div>
                <p className="text-sm font-semibold text-text-1">gRPC Studio</p>
                <p className="mt-2 text-xs leading-5 text-text-4">
                  Reflect a live server or upload a .proto file to browse services, edit metadata, build protobuf JSON requests and inspect responses.
                </p>
                <div className="mt-4 flex items-center justify-center gap-2">
                  <IconButton onClick={handleReflect} disabled={loading || !address} primary><RefreshCw size={13} />Reflect</IconButton>
                  <IconButton onClick={() => protoInputRef.current?.click()}><Upload size={13} />Load Proto</IconButton>
                </div>
              </div>
            </div>
          ) : (
            <>
              <GrpcRequestWorkspace
                services={services}
                service={selectedService}
                method={currentMethod}
                requestFields={requestFields}
                schemas={descriptorSchemas}
                values={requestValues}
                rawJson={rawJson}
                streamMessages={streamMessages}
                metadata={metadata}
                activeTab={mainTab}
                jsonError={jsonError}
                lastResult={lastResult}
                onService={(service) => selectMethod(service, services.find((item) => item.name === service)?.methods[0]?.name ?? '')}
                onMethod={(method) => selectMethod(selectedService, method)}
                onValues={syncFormToRaw}
                onRawJson={handleRawChange}
                onStreamMessages={(messages) => {
                  setStreamMessages(messages)
                  setRawJson(`[${messages.join(',')}]`)
                }}
                onMetadata={setMetadata}
                onTab={setMainTab}
                onPrettify={() => {
                  try {
                    const pretty = safePretty(rawJson)
                    setRawJson(pretty)
                    setJsonError('')
                  } catch (event) {
                    setJsonError(event instanceof Error ? event.message : 'Invalid JSON')
                  }
                }}
                onCopyRaw={() => navigator.clipboard.writeText(rawJson).catch(() => {})}
              />
              <GrpcResponsePanel
                tab={bottomTab}
                result={lastResult}
                history={historyRows}
                logs={logs}
                onTab={setBottomTab}
                onCopy={() => navigator.clipboard.writeText(JSON.stringify(lastResult ?? {}, null, 2)).catch(() => {})}
                onRerun={(row) => void handleRerunHistory(row)}
                onRestore={restoreHistory}
                onClearHistory={() => setHistoryRows([])}
              />
            </>
          )}
        </div>
        <GrpcMethodInspector
          method={currentMethod}
          service={selectedService}
          requestFields={requestFields}
          responseFields={responseFields}
          sourceKind={sourceKind}
          sourceName={sourceName}
        />
      </div>
      <div className="h-7 px-3 border-t border-border-1 bg-surface-0 flex items-center gap-4 text-[11px] text-text-4">
        <span className={cn('font-semibold', connected ? 'text-success' : 'text-error')}>{connected ? 'CONN_OK' : 'CONN_ERR'}</span>
        <span className="flex items-center gap-1"><Clock size={11} /> history {historyRows.length} reqs</span>
        <span className="flex items-center gap-1"><ListTree size={11} /> {services.length} services</span>
        <span className="flex items-center gap-1"><Layers size={11} /> {sourceKind}</span>
        <span className="ml-auto flex items-center gap-1"><History size={11} /> local-first session</span>
        <Download size={12} className="text-text-4" />
        <Braces size={12} className="text-text-4" />
      </div>
    </div>
  )
}
