import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  AlignLeft,
  Bell,
  Braces,
  Check,
  Clock,
  Code2,
  Copy,
  Download,
  FileJson,
  History,
  ListFilter,
  Lock,
  MoreVertical,
  PauseCircle,
  Play,
  Plus,
  Save,
  Search,
  Send,
  Server,
  Settings2,
  Shield,
  SlidersHorizontal,
  Square,
  Trash2,
  Unlock,
  Wifi,
  WifiOff,
  X,
  Zap,
  ZapOff,
} from 'lucide-react'
import { getSidecarToken, useServerPort, serverUrl, sidecarFetch } from '@/lib/useServerPort'
import { useEnvironmentsStore } from '@/stores/environments'
import { useAppStore } from '@/stores/app'
import { cn } from '@/lib/utils'
import { safeEval } from '@/lib/safeEval'
import { safeSetItem } from '@/lib/safeLocalStorage'

type AuthType = 'none' | 'bearer' | 'basic'
type ConnStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'reconnecting'
type ConditionType = 'any' | 'exact' | 'contains' | 'regex' | 'jsonpath_eq' | 'jsonpath_exists'
type ConfigTab = 'auth' | 'headers' | 'query' | 'protocols' | 'mock'
type PayloadMode = 'text' | 'json' | 'binary'
type StreamFilter = 'all' | 'inbound' | 'outbound' | 'system' | 'error'

interface KVRow { id: string; key: string; value: string; enabled: boolean }

interface WSConfig {
  url: string
  authType: AuthType
  token: string
  username: string
  password: string
  headers: KVRow[]
  queryParams: KVRow[]
  autoReconnect: boolean
  reconnectDelay: number
  subprotocols: string
}

interface WSMessage {
  id: string
  type: 'message' | 'ping' | 'pong' | 'close' | 'error'
  direction: 'inbound' | 'outbound' | 'system'
  content: string
  timestamp: number
  binary?: boolean
  topic?: string
}

interface WSEvent {
  type: string
  direction: string
  content: string
  timestamp: number
  binary?: boolean
}

interface MockCondition {
  type: ConditionType
  field: string
  value: string
}

interface MockRule {
  id: string
  name: string
  enabled: boolean
  condition: MockCondition
  response: string
  delayMs: number
}

interface MockHit {
  timestamp: number
  ruleId: string
  ruleName: string
  incoming: string
  response: string
  matched: boolean
}

interface MessageTemplate {
  id: string
  name: string
  tag: string
  payload: string
  mode: PayloadMode
  updatedAt: number
}

const STORAGE_KEY = 'adomnia.websocket'
const CONVERSATION_KEY = 'adomnia.websocket.conversation'
const MOCK_RULES_KEY = 'adomnia.wsmock.rules'
const URL_HISTORY_KEY = 'adomnia.websocket.urlhistory'
const TEMPLATES_KEY = 'adomnia.websocket.templates'
const MAX_URL_HISTORY = 12
const MAX_RECONNECT_ATTEMPTS = 10
const MAX_CONVERSATION = 700

const DEFAULT_TEMPLATES: MessageTemplate[] = [
  {
    id: 'join-room',
    name: 'Join room',
    tag: 'join',
    mode: 'json',
    updatedAt: 0,
    payload: JSON.stringify({ type: 'join', room: '{{roomId}}', user: '{{userId}}' }, null, 2),
  },
  {
    id: 'subscribe',
    name: 'Subscribe',
    tag: 'subscribe',
    mode: 'json',
    updatedAt: 0,
    payload: JSON.stringify({ type: 'subscribe', room: '{{roomId}}', token: '{{token}}', params: { since: '2024-01-01T00:00:00Z', limit: 100 } }, null, 2),
  },
  {
    id: 'auth',
    name: 'Authenticate',
    tag: 'auth',
    mode: 'json',
    updatedAt: 0,
    payload: JSON.stringify({ type: 'auth', token: '{{token}}', client: 'adomnia-client' }, null, 2),
  },
  {
    id: 'ping',
    name: 'Ping',
    tag: 'ping',
    mode: 'json',
    updatedAt: 0,
    payload: JSON.stringify({ type: 'ping', ts: '{{$NOW}}' }, null, 2),
  },
]

function id() {
  return Math.random().toString(36).slice(2)
}

function nowMs() {
  return Date.now()
}

function defaultConfig(): WSConfig {
  return {
    url: 'ws://localhost:8080/ws',
    authType: 'none',
    token: '',
    username: '',
    password: '',
    headers: [],
    queryParams: [],
    autoReconnect: false,
    reconnectDelay: 3,
    subprotocols: '',
  }
}

function normalizeRow(row: Partial<KVRow>): KVRow {
  return {
    id: row.id || id(),
    key: row.key || '',
    value: row.value || '',
    enabled: row.enabled ?? true,
  }
}

function loadConfig(): WSConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultConfig()
    const parsed = JSON.parse(raw) as Partial<WSConfig>
    return {
      ...defaultConfig(),
      ...parsed,
      headers: Array.isArray(parsed.headers) ? parsed.headers.map(normalizeRow) : [],
      queryParams: Array.isArray(parsed.queryParams) ? parsed.queryParams.map(normalizeRow) : [],
    }
  } catch {
    return defaultConfig()
  }
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    return fallback
  }
}

function saveConversation(messages: WSMessage[]) {
  safeSetItem(CONVERSATION_KEY, JSON.stringify(messages.slice(-MAX_CONVERSATION)))
}

function loadConversation(): WSMessage[] {
  return loadJson<WSMessage[]>(CONVERSATION_KEY, [])
}

function loadUrlHistory(): string[] {
  return loadJson<string[]>(URL_HISTORY_KEY, [])
}

function saveUrlToHistory(url: string) {
  const trimmed = url.trim()
  if (!trimmed) return
  const history = loadUrlHistory().filter((item) => item !== trimmed)
  history.unshift(trimmed)
  safeSetItem(URL_HISTORY_KEY, JSON.stringify(history.slice(0, MAX_URL_HISTORY)))
}

function loadRules(): MockRule[] {
  return loadJson<MockRule[]>(MOCK_RULES_KEY, [])
}

function loadTemplates(): MessageTemplate[] {
  const saved = loadJson<MessageTemplate[]>(TEMPLATES_KEY, [])
  const merged = [...saved]
  DEFAULT_TEMPLATES.forEach((template) => {
    if (!merged.some((item) => item.id === template.id)) merged.push(template)
  })
  return merged
}

function saveTemplates(templates: MessageTemplate[]) {
  safeSetItem(TEMPLATES_KEY, JSON.stringify(templates))
}

function newRule(): MockRule {
  return {
    id: id(),
    name: 'New Rule',
    enabled: true,
    condition: { type: 'any', field: '', value: '' },
    response: '{"status":"ok","echo":"{{$MSG}}"}',
    delayMs: 0,
  }
}

function substVars(text: string, vars: Record<string, string>): string {
  return text
    .replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`)
    .replace(/\{\{\$NOW\}\}/g, String(Date.now()))
    .replace(/\{\{\$UUID\}\}/g, () => crypto.randomUUID?.() ?? id())
}

function appendQueryParams(url: string, rows: KVRow[], vars: Record<string, string>) {
  const enabledRows = rows.filter((row) => row.enabled && row.key.trim())
  if (enabledRows.length === 0) return url
  try {
    const parsed = new URL(url)
    enabledRows.forEach((row) => parsed.searchParams.set(substVars(row.key, vars), substVars(row.value, vars)))
    return parsed.toString()
  } catch {
    const query = enabledRows
      .map((row) => `${encodeURIComponent(substVars(row.key, vars))}=${encodeURIComponent(substVars(row.value, vars))}`)
      .join('&')
    return `${url}${url.includes('?') ? '&' : '?'}${query}`
  }
}

function resolveUrl(config: WSConfig, vars: Record<string, string>) {
  return appendQueryParams(substVars(config.url, vars), config.queryParams, vars)
}

function fmtTime(ts: number) {
  const date = new Date(ts)
  const ms = String(date.getMilliseconds()).padStart(3, '0').slice(0, 2)
  return `${date.toLocaleTimeString('en-GB', { hour12: false })}.${ms}`
}

function fmtDate(ts: number) {
  return new Date(ts).toISOString().slice(0, 10)
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function tryPrettyJson(text: string): string {
  const parsed = tryParseJson(text)
  return parsed === null ? text : JSON.stringify(parsed, null, 2)
}

function compactPayload(text: string) {
  const parsed = tryParseJson(text)
  if (parsed === null) return text.replace(/\s+/g, ' ').trim()
  return JSON.stringify(parsed)
}

function topicFromPayload(message: WSMessage) {
  if (message.topic) return message.topic
  const parsed = tryParseJson(message.content)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const data = parsed as Record<string, unknown>
    return String(data.type ?? data.event ?? data.topic ?? message.type)
  }
  return message.type
}

function byteSize(text: string) {
  return new Blob([text]).size
}

function statusTone(status: ConnStatus) {
  if (status === 'connected') return 'text-success bg-success/10 border-success/20'
  if (status === 'connecting' || status === 'reconnecting') return 'text-warning bg-warning/10 border-warning/20'
  if (status === 'error') return 'text-error bg-error/10 border-error/20'
  return 'text-text-3 bg-surface-2 border-border-2'
}

function wsSchemeLabel(url: string) {
  return url.trim().toLowerCase().startsWith('wss://') ? 'WSS' : 'WS'
}

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (checked: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 text-[11px] text-text-2 disabled:opacity-40"
    >
      <span className={cn('relative h-4 w-8 rounded-full border transition-colors', checked ? 'border-accent/40 bg-accent/40' : 'border-border-2 bg-surface-2')}>
        <span className={cn('absolute top-0.5 h-2.5 w-2.5 rounded-full transition-transform', checked ? 'translate-x-4 bg-accent-light' : 'translate-x-0.5 bg-text-4')} />
      </span>
      {label && <span>{label}</span>}
    </button>
  )
}

function SectionTitle({ n, children, right }: { n: number; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex h-9 items-center gap-2 border-b border-border-1 px-3">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-surface-3 text-[10px] font-semibold text-text-3">{n}</span>
      <span className="text-[12px] font-semibold text-text-1">{children}</span>
      <div className="ml-auto">{right}</div>
    </div>
  )
}

function MiniButton({
  children,
  onClick,
  disabled,
  active,
  title,
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  active?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center justify-center gap-1.5 rounded border px-2 text-[11px] font-medium transition-colors disabled:opacity-35',
        active ? 'border-accent/40 bg-accent/20 text-accent' : 'border-border-2 bg-surface-1 text-text-2 hover:bg-surface-2 hover:text-text-1',
      )}
    >
      {children}
    </button>
  )
}

function KVEditor({ rows, onChange, keyPlaceholder = 'Key', valuePlaceholder = 'Value' }: {
  rows: KVRow[]
  onChange: (rows: KVRow[]) => void
  keyPlaceholder?: string
  valuePlaceholder?: string
}) {
  const update = (rowId: string, patch: Partial<KVRow>) => onChange(rows.map((row) => row.id === rowId ? { ...row, ...patch } : row))
  const remove = (rowId: string) => onChange(rows.filter((row) => row.id !== rowId))

  return (
    <div className="flex flex-col gap-1.5">
      {rows.length === 0 && <div className="rounded border border-dashed border-border-2 px-3 py-3 text-[11px] text-text-4">No rows configured.</div>}
      {rows.map((row) => (
        <div key={row.id} className="grid grid-cols-[22px_minmax(0,1fr)_minmax(0,1fr)_24px] items-center gap-1.5">
          <input type="checkbox" checked={row.enabled} onChange={(event) => update(row.id, { enabled: event.target.checked })} className="h-3 w-3" />
          <input
            value={row.key}
            onChange={(event) => update(row.id, { key: event.target.value })}
            placeholder={keyPlaceholder}
            className="h-7 min-w-0 rounded border border-border-2 bg-surface-0 px-2 font-mono text-[11px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent/50"
          />
          <input
            value={row.value}
            onChange={(event) => update(row.id, { value: event.target.value })}
            placeholder={valuePlaceholder}
            className="h-7 min-w-0 rounded border border-border-2 bg-surface-0 px-2 font-mono text-[11px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent/50"
          />
          <button type="button" onClick={() => remove(row.id)} className="flex h-6 w-6 items-center justify-center rounded text-text-4 hover:bg-error/10 hover:text-error">
            <X size={12} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...rows, normalizeRow({})])}
        className="mt-1 inline-flex h-7 w-fit items-center gap-1.5 rounded border border-border-2 px-2 text-[11px] text-text-3 hover:bg-surface-2 hover:text-text-1"
      >
        <Plus size={12} /> Add row
      </button>
    </div>
  )
}

function ConfigTabs({
  active,
  onActive,
  config,
  onConfig,
  mockPanel,
}: {
  active: ConfigTab
  onActive: (tab: ConfigTab) => void
  config: WSConfig
  onConfig: (updater: (config: WSConfig) => WSConfig) => void
  mockPanel: React.ReactNode
}) {
  const tabs: Array<{ id: ConfigTab; label: string; icon: React.ReactNode; count?: number }> = [
    { id: 'auth', label: 'Auth', icon: <Shield size={13} /> },
    { id: 'headers', label: 'Headers', icon: <ListFilter size={13} />, count: config.headers.filter((row) => row.enabled && row.key).length },
    { id: 'query', label: 'Query Params', icon: <SlidersHorizontal size={13} />, count: config.queryParams.filter((row) => row.enabled && row.key).length },
    { id: 'protocols', label: 'Sub-protocols', icon: <Settings2 size={13} /> },
    { id: 'mock', label: 'Mock Server', icon: <Server size={13} /> },
  ]

  return (
    <div className="rounded-md border border-border-1 bg-surface-1">
      <div className="flex min-h-9 flex-wrap items-center gap-1 border-b border-border-1 px-2 py-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onActive(tab.id)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded px-3 text-[11px] font-medium transition-colors',
              active === tab.id ? 'bg-accent/20 text-accent shadow-[inset_0_-1px_0_var(--color-accent)]' : 'text-text-3 hover:bg-surface-2 hover:text-text-1',
            )}
          >
            {tab.icon}
            {tab.label}
            {!!tab.count && <span className="rounded bg-surface-3 px-1 font-mono text-[9px] text-text-3">{tab.count}</span>}
          </button>
        ))}
      </div>
      <div className="p-3">
        {active === 'auth' && (
          <div className="grid gap-2 lg:grid-cols-[160px_minmax(0,1fr)]">
            <select
              value={config.authType}
              onChange={(event) => onConfig((current) => ({ ...current, authType: event.target.value as AuthType }))}
              className="h-8 rounded border border-border-2 bg-surface-0 px-2 text-[11px] text-text-1 outline-none"
            >
              <option value="none">No auth</option>
              <option value="bearer">Bearer Token</option>
              <option value="basic">Basic Auth</option>
            </select>
            {config.authType === 'none' && <div className="flex h-8 items-center gap-2 text-[11px] text-text-4"><Unlock size={13} /> Connection will use only configured headers.</div>}
            {config.authType === 'bearer' && (
              <input
                value={config.token}
                onChange={(event) => onConfig((current) => ({ ...current, token: event.target.value }))}
                placeholder="Bearer token, supports {{variables}}"
                type="password"
                className="h-8 rounded border border-border-2 bg-surface-0 px-2 font-mono text-[11px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent/50"
              />
            )}
            {config.authType === 'basic' && (
              <div className="grid gap-2 md:grid-cols-2">
                <input
                  value={config.username}
                  onChange={(event) => onConfig((current) => ({ ...current, username: event.target.value }))}
                  placeholder="Username"
                  className="h-8 rounded border border-border-2 bg-surface-0 px-2 text-[11px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent/50"
                />
                <input
                  value={config.password}
                  onChange={(event) => onConfig((current) => ({ ...current, password: event.target.value }))}
                  placeholder="Password"
                  type="password"
                  className="h-8 rounded border border-border-2 bg-surface-0 px-2 text-[11px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent/50"
                />
              </div>
            )}
          </div>
        )}
        {active === 'headers' && <KVEditor rows={config.headers} onChange={(rows) => onConfig((current) => ({ ...current, headers: rows }))} keyPlaceholder="Header" />}
        {active === 'query' && <KVEditor rows={config.queryParams} onChange={(rows) => onConfig((current) => ({ ...current, queryParams: rows }))} keyPlaceholder="Param" />}
        {active === 'protocols' && (
          <div className="flex flex-col gap-2">
            <input
              value={config.subprotocols}
              onChange={(event) => onConfig((current) => ({ ...current, subprotocols: event.target.value }))}
              placeholder="graphql-transport-ws, graphql-ws, chat"
              className="h-8 rounded border border-border-2 bg-surface-0 px-2 font-mono text-[11px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent/50"
            />
            <div className="text-[10px] text-text-4">Comma-separated values are sent in the WebSocket handshake.</div>
          </div>
        )}
        {active === 'mock' && mockPanel}
      </div>
    </div>
  )
}

function MessageTemplates({
  templates,
  draft,
  mode,
  connected,
  onUse,
  onSend,
  onSave,
  onFormat,
  onValidate,
}: {
  templates: MessageTemplate[]
  draft: string
  mode: PayloadMode
  connected: boolean
  onUse: (template: MessageTemplate) => void
  onSend: () => void
  onSave: () => void
  onFormat: () => void
  onValidate: () => void
}) {
  const recent = [...templates].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4)

  return (
    <div className="flex min-h-0 flex-col rounded-md border border-border-1 bg-surface-1">
      <SectionTitle n={1} right={<span className="text-[10px] text-text-4">{templates.length}</span>}>Message Templates</SectionTitle>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <div>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-text-4">Templates</div>
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
            {templates.slice(0, 6).map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => onUse(template)}
                className="flex h-8 items-center gap-2 rounded border border-border-2 bg-surface-0 px-2 text-left text-[11px] text-text-2 transition-colors hover:border-accent/40 hover:bg-accent/10 hover:text-text-1"
              >
                {template.tag === 'auth' ? <Lock size={13} className="text-accent" /> : template.tag === 'ping' ? <Activity size={13} className="text-info" /> : template.tag === 'subscribe' ? <Bell size={13} className="text-warning" /> : <Zap size={13} className="text-success" />}
                <span className="truncate">{template.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-md border border-border-2 bg-surface-0">
          <div className="flex h-8 items-center gap-1 border-b border-border-2 px-2">
            <span className={cn('inline-flex h-6 items-center gap-1 rounded px-2 text-[10px]', mode === 'text' ? 'bg-surface-3 text-text-1' : 'text-text-4')}>
              <AlignLeft size={11} /> Text
            </span>
            <span className={cn('inline-flex h-6 items-center gap-1 rounded px-2 text-[10px]', mode === 'json' ? 'bg-accent/20 text-accent' : 'text-text-4')}>
              <Braces size={11} /> JSON
            </span>
            <span className={cn('inline-flex h-6 items-center gap-1 rounded px-2 text-[10px]', mode === 'binary' ? 'bg-info/20 text-info' : 'text-text-4')}>
              Bin
            </span>
            <div className="ml-auto flex items-center gap-1">
              <button title="Format JSON" type="button" onClick={onFormat} className="flex h-6 w-6 items-center justify-center rounded text-text-4 hover:bg-surface-2 hover:text-text-1"><Code2 size={12} /></button>
              <button title="Validate JSON" type="button" onClick={onValidate} className="flex h-6 w-6 items-center justify-center rounded text-text-4 hover:bg-surface-2 hover:text-text-1"><Check size={12} /></button>
            </div>
          </div>
          <div className="max-h-[280px] overflow-auto p-2">
            <pre className="min-h-[170px] whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-text-1">{draft || 'Select a template or type a message below.'}</pre>
          </div>
        </div>

        <div>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-text-4">Variables</div>
          <div className="flex flex-wrap gap-2">
            {['{{token}}', '{{roomId}}', '{{userId}}', '{{$NOW}}'].map((variable) => (
              <code key={variable} className="rounded border border-border-2 bg-surface-0 px-2 py-1 text-[11px] text-accent">{variable}</code>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onSend}
            disabled={!connected || !draft.trim()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-accent px-3 text-[12px] font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-35"
          >
            <Send size={15} /> Send
          </button>
          <MiniButton onClick={onSave} disabled={!draft.trim()}><Save size={13} /> Save Template</MiniButton>
        </div>

        <div className="rounded-md border border-border-2 bg-surface-0">
          <div className="flex h-8 items-center gap-2 border-b border-border-2 px-2 text-[11px] font-semibold text-text-2">
            <History size={13} /> Recent Templates
          </div>
          <div className="divide-y divide-border-2/70">
            {recent.length === 0 && <div className="px-3 py-3 text-[11px] text-text-4">No saved templates yet.</div>}
            {recent.map((template) => (
              <button key={template.id} type="button" onClick={() => onUse(template)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-2">
                <span className="min-w-0 flex-1 truncate text-[11px] text-text-1">{template.name}</span>
                <span className="rounded bg-accent/15 px-1.5 py-0.5 font-mono text-[9px] text-accent">{template.tag}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function StreamList({
  messages,
  selectedId,
  paused,
  filter,
  query,
  onSelect,
  onFilter,
  onQuery,
  onClear,
  onExport,
  onPause,
}: {
  messages: WSMessage[]
  selectedId: string | null
  paused: boolean
  filter: StreamFilter
  query: string
  onSelect: (id: string) => void
  onFilter: (filter: StreamFilter) => void
  onQuery: (value: string) => void
  onClear: () => void
  onExport: () => void
  onPause: (paused: boolean) => void
}) {
  return (
    <div className="flex min-h-0 flex-col rounded-md border border-border-1 bg-surface-1">
      <SectionTitle
        n={2}
        right={(
          <div className="flex items-center gap-1">
            <MiniButton onClick={onExport} disabled={messages.length === 0}><Download size={12} /> Export JSONL</MiniButton>
            <MiniButton onClick={onClear} disabled={messages.length === 0}><Trash2 size={12} /> Clear</MiniButton>
          </div>
        )}
      >
        WebSocket Stream
      </SectionTitle>
      <div className="flex flex-wrap items-center gap-1 border-b border-border-1 px-3 py-2">
        {(['all', 'inbound', 'outbound', 'system', 'error'] as StreamFilter[]).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onFilter(item)}
            className={cn('h-7 rounded px-2 text-[10px] font-semibold transition-colors', filter === item ? 'bg-accent text-white' : 'border border-border-2 bg-surface-0 text-text-3 hover:text-text-1')}
          >
            {item === 'inbound' ? 'In' : item === 'outbound' ? 'Out' : item === 'system' ? 'Sys' : item === 'error' ? 'Error' : 'All'}
          </button>
        ))}
        <div className="ml-auto flex min-w-[180px] flex-1 items-center gap-2 rounded border border-border-2 bg-surface-0 px-2">
          <Search size={12} className="text-text-4" />
          <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search messages..." className="h-7 min-w-0 flex-1 bg-transparent font-mono text-[11px] text-text-1 outline-none placeholder:text-text-4" />
        </div>
        <MiniButton active={paused} onClick={() => onPause(!paused)} title="Pause stream rendering">
          {paused ? <Play size={12} /> : <PauseCircle size={12} />} {paused ? 'Resume' : 'Pause'}
        </MiniButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {messages.length === 0 ? (
          <div className="flex h-full min-h-[240px] items-center justify-center text-center">
            <div>
              <Wifi size={34} className="mx-auto mb-3 text-text-4 opacity-40" />
              <div className="text-[12px] font-semibold text-text-2">No frames yet</div>
              <div className="mt-1 text-[11px] text-text-4">Connect, send a template, or start the mock server.</div>
            </div>
          </div>
        ) : (
          <div className="relative pl-3">
            <div className="absolute left-[18px] top-1 bottom-1 w-px bg-border-2" />
            {messages.map((message) => {
              const selected = selectedId === message.id
              const dir = message.direction
              const topic = topicFromPayload(message)
              return (
                <button
                  key={message.id}
                  type="button"
                  onClick={() => onSelect(message.id)}
                  className={cn(
                    'group relative mb-1 grid w-full grid-cols-[72px_52px_minmax(0,1fr)] items-start gap-2 rounded-md border px-2 py-2 text-left transition-colors',
                    selected ? 'border-accent/70 bg-accent/15' : 'border-transparent hover:border-border-2 hover:bg-surface-2/70',
                  )}
                >
                  <span className={cn('absolute -left-[1px] top-4 h-2 w-2 rounded-full border border-surface-1', dir === 'inbound' ? 'bg-accent' : dir === 'outbound' ? 'bg-info' : message.type === 'error' ? 'bg-error' : 'bg-text-4')} />
                  <span className="font-mono text-[10px] text-text-4">{fmtTime(message.timestamp)}</span>
                  <span className={cn(
                    'inline-flex h-5 w-fit items-center rounded px-1.5 font-mono text-[10px] font-semibold uppercase',
                    dir === 'inbound' && 'bg-accent/20 text-accent',
                    dir === 'outbound' && 'bg-info/20 text-info',
                    dir === 'system' && message.type !== 'error' && 'bg-surface-3 text-text-3',
                    message.type === 'error' && 'bg-error/20 text-error',
                  )}>
                    {message.type === 'error' ? 'ERR' : dir === 'inbound' ? 'IN' : dir === 'outbound' ? 'OUT' : 'SYS'}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-semibold text-text-1">{topic}</span>
                    <span className={cn('mt-0.5 block truncate font-mono text-[10px]', message.type === 'error' ? 'text-error' : 'text-text-3')}>
                      {message.binary ? `[binary base64] ${message.content}` : compactPayload(message.content)}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function Inspector({ message, onCopy }: { message: WSMessage | null; onCopy: (text: string) => void }) {
  const parsed = message && !message.binary ? tryParseJson(message.content) : null
  const pretty = message ? (parsed === null ? message.content : JSON.stringify(parsed, null, 2)) : ''

  return (
    <div className="flex min-h-0 flex-col rounded-md border border-border-1 bg-surface-1">
      <SectionTitle n={3} right={<span className="text-[10px] text-text-4">Inspector</span>}>Inspector</SectionTitle>
      {!message ? (
        <div className="flex min-h-[260px] flex-1 items-center justify-center px-6 text-center">
          <div>
            <FileJson size={32} className="mx-auto mb-3 text-text-4 opacity-40" />
            <div className="text-[12px] font-semibold text-text-2">Select a frame</div>
            <div className="mt-1 text-[11px] text-text-4">Payload, metadata and raw frame details appear here.</div>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="grid grid-cols-3 gap-3 rounded-md border border-border-2 bg-surface-0 p-3">
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-text-4">Direction</div>
              <div className={cn('inline-flex rounded px-2 py-1 font-mono text-[11px] font-semibold uppercase', message.direction === 'inbound' ? 'bg-accent/20 text-accent' : message.direction === 'outbound' ? 'bg-info/20 text-info' : 'bg-surface-3 text-text-2')}>{message.direction}</div>
            </div>
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-text-4">Time</div>
              <div className="font-mono text-[12px] text-text-1">{fmtTime(message.timestamp)}</div>
            </div>
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-text-4">Date</div>
              <div className="font-mono text-[12px] text-text-1">{fmtDate(message.timestamp)}</div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-md border border-border-2 bg-surface-0 p-3">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-text-4">Event / Topic</div>
              <div className="truncate text-[12px] font-semibold text-text-1">{topicFromPayload(message)}</div>
            </div>
            <div className="rounded-md border border-border-2 bg-surface-0 p-3">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-text-4">Payload Size</div>
              <div className="font-mono text-[12px] text-text-1">{byteSize(message.content)} B</div>
            </div>
          </div>

          <div className="mt-3 rounded-md border border-border-2 bg-surface-0">
            <div className="flex h-8 items-center gap-2 border-b border-border-2 px-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-text-4">{parsed === null ? 'Payload' : 'Payload JSON'}</span>
              <button type="button" onClick={() => onCopy(pretty)} className="ml-auto flex h-6 w-6 items-center justify-center rounded text-text-4 hover:bg-surface-2 hover:text-text-1"><Copy size={12} /></button>
            </div>
            <pre className="max-h-[310px] overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-5 text-text-1">{pretty}</pre>
          </div>

          <div className="mt-3 rounded-md border border-border-2 bg-surface-0">
            <div className="flex h-8 items-center gap-2 border-b border-border-2 px-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-text-4">Raw Payload</span>
              <button type="button" onClick={() => onCopy(message.content)} className="ml-auto flex h-6 w-6 items-center justify-center rounded text-text-4 hover:bg-surface-2 hover:text-text-1"><Copy size={12} /></button>
            </div>
            <pre className="max-h-[120px] overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[10px] leading-4 text-text-3">{message.content}</pre>
          </div>
        </div>
      )}
    </div>
  )
}

const CONDITION_LABELS: Record<ConditionType, string> = {
  any: 'Any message',
  exact: 'Exact match',
  contains: 'Contains',
  regex: 'Regex',
  jsonpath_eq: 'JSONPath =',
  jsonpath_exists: 'JSONPath exists',
}

function MockServerPanel({ port, onConnectToMock, onSystem }: {
  port: number | null
  onConnectToMock: (url: string) => void
  onSystem: (content: string) => void
}) {
  const [running, setRunning] = useState(false)
  const [mockPort, setMockPort] = useState<number | null>(null)
  const [rules, setRules] = useState<MockRule[]>(loadRules)
  const [hits, setHits] = useState<MockHit[]>([])
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const syncRules = useCallback(async (next: MockRule[]) => {
    setRules(next)
    safeSetItem(MOCK_RULES_KEY, JSON.stringify(next))
    if (!port) return
    await sidecarFetch(serverUrl(port, '/ws/mock/rules'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    }).catch(() => {})
  }, [port])

  const poll = useCallback(async () => {
    if (!port) return
    try {
      const response = await sidecarFetch(serverUrl(port, '/ws/mock/status'))
      const data = await response.json()
      setRunning(Boolean(data.running))
      setMockPort(data.running ? data.port : null)
      setHits(data.hits ?? [])
    } catch {
      setRunning(false)
      setMockPort(null)
    }
  }, [port])

  useEffect(() => {
    void poll()
  }, [poll])

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    if (!port || !running) return undefined
    pollRef.current = setInterval(() => void poll(), 1200)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [poll, port, running])

  const startMock = async () => {
    if (!port) return
    await syncRules(rules)
    const response = await sidecarFetch(serverUrl(port, '/ws/mock/start'), { method: 'POST' })
    const data = await response.json()
    setRunning(true)
    setMockPort(data.port)
    onSystem(`Mock server enabled on ws://localhost:${data.port}`)
  }

  const stopMock = async () => {
    if (!port) return
    await sidecarFetch(serverUrl(port, '/ws/mock/stop'), { method: 'POST' }).catch(() => {})
    setRunning(false)
    setMockPort(null)
    onSystem('Mock server stopped')
  }

  const clearHits = async () => {
    if (!port) return
    await sidecarFetch(serverUrl(port, '/ws/mock/hits/clear'), { method: 'POST' }).catch(() => {})
    setHits([])
  }

  const mockUrl = mockPort ? `ws://localhost:${mockPort}` : null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {running ? (
          <button type="button" onClick={stopMock} className="inline-flex h-8 items-center gap-2 rounded border border-error/30 bg-error/10 px-3 text-[11px] font-semibold text-error hover:bg-error/20">
            <Square size={12} /> Stop Mock
          </button>
        ) : (
          <button type="button" onClick={startMock} disabled={!port} className="inline-flex h-8 items-center gap-2 rounded bg-accent px-3 text-[11px] font-semibold text-white hover:bg-accent-hover disabled:opacity-40">
            <Play size={12} /> Start Mock
          </button>
        )}
        {mockUrl && (
          <>
            <code className="rounded border border-accent/20 bg-accent/10 px-2 py-1 font-mono text-[11px] text-accent">{mockUrl}</code>
            <MiniButton onClick={() => onConnectToMock(mockUrl)}><Zap size={12} /> Connect</MiniButton>
          </>
        )}
        <div className="ml-auto flex items-center gap-2 text-[10px] text-text-4">
          <span className={cn('h-2 w-2 rounded-full', running ? 'bg-success' : 'bg-text-4')} />
          {hits.length} hit{hits.length === 1 ? '' : 's'}
        </div>
      </div>

      <div className="rounded-md border border-border-2 bg-surface-0">
        <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_76px_58px] border-b border-border-2 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-4">
          <span>When incoming</span>
          <span>Then reply</span>
          <span>Delay</span>
          <span>Enabled</span>
        </div>
        <div className="divide-y divide-border-2/70">
          {rules.length === 0 && <div className="px-3 py-4 text-[11px] text-text-4">No rules. Add one to auto-reply to incoming messages.</div>}
          {rules.map((rule) => (
            <div key={rule.id} className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_76px_58px] items-center gap-2 px-3 py-2">
              <div className="min-w-0">
                <input
                  value={rule.name}
                  onChange={(event) => syncRules(rules.map((item) => item.id === rule.id ? { ...item, name: event.target.value } : item))}
                  className="mb-1 h-6 w-full rounded border border-border-2 bg-surface-1 px-2 text-[11px] text-text-1 outline-none focus:border-accent/50"
                />
                <div className="flex gap-1">
                  <select
                    value={rule.condition.type}
                    onChange={(event) => syncRules(rules.map((item) => item.id === rule.id ? { ...item, condition: { ...item.condition, type: event.target.value as ConditionType } } : item))}
                    className="h-6 min-w-0 flex-1 rounded border border-border-2 bg-surface-1 px-2 text-[10px] text-text-2 outline-none"
                  >
                    {(Object.keys(CONDITION_LABELS) as ConditionType[]).map((condition) => <option key={condition} value={condition}>{CONDITION_LABELS[condition]}</option>)}
                  </select>
                  {(rule.condition.type === 'jsonpath_eq' || rule.condition.type === 'jsonpath_exists') && (
                    <input
                      value={rule.condition.field}
                      onChange={(event) => syncRules(rules.map((item) => item.id === rule.id ? { ...item, condition: { ...item.condition, field: event.target.value } } : item))}
                      placeholder="path"
                      className="h-6 min-w-0 flex-1 rounded border border-border-2 bg-surface-1 px-2 font-mono text-[10px] text-text-1 outline-none"
                    />
                  )}
                  {rule.condition.type !== 'any' && rule.condition.type !== 'jsonpath_exists' && (
                    <input
                      value={rule.condition.value}
                      onChange={(event) => syncRules(rules.map((item) => item.id === rule.id ? { ...item, condition: { ...item.condition, value: event.target.value } } : item))}
                      placeholder="value"
                      className="h-6 min-w-0 flex-1 rounded border border-border-2 bg-surface-1 px-2 font-mono text-[10px] text-text-1 outline-none"
                    />
                  )}
                </div>
              </div>
              <textarea
                value={rule.response}
                onChange={(event) => syncRules(rules.map((item) => item.id === rule.id ? { ...item, response: event.target.value } : item))}
                rows={3}
                className="min-h-[54px] resize-none rounded border border-border-2 bg-surface-1 px-2 py-1 font-mono text-[10px] leading-4 text-text-1 outline-none focus:border-accent/50"
              />
              <input
                type="number"
                min={0}
                max={30000}
                value={rule.delayMs}
                onChange={(event) => syncRules(rules.map((item) => item.id === rule.id ? { ...item, delayMs: Number(event.target.value) } : item))}
                className="h-7 rounded border border-border-2 bg-surface-1 px-2 font-mono text-[10px] text-text-1 outline-none"
              />
              <div className="flex items-center gap-1">
                <input type="checkbox" checked={rule.enabled} onChange={(event) => syncRules(rules.map((item) => item.id === rule.id ? { ...item, enabled: event.target.checked } : item))} className="h-3 w-3" />
                <button type="button" onClick={() => syncRules(rules.filter((item) => item.id !== rule.id))} className="flex h-6 w-6 items-center justify-center rounded text-text-4 hover:bg-error/10 hover:text-error"><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <MiniButton onClick={() => syncRules([...rules, newRule()])}><Plus size={12} /> Add Rule</MiniButton>
        <MiniButton onClick={clearHits} disabled={hits.length === 0}><Trash2 size={12} /> Clear Hits</MiniButton>
      </div>
    </div>
  )
}

function SystemEvents({ events }: { events: WSMessage[] }) {
  const items = events.slice(-8).reverse()
  return (
    <div className="rounded-md border border-border-1 bg-surface-1">
      <div className="flex h-8 items-center gap-2 border-b border-border-1 px-3 text-[11px] font-semibold text-text-2">
        <Activity size={13} /> System Events
      </div>
      <div className="grid max-h-24 grid-cols-1 gap-x-6 overflow-y-auto px-3 py-2 lg:grid-cols-2">
        {items.length === 0 && <div className="text-[11px] text-text-4">No system events.</div>}
        {items.map((event) => (
          <div key={event.id} className="grid grid-cols-[64px_36px_minmax(0,1fr)] items-center gap-2 py-1 font-mono text-[10px]">
            <span className="text-text-4">{fmtTime(event.timestamp).slice(0, 8)}</span>
            <span className={cn('rounded px-1 py-0.5 text-center font-semibold', event.type === 'error' ? 'bg-error/20 text-error' : 'bg-surface-3 text-text-3')}>{event.type === 'error' ? 'ERR' : 'SYS'}</span>
            <span className={cn('truncate', event.type === 'error' ? 'text-error' : 'text-text-2')}>{event.content}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function WebSocketPanel() {
  const port = useServerPort()
  const getResolvedVars = useEnvironmentsStore((state) => state.getResolvedVars)

  const [config, setConfig] = useState<WSConfig>(loadConfig)
  const [status, setStatus] = useState<ConnStatus>('disconnected')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<WSMessage[]>(loadConversation)
  const [draft, setDraft] = useState(DEFAULT_TEMPLATES[1].payload)
  const [payloadMode, setPayloadMode] = useState<PayloadMode>('json')
  const [activeTab, setActiveTab] = useState<ConfigTab>('auth')
  const [templates, setTemplates] = useState<MessageTemplate[]>(loadTemplates)
  const [filter, setFilter] = useState<StreamFilter>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [urlHistory, setUrlHistory] = useState<string[]>(loadUrlHistory)
  const [showUrlHistory, setShowUrlHistory] = useState(false)
  const [paused, setPaused] = useState(false)
  const [queuedEvents, setQueuedEvents] = useState<WSMessage[]>([])
  const [scriptCode, setScriptCode] = useState('')
  const [showScript, setShowScript] = useState(false)
  const [copied, setCopied] = useState(false)
  const [activeSessions, setActiveSessions] = useState(0)

  const esRef = useRef<EventSource | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const manualDisconnectRef = useRef(false)
  const configRef = useRef(config)
  const sessionIdRef = useRef<string | null>(null)

  const connected = status === 'connected'

  const addMessage = useCallback((event: WSEvent | WSMessage) => {
    const message: WSMessage = 'id' in event ? event : {
      id: id(),
      type: (event.type as WSMessage['type']) || 'message',
      direction: (event.direction as WSMessage['direction']) || 'system',
      content: event.content,
      timestamp: event.timestamp || nowMs(),
      binary: event.binary,
    }
    if (paused && message.direction !== 'system') {
      setQueuedEvents((prev) => [...prev, message].slice(-200))
      return
    }
    setMessages((prev) => [...prev, message].slice(-MAX_CONVERSATION))
    setSelectedId((current) => current ?? message.id)
  }, [paused])

  const addSystem = useCallback((content: string, type: WSMessage['type'] = 'message') => {
    addMessage({ id: id(), type, direction: 'system', content, timestamp: nowMs() })
  }, [addMessage])

  const refreshSessions = useCallback(async () => {
    const url = serverUrl(port, '/ws/list')
    if (!url) return
    try {
      const response = await sidecarFetch(url)
      const data = await response.json()
      if (response.ok && Array.isArray(data)) setActiveSessions(data.length)
    } catch {}
  }, [port])

  const closeAllSessions = async () => {
    const url = serverUrl(port, '/ws/close-all')
    if (!url) return
    await sidecarFetch(url, { method: 'POST' }).catch(() => {})
    esRef.current?.close()
    sessionIdRef.current = null
    setSessionId(null)
    setStatus('disconnected')
    setActiveSessions(0)
    addSystem('All WebSocket sessions closed.')
  }

  const selectedMessage = useMemo(() => messages.find((message) => message.id === selectedId) ?? messages[messages.length - 1] ?? null, [messages, selectedId])

  const filteredMessages = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return messages.filter((message) => {
      if (filter === 'inbound' && message.direction !== 'inbound') return false
      if (filter === 'outbound' && message.direction !== 'outbound') return false
      if (filter === 'system' && message.direction !== 'system') return false
      if (filter === 'error' && message.type !== 'error') return false
      if (!needle) return true
      return `${message.content} ${topicFromPayload(message)} ${message.direction}`.toLowerCase().includes(needle)
    })
  }, [messages, filter, query])

  const systemEvents = useMemo(() => messages.filter((message) => message.direction === 'system'), [messages])

  useEffect(() => { configRef.current = config }, [config])
  useEffect(() => { sessionIdRef.current = sessionId }, [sessionId])
  useEffect(() => { safeSetItem(STORAGE_KEY, JSON.stringify(config)) }, [config])
  useEffect(() => { saveConversation(messages) }, [messages])
  useEffect(() => { saveTemplates(templates) }, [templates])
  useEffect(() => { void refreshSessions() }, [refreshSessions, sessionId])

  useEffect(() => {
    useAppStore.getState().setWebsocketRunning(connected)
  }, [connected])

  useEffect(() => {
    return () => {
      useAppStore.getState().setWebsocketRunning(false)
      esRef.current?.close()
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!paused && queuedEvents.length > 0) {
      setMessages((prev) => [...prev, ...queuedEvents].slice(-MAX_CONVERSATION))
      setQueuedEvents([])
    }
  }, [paused, queuedEvents])

  const handleConnect = useCallback(async (overrideUrl?: string) => {
    if (!port) {
      addSystem('Sidecar server is not ready yet.', 'error')
      return
    }

    manualDisconnectRef.current = false
    setStatus(reconnectAttemptsRef.current > 0 ? 'reconnecting' : 'connecting')

    const vars = getResolvedVars()
    const resolvedUrl = overrideUrl ?? resolveUrl(configRef.current, vars)
    const resolvedHeaders: Record<string, string> = {}
    configRef.current.headers.forEach((row) => {
      if (row.enabled && row.key.trim()) resolvedHeaders[substVars(row.key, vars)] = substVars(row.value, vars)
    })
    const protocols = configRef.current.subprotocols.split(',').map((item) => item.trim()).filter(Boolean)
    const cfg = configRef.current

    addSystem(`${reconnectAttemptsRef.current > 0 ? 'Reconnecting' : 'Connecting'} to ${resolvedUrl}`)

    try {
      const response = await sidecarFetch(serverUrl(port, '/ws/connect'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: resolvedUrl,
          headers: resolvedHeaders,
          subprotocols: protocols.length ? protocols : undefined,
          auth: {
            type: cfg.authType,
            token: substVars(cfg.token, vars),
            username: substVars(cfg.username, vars),
            password: substVars(cfg.password, vars),
          },
        }),
      })
      const data = await response.json()
      if (data.error) {
        setStatus('error')
        addSystem(data.error, 'error')
        return
      }
      setSessionId(data.sessionId)
      setStatus('connected')
      reconnectAttemptsRef.current = 0
      saveUrlToHistory(resolvedUrl)
      setUrlHistory(loadUrlHistory())
      addSystem(`Connected to ${resolvedUrl}`)

      esRef.current?.close()
      const token = await getSidecarToken()
      const stream = new EventSource(serverUrl(port, `/ws/stream?sessionId=${encodeURIComponent(data.sessionId)}&token=${encodeURIComponent(token)}`))
      esRef.current = stream
      const scheduleReconnect = () => {
        if (!manualDisconnectRef.current && configRef.current.autoReconnect && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttemptsRef.current += 1
          setStatus('reconnecting')
          addSystem(`Auto-reconnect scheduled (${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})`)
          reconnectTimer.current = setTimeout(() => void handleConnect(), configRef.current.reconnectDelay * 1000)
        }
      }

      stream.onmessage = (event) => {
        try {
          const frame = JSON.parse(event.data) as WSEvent
          addMessage(frame)
          if (frame.direction === 'inbound' && frame.type === 'message' && scriptCode.trim()) {
            const msg = {
              id: id(),
              type: frame.type as WSMessage['type'],
              direction: frame.direction as WSMessage['direction'],
              content: frame.content,
              timestamp: frame.timestamp,
              binary: frame.binary,
            }
            void safeEval(scriptCode, { msg }).catch((err) => addSystem(`Script error: ${String(err)}`, 'error'))
          }
          if (frame.type === 'close' || frame.type === 'error') {
            stream.close()
            setSessionId(null)
            setStatus(frame.type === 'error' ? 'error' : 'disconnected')
            scheduleReconnect()
          }
        } catch {
          addSystem('Malformed stream event received.', 'error')
        }
      }
      stream.onerror = () => {
        stream.close()
        setSessionId(null)
        setStatus('disconnected')
        scheduleReconnect()
      }
    } catch (error) {
      setStatus('error')
      addSystem(String(error), 'error')
    }
  }, [addMessage, addSystem, getResolvedVars, port, scriptCode])

  const handleDisconnect = useCallback(async () => {
    manualDisconnectRef.current = true
    reconnectAttemptsRef.current = 0
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    esRef.current?.close()
    if (port && sessionIdRef.current) {
      await sidecarFetch(serverUrl(port, '/ws/disconnect'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionIdRef.current }),
      }).catch(() => {})
    }
    setSessionId(null)
    setStatus('disconnected')
    addSystem('Disconnected', 'close')
  }, [addSystem, port])

  const handleSend = useCallback(async () => {
    if (!port || !sessionIdRef.current || !draft.trim()) return
    const vars = getResolvedVars()
    const resolvedDraft = substVars(draft, vars)
    const content = payloadMode === 'json' ? tryPrettyJson(resolvedDraft) : resolvedDraft.trim()
    const body: Record<string, string> = { sessionId: sessionIdRef.current, content }
    if (payloadMode === 'binary') body.messageType = 'binary'

    try {
      const response = await sidecarFetch(serverUrl(port, '/ws/send'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json()
      if (data.error) addSystem(data.error, 'error')
      else setDraft('')
    } catch (error) {
      addSystem(String(error), 'error')
    }
  }, [addSystem, draft, getResolvedVars, payloadMode, port])

  const handlePing = async () => {
    if (!port || !sessionIdRef.current) return
    await sidecarFetch(serverUrl(port, '/ws/ping'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionIdRef.current }),
    }).catch((error) => addSystem(String(error), 'error'))
  }

  const clearSession = async () => {
    setMessages([])
    setSelectedId(null)
    safeSetItem(CONVERSATION_KEY, JSON.stringify([]))
  }

  const exportJSONL = () => {
    const lines = messages.map((message) => JSON.stringify({
      type: message.type,
      direction: message.direction,
      content: message.content,
      timestamp: message.timestamp,
      binary: message.binary,
    })).join('\n')
    const blob = new Blob([lines], { type: 'application/jsonl' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `adomnia-websocket-${Date.now()}.jsonl`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const copyText = (text: string) => {
    void navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1000)
  }

  const useTemplate = (template: MessageTemplate) => {
    setDraft(template.payload)
    setPayloadMode(template.mode)
    setTemplates((current) => current.map((item) => item.id === template.id ? { ...item, updatedAt: nowMs() } : item))
  }

  const saveTemplate = () => {
    const parsed = tryParseJson(draft)
    const name = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? String((parsed as Record<string, unknown>).type ?? (parsed as Record<string, unknown>).event ?? 'Custom message')
      : 'Custom message'
    const template: MessageTemplate = { id: id(), name, tag: name.toLowerCase().slice(0, 16), payload: draft, mode: payloadMode, updatedAt: nowMs() }
    setTemplates((current) => [template, ...current].slice(0, 40))
    addSystem(`Template saved: ${name}`)
  }

  const validateJson = () => {
    if (payloadMode !== 'json') {
      addSystem('JSON validation is available only in JSON mode.')
      return
    }
    const parsed = tryParseJson(draft)
    addSystem(parsed === null ? 'Invalid JSON payload.' : 'JSON payload is valid.', parsed === null ? 'error' : 'message')
  }

  const updateConfig = (updater: (current: WSConfig) => WSConfig) => setConfig((current) => updater(current))

  const statusLabel: Record<ConnStatus, string> = {
    connected: 'Connected',
    connecting: 'Connecting',
    disconnected: 'Disconnected',
    error: 'Error',
    reconnecting: 'Reconnecting',
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-surface-0">
      <div className="flex-shrink-0 border-b border-border-1 bg-surface-1 px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border-2 bg-surface-0 px-2 focus-within:border-accent/50">
            <span className="rounded bg-accent/15 px-1.5 py-1 font-mono text-[10px] font-semibold text-accent">{wsSchemeLabel(config.url)}</span>
            <input
              value={config.url}
              disabled={connected}
              onChange={(event) => setConfig((current) => ({ ...current, url: event.target.value }))}
              onKeyDown={(event) => { if (event.key === 'Enter' && !connected) void handleConnect() }}
              onFocus={() => setShowUrlHistory(true)}
              onBlur={() => setTimeout(() => setShowUrlHistory(false), 140)}
              placeholder="ws://localhost:8080/ws"
              className="h-9 min-w-0 flex-1 bg-transparent font-mono text-[13px] text-text-1 outline-none placeholder:text-text-4 disabled:opacity-60"
            />
            {urlHistory.length > 0 && !connected && (
              <button type="button" onClick={() => setShowUrlHistory((value) => !value)} className="text-text-4 hover:text-text-1"><Clock size={14} /></button>
            )}
            {showUrlHistory && urlHistory.length > 0 && !connected && (
              <div className="absolute left-3 right-[410px] top-[52px] z-30 overflow-hidden rounded-md border border-border-1 bg-surface-2 shadow-lg">
                {urlHistory.map((url) => (
                  <button key={url} type="button" onMouseDown={() => { setConfig((current) => ({ ...current, url })); setShowUrlHistory(false) }} className="block w-full truncate px-3 py-2 text-left font-mono text-[11px] text-text-2 hover:bg-surface-3 hover:text-text-1">
                    {url}
                  </button>
                ))}
              </div>
            )}
          </div>

          {connected ? (
            <button type="button" onClick={() => void handleDisconnect()} className="inline-flex h-9 items-center gap-2 rounded-md border border-error/30 bg-error/10 px-4 text-[12px] font-semibold text-error hover:bg-error/20">
              <ZapOff size={14} /> Disconnect
            </button>
          ) : (
            <button type="button" onClick={() => void handleConnect()} disabled={!port || status === 'connecting'} className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-[12px] font-semibold text-white hover:bg-accent-hover disabled:opacity-40">
              <Zap size={14} /> Connect
            </button>
          )}

          <Toggle checked={config.autoReconnect} onChange={(checked) => setConfig((current) => ({ ...current, autoReconnect: checked }))} label="Auto-reconnect" />
          <div className={cn('inline-flex h-9 items-center gap-2 rounded-full border px-3 text-[11px] font-semibold', statusTone(status))}>
            {connected ? <Wifi size={13} /> : <WifiOff size={13} />}
            {statusLabel[status]}
            {connected && <span className="font-mono text-[10px] text-text-4">{fmtTime(nowMs()).slice(0, 8)}</span>}
          </div>
          <MiniButton onClick={() => void refreshSessions()}><Server size={13} /> {activeSessions} sessions</MiniButton>
          {activeSessions > 0 && <MiniButton onClick={() => void closeAllSessions()}><Trash2 size={13} /> Close all</MiniButton>}
          <MiniButton onClick={() => copyText(resolveUrl(config, getResolvedVars()))}>{copied ? <Check size={13} /> : <Copy size={13} />} Copy URL</MiniButton>
          <button type="button" className="flex h-9 w-9 items-center justify-center rounded-md border border-border-2 bg-surface-0 text-text-3 hover:bg-surface-2 hover:text-text-1">
            <MoreVertical size={15} />
          </button>
        </div>

        <div className="mt-2">
          <ConfigTabs
            active={activeTab}
            onActive={setActiveTab}
            config={config}
            onConfig={updateConfig}
            mockPanel={<MockServerPanel port={port} onConnectToMock={(url) => { setConfig((current) => ({ ...current, url })); void handleConnect(url) }} onSystem={addSystem} />}
          />
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden p-2 xl:grid-cols-[minmax(300px,0.95fr)_minmax(420px,1.3fr)_minmax(320px,0.95fr)]">
        <MessageTemplates
          templates={templates}
          draft={draft}
          mode={payloadMode}
          connected={connected}
          onUse={useTemplate}
          onSend={() => void handleSend()}
          onSave={saveTemplate}
          onFormat={() => setDraft((current) => tryPrettyJson(current))}
          onValidate={validateJson}
        />

        <StreamList
          messages={filteredMessages}
          selectedId={selectedMessage?.id ?? null}
          paused={paused}
          filter={filter}
          query={query}
          onSelect={setSelectedId}
          onFilter={setFilter}
          onQuery={setQuery}
          onClear={() => void clearSession()}
          onExport={exportJSONL}
          onPause={setPaused}
        />

        <div className="flex min-h-0 flex-col gap-2">
          <Inspector message={selectedMessage} onCopy={copyText} />
          {showScript && (
            <div className="rounded-md border border-border-1 bg-surface-1 p-2">
              <textarea
                value={scriptCode}
                onChange={(event) => setScriptCode(event.target.value)}
                placeholder="// Runs locally for every inbound message. Variable: msg"
                rows={4}
                className="w-full resize-none rounded border border-border-2 bg-surface-0 p-2 font-mono text-[11px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent/50"
              />
            </div>
          )}
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-border-1 bg-surface-1 px-3 py-2">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {(['text', 'json', 'binary'] as PayloadMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setPayloadMode(mode)}
              className={cn('inline-flex h-7 items-center gap-1.5 rounded border px-2 text-[11px] font-medium capitalize', payloadMode === mode ? 'border-accent/40 bg-accent/20 text-accent' : 'border-border-2 bg-surface-0 text-text-3 hover:text-text-1')}
            >
              {mode === 'json' ? <Braces size={13} /> : mode === 'text' ? <AlignLeft size={13} /> : <Code2 size={13} />}
              {mode}
            </button>
          ))}
          <MiniButton onClick={() => setShowScript(!showScript)} active={showScript}><Code2 size={12} /> On Message Script</MiniButton>
          {connected && <MiniButton onClick={() => void handlePing()}><Activity size={12} /> Ping</MiniButton>}
          {queuedEvents.length > 0 && <span className="rounded bg-warning/10 px-2 py-1 text-[10px] text-warning">{queuedEvents.length} queued while paused</span>}
          {config.autoReconnect && (
            <div className="ml-auto flex items-center gap-1 text-[10px] text-text-4">
              <Clock size={12} />
              delay
              <input
                type="number"
                min={1}
                max={60}
                value={config.reconnectDelay}
                onChange={(event) => setConfig((current) => ({ ...current, reconnectDelay: Number(event.target.value) }))}
                className="h-6 w-12 rounded border border-border-2 bg-surface-0 px-1 font-mono text-[10px] text-text-1 outline-none"
              />
              s
            </div>
          )}
        </div>
        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_44px]">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault()
                void handleSend()
              }
            }}
            disabled={!connected}
            placeholder={payloadMode === 'binary' ? 'Base64-encoded binary payload' : payloadMode === 'json' ? '{"type":"message","text":"hello"}' : 'Type a WebSocket message'}
            rows={payloadMode === 'json' ? 4 : 3}
            className={cn('min-h-[76px] resize-none rounded-md border bg-surface-0 p-2 font-mono text-[12px] leading-5 text-text-1 outline-none placeholder:text-text-4 disabled:opacity-45', payloadMode === 'binary' ? 'border-info/40 focus:border-info' : 'border-border-2 focus:border-accent/50')}
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!connected || !draft.trim()}
            className="flex h-full min-h-[76px] items-center justify-center rounded-md bg-accent text-white transition-colors hover:bg-accent-hover disabled:opacity-35"
            title="Send Ctrl+Enter"
          >
            <Send size={18} />
          </button>
        </div>
        <div className="mt-2 flex items-center gap-3 text-[10px] text-text-4">
          <span>Ctrl+Enter sends</span>
          <span>Variables are resolved locally before send</span>
          <span>{messages.length} frames stored locally</span>
        </div>
      </div>

      <div className="flex-shrink-0 px-2 pb-2">
        <SystemEvents events={systemEvents} />
      </div>
    </div>
  )
}
