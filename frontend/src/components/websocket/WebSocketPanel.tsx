import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Zap, ZapOff, Send, Download, Trash2, Plus, X, ChevronDown, ChevronRight,
  Activity, Copy, Check, AlignLeft, Code2, Server, Play, Square,
} from 'lucide-react'
import { useServerPort, serverUrl } from '@/lib/useServerPort'
import { useEnvironmentsStore } from '@/stores/environments'
import { useAppStore } from '@/stores/app'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type AuthType = 'none' | 'bearer' | 'basic'
type ConnStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
type ConditionType = 'any' | 'exact' | 'contains' | 'regex' | 'jsonpath_eq' | 'jsonpath_exists'

interface KVRow { key: string; value: string; enabled: boolean }

interface WSConfig {
  url: string
  authType: AuthType
  token: string
  username: string
  password: string
  headers: KVRow[]
  autoReconnect: boolean
  reconnectDelay: number
}

interface WSMessage {
  id: string
  type: 'message' | 'ping' | 'pong' | 'close' | 'error'
  direction: 'inbound' | 'outbound' | 'system'
  content: string
  timestamp: number
}

interface WSEvent {
  type: string
  direction: string
  content: string
  timestamp: number
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

// ── Helpers ────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'adomnia.websocket'
const CONVERSATION_KEY = 'adomnia.websocket.conversation'
const MOCK_RULES_KEY = 'adomnia.wsmock.rules'

function loadConversation(): WSMessage[] {
  try {
    const raw = localStorage.getItem(CONVERSATION_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return []
}

function saveConversation(msgs: WSMessage[]) {
  try {
    localStorage.setItem(CONVERSATION_KEY, JSON.stringify(msgs.slice(-500)))
  } catch {}
}

function loadConfig(): WSConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...defaultConfig(), ...JSON.parse(raw) }
  } catch {}
  return defaultConfig()
}

function defaultConfig(): WSConfig {
  return {
    url: 'ws://localhost:8080/ws',
    authType: 'none',
    token: '',
    username: '',
    password: '',
    headers: [],
    autoReconnect: false,
    reconnectDelay: 3,
  }
}

function loadRules(): MockRule[] {
  try {
    const raw = localStorage.getItem(MOCK_RULES_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return []
}

function newRule(): MockRule {
  return {
    id: Math.random().toString(36).slice(2),
    name: 'New Rule',
    enabled: true,
    condition: { type: 'any', field: '', value: '' },
    response: '{"status":"ok","echo":"{{$MSG}}"}',
    delayMs: 0,
  }
}

function substVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`)
}

function msgId() { return Math.random().toString(36).slice(2) }

function fmt(ts: number) {
  const d = new Date(ts)
  const ms = String(d.getMilliseconds()).padStart(3, '0').slice(0, 2)
  return d.toLocaleTimeString('en-GB', { hour12: false }) + '.' + ms
}

function tryPrettyJson(s: string): string {
  try { return JSON.stringify(JSON.parse(s), null, 2) } catch { return s }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: ConnStatus }) {
  const colors: Record<ConnStatus, string> = {
    connected: 'bg-success', connecting: 'bg-warning animate-pulse',
    disconnected: 'bg-text-4', error: 'bg-error',
  }
  return <span className={cn('w-2 h-2 rounded-full flex-shrink-0', colors[status])} />
}

function HeadersEditor({ headers, onChange }: { headers: KVRow[]; onChange: (h: KVRow[]) => void }) {
  const add = () => onChange([...headers, { key: '', value: '', enabled: true }])
  const update = (i: number, p: Partial<KVRow>) => onChange(headers.map((h, j) => j === i ? { ...h, ...p } : h))
  const remove = (i: number) => onChange(headers.filter((_, j) => j !== i))
  return (
    <div className="flex flex-col gap-1">
      {headers.map((h, i) => (
        <div key={i} className="flex items-center gap-1">
          <input type="checkbox" checked={h.enabled} onChange={e => update(i, { enabled: e.target.checked })} className="w-3 h-3 accent-accent flex-shrink-0" />
          <input value={h.key} onChange={e => update(i, { key: e.target.value })} placeholder="Header" className="flex-1 h-6 px-1.5 bg-surface-0 border border-border-2 rounded text-[11px] text-text-1 placeholder:text-text-4 focus:outline-none focus:border-accent/40" />
          <input value={h.value} onChange={e => update(i, { value: e.target.value })} placeholder="Value" className="flex-1 h-6 px-1.5 bg-surface-0 border border-border-2 rounded text-[11px] text-text-1 placeholder:text-text-4 focus:outline-none focus:border-accent/40" />
          <button onClick={() => remove(i)} className="w-5 h-5 flex items-center justify-center text-text-4 hover:text-error"><X size={10} /></button>
        </div>
      ))}
      <button onClick={add} className="flex items-center gap-1 text-[10px] text-text-4 hover:text-accent self-start"><Plus size={10} />Add header</button>
    </div>
  )
}

function MessageBubble({ msg }: { msg: WSMessage }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const isJSON = (() => { try { JSON.parse(msg.content); return true } catch { return false } })()
  const copy = () => { navigator.clipboard.writeText(msg.content); setCopied(true); setTimeout(() => setCopied(false), 1200) }
  const dirStyles: Record<string, string> = {
    inbound: 'border-l-2 border-l-blue-500/40 bg-surface-1',
    outbound: 'border-l-2 border-l-green-500/40 bg-surface-1',
    system: 'border-l-2 border-l-text-4/30 bg-surface-0',
  }
  const dirLabel: Record<string, { text: string; color: string }> = {
    inbound:  { text: '← IN',  color: 'text-blue-400' },
    outbound: { text: '→ OUT', color: 'text-green-400' },
    system:   { text: '• SYS', color: 'text-text-4' },
  }
  const typeColor: Record<string, string> = { error: 'text-error', close: 'text-warning', ping: 'text-accent', pong: 'text-accent', message: '' }
  const dir = dirLabel[msg.direction] ?? dirLabel.system
  const tc = typeColor[msg.type] ?? ''
  return (
    <div className={cn('rounded px-2 py-1.5 group relative', dirStyles[msg.direction] ?? dirStyles.system)}>
      <div className="flex items-start gap-2">
        <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
          <span className={cn('text-[9px] font-mono font-semibold w-10', dir.color)}>{dir.text}</span>
          <span className="text-[9px] text-text-4 font-mono">{fmt(msg.timestamp)}</span>
          {msg.type !== 'message' && <span className={cn('text-[9px] font-semibold uppercase', tc)}>{msg.type}</span>}
        </div>
        <div className="flex-1 min-w-0">
          {isJSON && msg.direction !== 'system' ? (
            <div>
              <button onClick={() => setExpanded(v => !v)} className="flex items-center gap-1 text-[10px] text-text-3 hover:text-text-1">
                {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                <span className="font-mono">{expanded ? 'collapse' : msg.content.slice(0, 60) + (msg.content.length > 60 ? '…' : '')}</span>
              </button>
              {expanded && <pre className="mt-1 text-[10px] font-mono text-text-2 whitespace-pre-wrap break-all leading-4 bg-surface-0 rounded p-1.5 border border-border-2">{tryPrettyJson(msg.content)}</pre>}
            </div>
          ) : (
            <p className={cn('text-[11px] font-mono text-text-2 break-all leading-4 whitespace-pre-wrap', tc)}>
              {msg.content.slice(0, 500)}{msg.content.length > 500 ? '…' : ''}
            </p>
          )}
        </div>
        <button onClick={copy} className="opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 flex items-center justify-center text-text-4 hover:text-text-1 flex-shrink-0">
          {copied ? <Check size={10} className="text-success" /> : <Copy size={10} />}
        </button>
      </div>
    </div>
  )
}

// ── Mock Rule Editor ──────────────────────────────────────────────────────────

const CONDITION_LABELS: Record<ConditionType, string> = {
  any: 'Any message',
  exact: 'Exact match',
  contains: 'Contains',
  regex: 'Regex',
  jsonpath_eq: 'JSONPath =',
  jsonpath_exists: 'JSONPath exists',
}

const JSLT_HINT = `JSLT-lite variables:
  {{.field}}        gjson path from incoming JSON
  {{.user.name}}    nested path
  {{.items.0}}      array element
  {{$MSG}}          full incoming message
  {{$NOW}}          unix ms timestamp
  {{$UUID}}         random ID`

function MockRuleCard({ rule, onChange, onDelete }: {
  rule: MockRule
  onChange: (r: MockRule) => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const needsValue = rule.condition.type !== 'any' && rule.condition.type !== 'jsonpath_exists'
  const needsField = rule.condition.type === 'jsonpath_eq' || rule.condition.type === 'jsonpath_exists'

  return (
    <div className={cn('rounded border', rule.enabled ? 'border-border-2 bg-surface-1' : 'border-border-2 bg-surface-0 opacity-60')}>
      {/* Header row */}
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <input
          type="checkbox"
          checked={rule.enabled}
          onChange={e => onChange({ ...rule, enabled: e.target.checked })}
          className="w-3 h-3 accent-accent flex-shrink-0"
        />
        <button onClick={() => setOpen(v => !v)} className="flex-1 flex items-center gap-1.5 text-left">
          {open ? <ChevronDown size={10} className="text-text-4 flex-shrink-0" /> : <ChevronRight size={10} className="text-text-4 flex-shrink-0" />}
          <input
            value={rule.name}
            onChange={e => { e.stopPropagation(); onChange({ ...rule, name: e.target.value }) }}
            onClick={e => e.stopPropagation()}
            className="flex-1 bg-transparent text-[11px] text-text-1 focus:outline-none font-medium"
          />
          <span className="text-[9px] text-text-4 shrink-0 font-mono">
            {CONDITION_LABELS[rule.condition.type]}
          </span>
        </button>
        <button onClick={onDelete} className="w-5 h-5 flex items-center justify-center text-text-4 hover:text-error flex-shrink-0">
          <X size={10} />
        </button>
      </div>

      {/* Expanded editor */}
      {open && (
        <div className="px-2 pb-2 flex flex-col gap-2 border-t border-border-2 pt-2">
          {/* Condition */}
          <div className="flex flex-col gap-1">
            <p className="text-[9px] text-text-4 font-semibold uppercase tracking-wider">Condition</p>
            <div className="flex items-center gap-1.5">
              <select
                value={rule.condition.type}
                onChange={e => onChange({ ...rule, condition: { ...rule.condition, type: e.target.value as ConditionType } })}
                className="h-6 px-1.5 bg-surface-0 border border-border-2 rounded text-[11px] text-text-1 focus:outline-none"
              >
                {(Object.keys(CONDITION_LABELS) as ConditionType[]).map(k => (
                  <option key={k} value={k}>{CONDITION_LABELS[k]}</option>
                ))}
              </select>
              {needsField && (
                <input
                  value={rule.condition.field}
                  onChange={e => onChange({ ...rule, condition: { ...rule.condition, field: e.target.value } })}
                  placeholder="gjson path (e.g. type)"
                  className="flex-1 h-6 px-1.5 bg-surface-0 border border-border-2 rounded text-[11px] text-text-1 placeholder:text-text-4 focus:outline-none focus:border-accent/40 font-mono"
                />
              )}
              {needsValue && (
                <input
                  value={rule.condition.value}
                  onChange={e => onChange({ ...rule, condition: { ...rule.condition, value: e.target.value } })}
                  placeholder="value"
                  className="flex-1 h-6 px-1.5 bg-surface-0 border border-border-2 rounded text-[11px] text-text-1 placeholder:text-text-4 focus:outline-none focus:border-accent/40 font-mono"
                />
              )}
            </div>
          </div>

          {/* Response */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <p className="text-[9px] text-text-4 font-semibold uppercase tracking-wider flex-1">Response template</p>
              <span title={JSLT_HINT} className="text-[9px] text-accent cursor-help border-b border-dashed border-accent/40">JSLT-lite ?</span>
            </div>
            <textarea
              value={rule.response}
              onChange={e => onChange({ ...rule, response: e.target.value })}
              placeholder={'{"status":"ok","echo":"{{$MSG}}"}'}
              rows={3}
              className="w-full font-mono text-[11px] bg-surface-0 border border-border-2 rounded p-1.5 text-text-1 placeholder:text-text-4 resize-none focus:outline-none focus:border-accent/40"
            />
            <p className="text-[9px] text-text-4 font-mono leading-relaxed">
              {'{{.field}}'} · {'{{$MSG}}'} · {'{{$NOW}}'} · {'{{$UUID}}'}
            </p>
          </div>

          {/* Delay */}
          <div className="flex items-center gap-2">
            <p className="text-[9px] text-text-4 font-semibold uppercase tracking-wider">Reply delay</p>
            <input
              type="number"
              min={0}
              max={30000}
              value={rule.delayMs}
              onChange={e => onChange({ ...rule, delayMs: Number(e.target.value) })}
              className="w-16 h-5 px-1 bg-surface-0 border border-border-2 rounded text-[10px] text-text-1 focus:outline-none focus:border-accent/40"
            />
            <span className="text-[9px] text-text-4">ms</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Mock Section ──────────────────────────────────────────────────────────────

function MockSection({ port, onConnectToMock }: {
  port: number | null
  onConnectToMock: (url: string) => void
}) {
  const [running, setRunning] = useState(false)
  const [mockPort, setMockPort] = useState<number | null>(null)
  const [rules, setRules] = useState<MockRule[]>(loadRules)
  const [hits, setHits] = useState<MockHit[]>([])
  const [showHits, setShowHits] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Save rules to localStorage and sync to backend
  const syncRules = useCallback(async (newRules: MockRule[]) => {
    setRules(newRules)
    localStorage.setItem(MOCK_RULES_KEY, JSON.stringify(newRules))
    if (!port) return
    await fetch(serverUrl(port, '/ws/mock/rules'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newRules),
    }).catch(() => {})
  }, [port])

  // Poll status when running
  useEffect(() => {
    if (!running || !port) { if (pollRef.current) clearInterval(pollRef.current); return }
    const poll = async () => {
      try {
        const res = await fetch(serverUrl(port, '/ws/mock/status'))
        const data = await res.json()
        setHits(data.hits ?? [])
      } catch {}
    }
    poll()
    pollRef.current = setInterval(poll, 1500)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [running, port])

  const startMock = async () => {
    if (!port) return
    // Sync current rules first
    await fetch(serverUrl(port, '/ws/mock/rules'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rules),
    }).catch(() => {})
    const res = await fetch(serverUrl(port, '/ws/mock/start'), { method: 'POST' })
    const data = await res.json()
    setMockPort(data.port)
    setRunning(true)
  }

  const stopMock = async () => {
    if (!port) return
    await fetch(serverUrl(port, '/ws/mock/stop'), { method: 'POST' }).catch(() => {})
    setRunning(false)
    setMockPort(null)
  }

  const clearHits = async () => {
    if (!port) return
    await fetch(serverUrl(port, '/ws/mock/hits/clear'), { method: 'POST' }).catch(() => {})
    setHits([])
  }

  const mockUrl = mockPort ? `ws://localhost:${mockPort}` : null

  return (
    <div className="pt-1 border-t border-border-2 flex flex-col gap-2">

      {/* Server control row */}
      <div className="flex items-center gap-2">
        {running ? (
          <button
            onClick={stopMock}
            className="h-6 px-2.5 bg-error/10 border border-error/30 text-error rounded text-[10px] font-semibold hover:bg-error/20 transition-colors flex items-center gap-1.5"
          >
            <Square size={9} />
            Stop
          </button>
        ) : (
          <button
            onClick={startMock}
            disabled={!port}
            className="h-6 px-2.5 bg-accent text-white rounded text-[10px] font-semibold hover:bg-accent-hover transition-colors disabled:opacity-40 flex items-center gap-1.5"
          >
            <Play size={9} />
            Start Mock Server
          </button>
        )}

        {mockUrl && (
          <>
            <code className="text-[10px] text-accent font-mono bg-accent/10 px-1.5 py-0.5 rounded">{mockUrl}</code>
            <button
              onClick={() => onConnectToMock(mockUrl)}
              className="h-6 px-2 bg-surface-2 border border-border-2 rounded text-[10px] text-text-2 hover:text-text-1 transition-colors"
            >
              Connect
            </button>
          </>
        )}
        {running && <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse flex-shrink-0" />}
      </div>

      {/* Rules list */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <p className="text-[9px] text-text-4 font-semibold uppercase tracking-wider flex-1">Rules</p>
          <button
            onClick={() => syncRules([...rules, newRule()])}
            className="flex items-center gap-1 text-[10px] text-text-4 hover:text-accent transition-colors"
          >
            <Plus size={10} />Add
          </button>
        </div>
        {rules.length === 0 && (
          <p className="text-[10px] text-text-4 italic">No rules. Add one to auto-reply to incoming messages.</p>
        )}
        {rules.map((rule, i) => (
          <MockRuleCard
            key={rule.id}
            rule={rule}
            onChange={r => syncRules(rules.map((x, j) => j === i ? r : x))}
            onDelete={() => syncRules(rules.filter((_, j) => j !== i))}
          />
        ))}
      </div>

      {/* Hit log toggle */}
      <button
        onClick={() => setShowHits(v => !v)}
        className={cn('text-[10px] flex items-center gap-1 transition-colors self-start', showHits ? 'text-accent' : 'text-text-4 hover:text-text-2')}
      >
        <ChevronRight size={10} className={cn('transition-transform', showHits && 'rotate-90')} />
        Hit Log
        {hits.length > 0 && (
          <span className="ml-0.5 px-1 bg-accent/20 text-accent rounded text-[9px]">{hits.length}</span>
        )}
      </button>

      {showHits && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <p className="text-[9px] text-text-4 flex-1">Last {hits.length} interactions</p>
            <button onClick={clearHits} className="text-[9px] text-text-4 hover:text-error transition-colors flex items-center gap-1">
              <Trash2 size={9} />Clear
            </button>
          </div>
          <div className="max-h-40 overflow-y-auto flex flex-col gap-0.5 bg-surface-0 rounded border border-border-2 p-1">
            {hits.length === 0 && <p className="text-[10px] text-text-4 italic p-1">No hits yet</p>}
            {[...hits].reverse().map((h, i) => (
              <div key={i} className={cn('flex items-start gap-2 px-1.5 py-1 rounded text-[10px] font-mono', h.matched ? 'bg-success/5' : 'bg-error/5')}>
                <span className={cn('flex-shrink-0 font-semibold', h.matched ? 'text-success' : 'text-error')}>
                  {h.matched ? '✓' : '✗'}
                </span>
                <span className="text-text-4 flex-shrink-0">{fmt(h.timestamp)}</span>
                {h.matched && <span className="text-accent flex-shrink-0 truncate max-w-24">{h.ruleName}</span>}
                <span className="text-text-3 truncate flex-1">{h.incoming.slice(0, 60)}</span>
                {h.matched && <span className="text-text-4 truncate max-w-32">→ {h.response.slice(0, 40)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function WebSocketPanel() {
  const port = useServerPort()
  const getResolvedVars = useEnvironmentsStore(s => s.getResolvedVars)

  const [config, setConfig] = useState<WSConfig>(loadConfig)
  const [status, setStatus] = useState<ConnStatus>('disconnected')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<WSMessage[]>(loadConversation)
  const [draft, setDraft] = useState('')
  const [jsonMode, setJsonMode] = useState(false)
  const [scriptCode, setScriptCode] = useState('')
  const [showScript, setShowScript] = useState(false)
  const [showHeaders, setShowHeaders] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  const [showMock, setShowMock] = useState(false)

  const esRef = useRef<EventSource | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const logRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    return () => { useAppStore.getState().setWebsocketRunning(false) }
  }, [])

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)) }, [config])
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight }, [messages])
  useEffect(() => { saveConversation(messages) }, [messages])
  useEffect(() => () => { esRef.current?.close(); if (reconnectTimer.current) clearTimeout(reconnectTimer.current) }, [])

  const addMsg = useCallback((ev: WSEvent) => {
    const msg: WSMessage = {
      id: msgId(),
      type: ev.type as WSMessage['type'],
      direction: ev.direction as WSMessage['direction'],
      content: ev.content,
      timestamp: ev.timestamp,
    }
    setMessages(prev => [...prev, msg])
    if (ev.direction === 'inbound' && ev.type === 'message' && scriptCode.trim()) {
      try {
        new Function('msg', scriptCode)(msg)
      } catch (e) {
        setMessages(prev => [...prev, {
          id: msgId(), type: 'error', direction: 'system',
          content: `Script error: ${e}`, timestamp: Date.now(),
        }])
      }
    }
  }, [scriptCode])

  const openSSE = useCallback((sid: string) => {
    esRef.current?.close()
    const es = new EventSource(serverUrl(port, `/ws/stream?sessionId=${sid}`))
    esRef.current = es
    es.onmessage = (e) => {
      try {
        const ev: WSEvent = JSON.parse(e.data)
        addMsg(ev)
        if (ev.type === 'close' || ev.type === 'error') {
          setStatus(s => s === 'connected' ? 'disconnected' : s)
          useAppStore.getState().setWebsocketRunning(false)
          setSessionId(null)
          es.close()
          if (config.autoReconnect) {
            reconnectTimer.current = setTimeout(() => handleConnect(), config.reconnectDelay * 1000)
          }
        }
      } catch {}
    }
    es.onerror = () => es.close()
  }, [port, addMsg, config.autoReconnect, config.reconnectDelay])

  const handleConnect = useCallback(async (overrideUrl?: string) => {
    if (!port) return
    setStatus('connecting')
    addMsg({ type: 'message', direction: 'system', content: 'Connecting…', timestamp: Date.now() })
    const vars = getResolvedVars()
    const resolvedUrl = overrideUrl ?? substVars(config.url, vars)
    const resolvedHeaders: Record<string, string> = {}
    for (const h of config.headers) {
      if (h.enabled && h.key) resolvedHeaders[substVars(h.key, vars)] = substVars(h.value, vars)
    }
    try {
      const res = await fetch(serverUrl(port, '/ws/connect'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: resolvedUrl, headers: resolvedHeaders,
          auth: { type: config.authType, token: substVars(config.token, vars), username: substVars(config.username, vars), password: substVars(config.password, vars) },
        }),
      })
      const data = await res.json()
      if (data.error) { setStatus('error'); useAppStore.getState().setWebsocketRunning(false); addMsg({ type: 'error', direction: 'system', content: data.error, timestamp: Date.now() }); return }
      setSessionId(data.sessionId)
      setStatus('connected')
      useAppStore.getState().setWebsocketRunning(true)
      addMsg({ type: 'message', direction: 'system', content: `Connected to ${resolvedUrl}`, timestamp: Date.now() })
      openSSE(data.sessionId)
    } catch (e) {
      setStatus('error')
      useAppStore.getState().setWebsocketRunning(false)
      addMsg({ type: 'error', direction: 'system', content: String(e), timestamp: Date.now() })
    }
  }, [port, config, getResolvedVars, addMsg, openSSE])

  const handleDisconnect = async () => {
    if (!port || !sessionId) return
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    esRef.current?.close()
    await fetch(serverUrl(port, '/ws/disconnect'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) }).catch(() => {})
    setSessionId(null)
    setStatus('disconnected')
    useAppStore.getState().setWebsocketRunning(false)
    addMsg({ type: 'close', direction: 'system', content: 'Disconnected', timestamp: Date.now() })
  }

  const handleSend = async () => {
    if (!port || !sessionId || !draft.trim()) return
    const content = jsonMode ? tryPrettyJson(draft) : draft
    const res = await fetch(serverUrl(port, '/ws/send'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, content }) })
    const data = await res.json()
    if (data.error) addMsg({ type: 'error', direction: 'system', content: data.error, timestamp: Date.now() })
    else setDraft('')
  }

  const handlePing = async () => {
    if (!port || !sessionId) return
    await fetch(serverUrl(port, '/ws/ping'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) }).catch(() => {})
  }

  const exportJSONL = () => {
    const lines = messages.map(m => JSON.stringify({ type: m.type, direction: m.direction, content: m.content, timestamp: m.timestamp })).join('\n')
    const blob = new Blob([lines], { type: 'application/jsonl' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `ws-${Date.now()}.jsonl`; a.click()
    URL.revokeObjectURL(url)
  }

  const connected = status === 'connected'
  const statusLabel: Record<ConnStatus, string> = { connected: 'Connected', connecting: 'Connecting…', disconnected: 'Disconnected', error: 'Error' }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

      {/* ── Config bar ── */}
      <div className="flex-shrink-0 px-3 py-2 border-b border-border-1 bg-surface-1 flex flex-col gap-2">

        {/* URL row */}
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-1 bg-surface-0 border border-border-2 rounded px-2 h-7 focus-within:border-accent/40">
            <span className="text-[9px] font-semibold text-accent flex-shrink-0">WS</span>
            <input
              value={config.url}
              onChange={e => setConfig(c => ({ ...c, url: e.target.value }))}
              placeholder="ws://localhost:8080/ws"
              disabled={connected}
              className="flex-1 bg-transparent text-[11px] text-text-1 placeholder:text-text-4 focus:outline-none font-mono"
              onKeyDown={e => { if (e.key === 'Enter' && !connected) handleConnect() }}
            />
          </div>
          {connected ? (
            <button onClick={handleDisconnect} className="h-7 px-3 bg-error/10 border border-error/30 text-error rounded text-[11px] font-semibold hover:bg-error/20 transition-colors flex items-center gap-1.5">
              <ZapOff size={12} />Disconnect
            </button>
          ) : (
            <button onClick={() => handleConnect()} disabled={!port || status === 'connecting'} className="h-7 px-3 bg-accent text-white rounded text-[11px] font-semibold hover:bg-accent-hover transition-colors disabled:opacity-40 flex items-center gap-1.5">
              <Zap size={12} />Connect
            </button>
          )}
        </div>

        {/* Toggles row */}
        <div className="flex items-center gap-3">
          {[
            { key: 'showAuth', label: 'Auth', state: showAuth, set: setShowAuth },
            { key: 'showHeaders', label: `Headers${config.headers.filter(h => h.enabled && h.key).length > 0 ? ` (${config.headers.filter(h => h.enabled && h.key).length})` : ''}`, state: showHeaders, set: setShowHeaders },
            { key: 'showScript', label: 'On message', state: showScript, set: setShowScript },
            { key: 'showMock', label: 'Mock Server', state: showMock, set: setShowMock },
          ].map(({ key, label, state, set }) => (
            <button key={key} onClick={() => set(v => !v)} className={cn('text-[10px] flex items-center gap-1 transition-colors', state ? 'text-accent' : 'text-text-4 hover:text-text-2')}>
              {key === 'showMock' && <Server size={9} />}
              {key !== 'showMock' && <ChevronRight size={10} className={cn('transition-transform', state && 'rotate-90')} />}
              {label}
              {key === 'showMock' && state && <span className="w-1.5 h-1.5 rounded-full bg-success ml-0.5" />}
            </button>
          ))}

          <div className="flex-1" />
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={config.autoReconnect} onChange={e => setConfig(c => ({ ...c, autoReconnect: e.target.checked }))} className="w-3 h-3 accent-accent" />
            <span className="text-[10px] text-text-4">Auto-reconnect</span>
          </label>
          {config.autoReconnect && (
            <div className="flex items-center gap-1">
              <input type="number" min={1} max={60} value={config.reconnectDelay} onChange={e => setConfig(c => ({ ...c, reconnectDelay: Number(e.target.value) }))} className="w-10 h-5 px-1 bg-surface-0 border border-border-2 rounded text-[10px] text-text-1 focus:outline-none focus:border-accent/40" />
              <span className="text-[10px] text-text-4">s</span>
            </div>
          )}
        </div>

        {/* Auth */}
        {showAuth && (
          <div className="flex items-center gap-2 pt-1">
            <select value={config.authType} onChange={e => setConfig(c => ({ ...c, authType: e.target.value as AuthType }))} className="h-6 px-1.5 bg-surface-0 border border-border-2 rounded text-[11px] text-text-1 focus:outline-none">
              <option value="none">No auth</option>
              <option value="bearer">Bearer Token</option>
              <option value="basic">Basic Auth</option>
            </select>
            {config.authType === 'bearer' && <input value={config.token} onChange={e => setConfig(c => ({ ...c, token: e.target.value }))} placeholder="Token" type="password" className="flex-1 h-6 px-2 bg-surface-0 border border-border-2 rounded text-[11px] text-text-1 placeholder:text-text-4 focus:outline-none focus:border-accent/40" />}
            {config.authType === 'basic' && <>
              <input value={config.username} onChange={e => setConfig(c => ({ ...c, username: e.target.value }))} placeholder="Username" className="flex-1 h-6 px-2 bg-surface-0 border border-border-2 rounded text-[11px] text-text-1 placeholder:text-text-4 focus:outline-none focus:border-accent/40" />
              <input value={config.password} onChange={e => setConfig(c => ({ ...c, password: e.target.value }))} placeholder="Password" type="password" className="flex-1 h-6 px-2 bg-surface-0 border border-border-2 rounded text-[11px] text-text-1 placeholder:text-text-4 focus:outline-none focus:border-accent/40" />
            </>}
          </div>
        )}

        {/* Headers */}
        {showHeaders && <div className="pt-1 border-t border-border-2"><HeadersEditor headers={config.headers} onChange={h => setConfig(c => ({ ...c, headers: h }))} /></div>}

        {/* Script */}
        {showScript && (
          <div className="pt-1 border-t border-border-2 flex flex-col gap-1">
            <p className="text-[10px] text-text-4">Script runs on every inbound message. Variable: <code className="text-accent">msg</code> (type, direction, content, timestamp)</p>
            <textarea value={scriptCode} onChange={e => setScriptCode(e.target.value)} placeholder={'// console.log(msg.content)'} rows={3} className="w-full font-mono text-[11px] bg-surface-0 border border-border-2 rounded p-2 text-text-1 placeholder:text-text-4 resize-none focus:outline-none focus:border-accent/40" />
          </div>
        )}

        {/* Mock server */}
        {showMock && (
          <MockSection port={port} onConnectToMock={url => { setConfig(c => ({ ...c, url })); handleConnect(url) }} />
        )}
      </div>

      {/* ── Status bar ── */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-border-1 bg-surface-0 flex-shrink-0">
        <StatusDot status={status} />
        <span className={cn('text-[10px] font-medium', status === 'connected' && 'text-success', status === 'error' && 'text-error', status === 'connecting' && 'text-warning', status === 'disconnected' && 'text-text-4')}>
          {statusLabel[status]}
        </span>
        {connected && sessionId && <span className="text-[9px] text-text-4 font-mono ml-1">#{sessionId.slice(0, 8)}</span>}
        <div className="flex-1" />
        <span className="text-[10px] text-text-4">{messages.length} messages</span>
        {connected && <button onClick={handlePing} className="h-5 px-2 rounded text-[10px] text-text-3 hover:text-text-1 hover:bg-surface-2 transition-colors flex items-center gap-1"><Activity size={10} />Ping</button>}
        <button onClick={exportJSONL} disabled={messages.length === 0} className="h-5 px-2 rounded text-[10px] text-text-3 hover:text-text-1 hover:bg-surface-2 transition-colors flex items-center gap-1 disabled:opacity-30"><Download size={10} />Export JSONL</button>
        <button onClick={() => setMessages([])} disabled={messages.length === 0} className="h-5 px-2 rounded text-[10px] text-text-3 hover:text-error hover:bg-surface-2 transition-colors flex items-center gap-1 disabled:opacity-30"><Trash2 size={10} />Clear</button>
      </div>

      {/* ── Message log ── */}
      <div ref={logRef} className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-1 min-h-0">
        {messages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Zap size={32} className="text-text-4 mx-auto mb-2 opacity-30" />
              <p className="text-xs text-text-4">No messages yet</p>
              <p className="text-[10px] text-text-4 mt-1">Connect to a WebSocket endpoint to start</p>
            </div>
          </div>
        ) : messages.map(m => <MessageBubble key={m.id} msg={m} />)}
      </div>

      {/* ── Composer ── */}
      <div className="flex-shrink-0 border-t border-border-1 bg-surface-1 px-3 py-2 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <button onClick={() => setJsonMode(false)} className={cn('h-5 px-2 rounded text-[10px] transition-colors flex items-center gap-1', !jsonMode ? 'bg-surface-3 text-text-1' : 'text-text-4 hover:text-text-2')}><AlignLeft size={9} />Text</button>
            <button onClick={() => setJsonMode(true)} className={cn('h-5 px-2 rounded text-[10px] transition-colors flex items-center gap-1', jsonMode ? 'bg-surface-3 text-text-1' : 'text-text-4 hover:text-text-2')}><Code2 size={9} />JSON</button>
          </div>
          <div className="flex-1" />
          {jsonMode && <button onClick={() => { setDraft(tryPrettyJson(draft)); setJsonMode(true) }} className="h-5 px-2 rounded text-[10px] text-text-4 hover:text-accent hover:bg-surface-2 transition-colors">Prettify</button>}
        </div>
        <div className="flex gap-2">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder={jsonMode ? '{"key": "value"}' : 'Type a message…'}
            rows={jsonMode ? 4 : 2}
            disabled={!connected}
            className="flex-1 font-mono text-[11px] bg-surface-0 border border-border-2 rounded p-2 text-text-1 placeholder:text-text-4 resize-none focus:outline-none focus:border-accent/40 disabled:opacity-40"
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !jsonMode) { e.preventDefault(); handleSend() } }}
          />
          <button onClick={handleSend} disabled={!connected || !draft.trim()} className="w-9 bg-accent text-white rounded flex items-center justify-center hover:bg-accent-hover transition-colors disabled:opacity-40 self-end h-8">
            <Send size={14} />
          </button>
        </div>
        <p className="text-[9px] text-text-4">
          {jsonMode ? 'Shift+Enter for new line' : 'Enter to send · Shift+Enter for new line'}
          {' · '}Supports <span className="text-accent font-mono">{'{{variables}}'}</span>
        </p>
      </div>
    </div>
  )
}
