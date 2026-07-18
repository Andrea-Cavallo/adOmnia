import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Plus, Trash2, RefreshCw, Play, Square,
  ChevronDown, ChevronRight, Download, Upload,
  Server, Radio, Zap, Copy, Mic, Search, X, Sparkles
} from 'lucide-react'
import { AiMockDialog } from './AiMockDialog'
import { MockConditionEditor } from './MockConditionEditor'
import { MockSchemaEditor, STARTER_SCHEMA } from './MockSchemaEditor'
import { useServerPort, serverUrl, sidecarFetch } from '@/lib/useServerPort'
import { useAppStore } from '@/stores/app'
import { useCollectionsStore } from '@/stores/collections'
import { useSettingsStore } from '@/stores/settings'
import type { MockCondition, RequestItem, TreeNode } from '@/lib/types'
import { uid } from '@/lib/types'
import { cn } from '@/lib/utils'

interface MockResponse {
  id: string
  name: string
  status: number
  headers: Record<string, string>
  body: string
  generationMode?: 'static' | 'schema'
  bodySchema?: string
  conditions?: MockCondition[]
  delayMs: number
  isActive: boolean
}

interface MockEndpoint {
  id: string
  path: string
  method: string
  description: string
  responses: MockResponse[]
  mode: string
  enabled: boolean
}

interface MockStatus {
  running: boolean
  port: number
}

interface HitEntry {
  id: string
  timestamp: string
  method: string
  path: string
  matched: boolean
  responseId: string
  status: number
}

const METHODS = ['GET', 'QUERY', 'POST', 'PUT', 'PATCH', 'DELETE', 'ANY']
const REST_METHODS = new Set(['GET', 'QUERY', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
const MODES = [
  { value: 'first_active', label: 'First Active' },
  { value: 'random', label: 'Random' },
  { value: 'round_robin', label: 'Round Robin' },
]

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-method-get',
  QUERY: 'text-info',
  POST: 'text-method-post',
  PUT: 'text-method-put',
  PATCH: 'text-method-patch',
  DELETE: 'text-method-delete',
  ANY: 'text-info',
}

function defaultResponse(n: number): MockResponse {
  return {
    id: uid(),
    name: `Response ${n}`,
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: '{\n  "output": "something",\n  "errorMessage": {}\n}',
    delayMs: 0,
    isActive: true,
  }
}

function responseBodyFor(method: string, path: string): string {
  if (method === 'DELETE') return '{\n  "deleted": true,\n  "path": "' + path + '"\n}'
  if (method === 'QUERY') return '{\n  "ok": true,\n  "path": "' + path + '",\n  "query": "processed",\n  "results": []\n}'
  if (method === 'POST') return '{\n  "id": "mock_1001",\n  "created": true,\n  "path": "' + path + '"\n}'
  if (method === 'PUT' || method === 'PATCH') return '{\n  "updated": true,\n  "path": "' + path + '"\n}'
  return '{\n  "ok": true,\n  "path": "' + path + '",\n  "items": [\n    { "id": "demo_1", "name": "Demo item" }\n  ]\n}'
}

function normalizeMockPath(rawUrl: string): string {
  const withoutVars = rawUrl
    .replace(/\{\{\s*base_url\s*\}\}/gi, '')
    .replace(/\{\{\s*mockApiBase\s*\}\}/gi, '')
    .replace(/\{\{[^}]+\}\}/g, ':param')
  try {
    const parsed = new URL(withoutVars.startsWith('http') ? withoutVars : `http://local${withoutVars.startsWith('/') ? '' : '/'}${withoutVars}`)
    return parsed.pathname || '/'
  } catch {
    const trimmed = withoutVars.split('?')[0].trim()
    return trimmed.startsWith('/') ? trimmed : `/${trimmed || 'api/example'}`
  }
}

function endpointFromRequest(req: RequestItem): MockEndpoint | null {
  if (!REST_METHODS.has(req.method)) return null
  const path = normalizeMockPath(req._openapiPath || req.url || `/${req.name.toLowerCase().replace(/\s+/g, '-')}`)
  return {
    id: uid(),
    path,
    method: req.method,
    description: req.name || `${req.method} ${path}`,
    responses: [{
      id: uid(),
      name: `${req.method} ${path} success`,
      status: req.method === 'POST' ? 201 : req.method === 'DELETE' ? 204 : 200,
      headers: { 'Content-Type': 'application/json' },
      body: responseBodyFor(req.method, path),
      delayMs: 0,
      isActive: true,
    }],
    mode: 'first_active',
    enabled: true,
  }
}

function collectRestEndpoints(nodes: TreeNode[], out: MockEndpoint[] = []): MockEndpoint[] {
  nodes.forEach((node) => {
    if (node.type === 'folder') collectRestEndpoints(node.children, out)
    else {
      const endpoint = endpointFromRequest(node)
      if (endpoint) out.push(endpoint)
    }
  })
  return out
}

function defaultRestEndpoints(): MockEndpoint[] {
  return [
    ['GET', '/health', 'Health check'],
    ['GET', '/v1/users', 'List users'],
    ['GET', '/v1/users/:param', 'Get user'],
    ['QUERY', '/v1/users/search', 'Safe query users'],
    ['POST', '/v1/users', 'Create user'],
    ['PUT', '/v1/users/:param', 'Replace user'],
    ['PATCH', '/v1/users/:param', 'Patch user'],
    ['DELETE', '/v1/users/:param', 'Delete user'],
    ['OPTIONS', '/v1/users', 'CORS preflight'],
  ].map(([method, path, description]) => ({
    id: uid(),
    method,
    path,
    description,
    responses: [{
      id: uid(),
      name: `${method} ${path} preset`,
      status: method === 'POST' ? 201 : method === 'DELETE' ? 204 : 200,
      headers: { 'Content-Type': 'application/json' },
      body: responseBodyFor(method, path),
      delayMs: 0,
      isActive: true,
    }],
    mode: 'first_active',
    enabled: true,
  }))
}

function statusColor(status: number): string {
  if (status >= 500) return 'text-error'
  if (status >= 300) return 'text-warning'
  return 'text-success'
}

function statusBg(status: number): string {
  if (status >= 500) return 'bg-error/15'
  if (status >= 300) return 'bg-warning/15'
  return 'bg-success/15'
}

const BODY_MODES = [
  { value: 'static', label: 'Static' },
  { value: 'schema', label: 'Schema' },
] as const

function HeadersEditor({
  headers,
  onChange,
}: {
  headers: Record<string, string>
  onChange: (h: Record<string, string>) => void
}) {
  const entries = Object.entries(headers)

  const set = (i: number, k: string, v: string) => {
    const next = [...entries]
    next[i] = [k, v]
    onChange(Object.fromEntries(next))
  }
  const remove = (i: number) => {
    const next = entries.filter((_, idx) => idx !== i)
    onChange(Object.fromEntries(next.length ? next : [['', '']]))
  }
  const add = () => onChange({ ...headers, '': '' })

  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-[1fr_1fr_24px] gap-1 px-1 text-[9px] uppercase tracking-wider text-text-4">
        <span>Header</span><span>Value</span><span />
      </div>
      {entries.map(([k, v], i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_24px] gap-1 items-center group">
          <input
            value={k}
            onChange={(e) => set(i, e.target.value, v)}
            placeholder="Content-Type"
            className="h-6 px-2 bg-surface-2 border border-border-2 rounded text-[11px] text-text-1 font-mono outline-none focus:border-accent"
          />
          <input
            value={v}
            onChange={(e) => set(i, k, e.target.value)}
            placeholder="application/json"
            className="h-6 px-2 bg-surface-2 border border-border-2 rounded text-[11px] text-text-1 font-mono outline-none focus:border-accent"
          />
          <button onClick={() => remove(i)} className="w-6 h-6 flex items-center justify-center text-text-4 hover:text-error opacity-0 group-hover:opacity-100">
            <Trash2 size={10} />
          </button>
        </div>
      ))}
      <button onClick={add} className="self-start text-[10px] text-accent hover:text-accent-light flex items-center gap-1 px-1">
        <Plus size={10} /> header
      </button>
    </div>
  )
}

function ResponseCard({
  resp,
  onChange,
  onRemove,
  canRemove,
  onDuplicate,
}: {
  resp: MockResponse
  onChange: (r: MockResponse) => void
  onRemove: () => void
  canRemove: boolean
  onDuplicate: () => void
}) {
  const [open, setOpen] = useState(false)
  const upd = (patch: Partial<MockResponse>) => onChange({ ...resp, ...patch })

  return (
    <div className={cn(
      'border rounded-sm transition-colors',
      resp.isActive ? 'border-border-2 bg-surface-2' : 'border-border-1 bg-surface-0 opacity-50',
    )}>
      <div className="flex items-center gap-1.5 px-2 py-1">
        <button onClick={() => setOpen(!open)} className="text-text-4 hover:text-text-2">
          {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </button>

        <span className={cn(
          'px-1.5 py-0.5 rounded text-[10px] font-mono font-bold min-w-[2.5rem] text-center',
          statusBg(resp.status), statusColor(resp.status),
        )}>
          {resp.status}
        </span>

        <input
          value={resp.name}
          onChange={(e) => upd({ name: e.target.value })}
          className="flex-1 min-w-0 bg-transparent text-[11px] text-text-1 outline-none placeholder:text-text-4"
          placeholder="Response name"
        />

        {(resp.conditions?.length ?? 0) > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-accent/15 text-[9px] font-semibold text-accent">
            {resp.conditions!.length} cond
          </span>
        )}

        <button
          onClick={() => upd({ isActive: !resp.isActive })}
          className={cn(
            'px-1.5 py-0.5 text-[9px] font-semibold rounded transition-colors',
            resp.isActive ? 'bg-success/15 text-success hover:bg-success/25' : 'bg-surface-3 text-text-4 hover:text-text-2',
          )}
        >
          {resp.isActive ? 'ON' : 'OFF'}
        </button>

        <button onClick={onDuplicate} className="text-text-4 hover:text-accent p-0.5" title="Duplicate">
          <Copy size={10} />
        </button>

        {canRemove && (
          <button onClick={onRemove} className="text-text-4 hover:text-error p-0.5">
            <Trash2 size={10} />
          </button>
        )}
      </div>

      {open && (
        <div className="px-3 pb-3 flex flex-col gap-2.5 border-t border-border-1/50 pt-2">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5">
              <span className="text-[10px] text-text-4 w-12">Status</span>
              <input
                type="number"
                min={100}
                max={599}
                value={resp.status}
                onChange={(e) => upd({ status: Math.max(100, Math.min(599, Number(e.target.value))) })}
                className="w-16 h-6 px-2 bg-surface-2 border border-border-2 rounded text-[11px] text-text-1 outline-none focus:border-accent"
              />
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-[10px] text-text-4 w-14">Delay ms</span>
              <input
                type="number"
                min={0}
                value={resp.delayMs}
                onChange={(e) => upd({ delayMs: Math.max(0, Number(e.target.value)) })}
                className="w-20 h-6 px-2 bg-surface-2 border border-border-2 rounded text-[11px] text-text-1 outline-none focus:border-accent"
              />
            </label>
          </div>

          <details className="flex flex-col gap-1" open>
            <summary className="text-[10px] text-text-4 cursor-pointer hover:text-text-2 select-none">
              Headers ({Object.keys(resp.headers).length})
            </summary>
            <div className="mt-1">
              <HeadersEditor headers={resp.headers} onChange={(h) => upd({ headers: h })} />
            </div>
          </details>

          <details className="flex flex-col gap-1">
            <summary className="text-[10px] text-text-4 cursor-pointer hover:text-text-2 select-none">
              Conditions ({resp.conditions?.length ?? 0})
            </summary>
            <div className="mt-1">
              <MockConditionEditor
                conditions={resp.conditions ?? []}
                onChange={(conditions) => upd({ conditions })}
              />
            </div>
          </details>

          <details className="flex flex-col gap-1" open>
            <summary className="text-[10px] text-text-4 cursor-pointer hover:text-text-2 select-none">
              {resp.generationMode === 'schema'
                ? `Body schema (${(resp.bodySchema || '').length} chars)`
                : `Body (${resp.body.length} chars)`}
            </summary>
            <div className="mt-1 flex items-center gap-1 rounded border border-border-1 bg-surface-2 p-0.5 w-fit">
              {BODY_MODES.map((mode) => (
                <button
                  key={mode.value}
                  onClick={() => upd({
                    generationMode: mode.value,
                    bodySchema: mode.value === 'schema' && !resp.bodySchema ? STARTER_SCHEMA : resp.bodySchema,
                  })}
                  className={cn(
                    'h-5 px-2 rounded-sm text-[10px] font-medium transition-colors',
                    (resp.generationMode || 'static') === mode.value
                      ? 'bg-accent text-white'
                      : 'text-text-4 hover:text-text-1 hover:bg-surface-3',
                  )}
                  type="button"
                >
                  {mode.label}
                </button>
              ))}
            </div>
            {(resp.generationMode || 'static') === 'schema' ? (
              <MockSchemaEditor
                value={resp.bodySchema || ''}
                onChange={(bodySchema) => upd({ bodySchema })}
              />
            ) : (
              <textarea
                value={resp.body}
                onChange={(e) => upd({ body: e.target.value })}
                rows={Math.min(12, Math.max(3, resp.body.split('\n').length))}
                className="w-full mt-1 px-2.5 py-2 bg-surface-2 border border-border-2 rounded text-[11px] text-text-1 font-mono outline-none focus:border-accent resize-y leading-relaxed"
                spellCheck={false}
              />
            )}
          </details>
        </div>
      )}
    </div>
  )
}

function EndpointCard({
  ep,
  onChange,
  onRemove,
}: {
  ep: MockEndpoint
  onChange: (ep: MockEndpoint) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(true)
  const upd = (patch: Partial<MockEndpoint>) => onChange({ ...ep, ...patch })
  const enabled = ep.enabled !== false // default true for old data

  const updateResponse = (id: string, patch: Partial<MockResponse>) =>
    upd({ responses: ep.responses.map((r) => (r.id === id ? { ...r, ...patch } : r)) })

  const removeResponse = (id: string) =>
    upd({ responses: ep.responses.filter((r) => r.id !== id) })

  const duplicateResponse = (res: MockResponse) =>
    upd({ responses: [...ep.responses, { ...res, id: uid(), name: `${res.name} copy` }] })

  const addResponse = () =>
    upd({ responses: [...ep.responses, defaultResponse(ep.responses.length + 1)] })

  const activeCount = ep.responses.filter((r) => r.isActive).length

  return (
    <div className={cn(
      'border rounded-md overflow-hidden transition-opacity',
      enabled ? 'bg-surface-1 border-border-1' : 'bg-surface-0 border-border-1 opacity-50',
    )}>
      <div className="flex items-center gap-2 px-3 py-2">
        <button onClick={() => setOpen(!open)} className="text-text-4 hover:text-text-2">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>

        {/* Enable/disable toggle */}
        <button
          onClick={() => upd({ enabled: !enabled })}
          title={enabled ? 'Click to disable this endpoint' : 'Click to enable this endpoint'}
          className={cn(
            'px-1.5 py-0.5 text-[9px] font-bold rounded border transition-colors flex-shrink-0',
            enabled
              ? 'bg-success/15 border-success/30 text-success hover:bg-success/25'
              : 'bg-surface-3 border-border-2 text-text-4 hover:text-text-2 hover:bg-surface-2',
          )}
        >
          {enabled ? 'ON' : 'OFF'}
        </button>

        <select
          value={ep.method}
          onChange={(e) => upd({ method: e.target.value })}
          className={cn(
            'h-6 px-1.5 bg-surface-2 border border-border-2 rounded text-[11px] font-bold outline-none',
            METHOD_COLORS[ep.method] ?? 'text-text-1',
          )}
        >
          {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>

        <input
          value={ep.path}
          onChange={(e) => upd({ path: e.target.value })}
          placeholder="/api/endpoint"
          className="flex-1 h-6 px-2 bg-surface-2 border border-border-2 rounded text-[11px] text-text-1 font-mono outline-none focus:border-accent placeholder:text-text-4"
        />

        <div className="flex items-center gap-1 text-[10px] text-text-4">
          <span>{activeCount}/{ep.responses.length} active</span>
        </div>

        <button onClick={onRemove} className="text-text-4 hover:text-error p-0.5">
          <Trash2 size={12} />
        </button>
      </div>

      {open && (
        <div className="px-3 pb-3 flex flex-col gap-2.5 border-t border-border-1/50 pt-2">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 flex-1">
              <span className="text-[10px] text-text-4 w-10">Desc</span>
              <input
                value={ep.description}
                onChange={(e) => upd({ description: e.target.value })}
                placeholder="e.g. Login endpoint"
                className="flex-1 h-6 px-2 bg-surface-2 border border-border-2 rounded text-[11px] text-text-1 outline-none focus:border-accent placeholder:text-text-4"
              />
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-[10px] text-text-4">Mode</span>
              <select
                value={ep.mode}
                onChange={(e) => upd({ mode: e.target.value })}
                className="h-6 px-1.5 bg-surface-2 border border-border-2 rounded text-[11px] text-text-1 outline-none"
              >
                {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </label>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between px-0.5">
              <span className="text-[10px] text-text-4">Responses ({ep.responses.length})</span>
              <button onClick={addResponse} className="flex items-center gap-1 text-[10px] text-accent hover:text-accent-light">
                <Plus size={10} /> Add response
              </button>
            </div>
            {ep.responses.map((r) => (
              <ResponseCard
                key={r.id}
                resp={r}
                onChange={(updated) => updateResponse(r.id, updated)}
                onRemove={() => removeResponse(r.id)}
                onDuplicate={() => duplicateResponse(r)}
                canRemove={ep.responses.length > 1}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function MockPanel() {
  const port = useServerPort()
  const collections = useCollectionsStore((s) => s.collections)
  const collectionsLoaded = useCollectionsStore((s) => s.loaded)
  const settings = useSettingsStore((s) => s.settings)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [mockPort, setMockPort] = useState(settings.mock?.defaultMockPort ?? 9090)
  const [password, setPassword] = useState(settings.mock?.mockServerPassword ?? '')
  const [status, setStatus] = useState<MockStatus>({ running: false, port: 0 })
  const [endpoints, setEndpoints] = useState<MockEndpoint[]>(defaultRestEndpoints)
  const [endpointsLoaded, setEndpointsLoaded] = useState(false)
  const [hits, setHits] = useState<HitEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [recordUrl, setRecordUrl] = useState('')
  const [recordMethod, setRecordMethod] = useState('GET')
  const [recordHeaders, setRecordHeaders] = useState('{}')
  const [recording, setRecording] = useState(false)
  const [recordMsg, setRecordMsg] = useState('')
  const [hitSearch, setHitSearch] = useState('')
  const [hitMethodFilter, setHitMethodFilter] = useState<'ALL' | 'GET' | 'QUERY' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'>('ALL')
  const [hitMatchFilter, setHitMatchFilter] = useState<'all' | 'match' | 'miss'>('all')
  const [showAiDialog, setShowAiDialog] = useState(false)

  const filteredHits = useMemo(() => {
    const reversed = hits.slice().reverse()
    return reversed.filter((h) => {
      if (hitMethodFilter !== 'ALL' && h.method !== hitMethodFilter) return false
      if (hitSearch && !h.path.toLowerCase().includes(hitSearch.toLowerCase())) return false
      if (hitMatchFilter === 'match' && !h.matched) return false
      if (hitMatchFilter === 'miss' && h.matched) return false
      return true
    }).slice(0, 200)
  }, [hits, hitSearch, hitMethodFilter, hitMatchFilter])

  const api = useCallback(
    async (path: string, body?: unknown) => {
      const url = serverUrl(port, path)
      if (!url) {
        console.error('[MockPanel] serverUrl returned empty (port=', port, ', path=', path, ')')
        return null
      }
      try {
        const res = await sidecarFetch(url, {
          method: body !== undefined ? 'POST' : 'GET',
          headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
          body: body !== undefined ? JSON.stringify(body) : undefined,
        })
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          console.error(`[MockPanel] ${path} returned ${res.status}: ${text}`)
          return { error: text || `HTTP ${res.status}` }
        }
        return res.json()
      } catch (err) {
        console.error(`[MockPanel] fetch error for ${path}:`, err)
        return null
      }
    },
    [port],
  )

  // Load endpoints from bbolt on mount; one-shot migration from localStorage if bbolt is empty.
  useEffect(() => {
    if (!port || endpointsLoaded) return
    void (async () => {
      const data = await api('/storage/get?bucket=mock&key=endpoints')
      if (Array.isArray(data) && data.length > 0) {
        setEndpoints(data as MockEndpoint[])
      } else {
        try {
          const ls = localStorage.getItem('adomnia.mock.endpoints')
          if (ls) {
            const parsed: unknown = JSON.parse(ls)
            if (Array.isArray(parsed) && parsed.length > 0) setEndpoints(parsed as MockEndpoint[])
          }
        } catch { /* keep defaults */ }
        localStorage.removeItem('adomnia.mock.endpoints')
      }
      setEndpointsLoaded(true)
    })()
  }, [port, api, endpointsLoaded])

  // Persist endpoints to bbolt whenever they change (after initial load).
  useEffect(() => {
    if (!endpointsLoaded) return
    void api('/storage/put?bucket=mock&key=endpoints', endpoints)
  }, [endpoints, api, endpointsLoaded])

  useEffect(() => {
    if (!collectionsLoaded || !endpointsLoaded) return
    const fromCollections = collections.flatMap((collection) => collectRestEndpoints(collection.children))
    if (fromCollections.length === 0) return

    const seen = new Set<string>()
    const merged = [...fromCollections, ...endpoints].filter((endpoint) => {
      const key = `${endpoint.method} ${endpoint.path}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    setEndpoints(merged)
  }, [collections, collectionsLoaded, endpointsLoaded])

  const refreshStatus = useCallback(async () => {
    const data = await api('/mock/status')
    if (data) {
      setStatus(data)
      useAppStore.getState().setMockRunning(data.running)
    }
  }, [api])

  const refreshHits = useCallback(async () => {
    const data = await api('/mock/hits')
    if (Array.isArray(data)) setHits(data)
  }, [api])

  useEffect(() => {
    if (!port) return
    refreshStatus()
    refreshHits()
    const t = setInterval(() => { refreshStatus(); refreshHits() }, 2000)
    return () => clearInterval(t)
  }, [port, refreshStatus, refreshHits])

  const handleStart = useCallback(async () => {
    setLoading(true)
    setError('')
    const activeEndpoints = endpoints.filter((e) => e.enabled !== false)
    if (activeEndpoints.length === 0) {
      setError('No enabled endpoints. Enable at least one endpoint before starting the mock server.')
      setLoading(false)
      return
    }
    const m = settings.mock
    const data = await api('/mock/start', {
      port: mockPort,
      password,
      endpoints: activeEndpoints,
      defaultResponseDelayMs: m?.defaultResponseDelayMs ?? 0,
      corsHeadersAuto: m?.corsHeadersAuto ?? true,
      logHitsToFile: m?.logHitsToFile ?? false,
    })
    if (data === null) {
      setError('Could not reach the backend server. Check that the app is running and retry.')
    } else if (data?.error) {
      setError(data.error)
    }
    await refreshStatus()
    setLoading(false)
  }, [api, endpoints, mockPort, password, refreshStatus, settings.mock])

  useEffect(() => {
    const startFromCommandPalette = (event: Event) => {
      const command = event as CustomEvent<{ handled: boolean }>
      command.detail.handled = true
      void handleStart()
    }
    document.addEventListener('adomnia:start-mock', startFromCommandPalette)
    return () => document.removeEventListener('adomnia:start-mock', startFromCommandPalette)
  }, [handleStart])

  const handleStop = async () => {
    setLoading(true)
    await api('/mock/stop', {})
    await refreshStatus()
    setLoading(false)
  }

  const handleRecord = async () => {
    if (!recordUrl) return
    setRecording(true)
    setRecordMsg('')
    setError('')
    let parsedHeaders: Record<string, string> = {}
    try { parsedHeaders = JSON.parse(recordHeaders) } catch { setError('Invalid JSON headers'); setRecording(false); return }
    const data = await api('/mock/record', {
      url: recordUrl,
      method: recordMethod,
      headers: parsedHeaders,
      body: '',
    })
    if (data) {
      if (data.error) {
        setError(data.error)
      } else {
        setRecordMsg(`Recorded ${data.method || recordMethod} ${data.path || recordUrl} → status ${data.status || '?'}`)
        // Auto-add as endpoint
        if (data.path && data.method) {
          const newEp: MockEndpoint = {
            id: uid(),
            path: data.path,
            method: data.method,
            description: `Recorded from ${recordUrl}`,
            responses: [{
              id: uid(),
              name: 'Recorded',
              status: data.status || 200,
              headers: data.headers || { 'Content-Type': 'application/json' },
              body: data.body || '{}',
              delayMs: 0,
              isActive: true,
            }],
            mode: 'first_active',
            enabled: true,
          }
          setEndpoints([...endpoints, newEp])
        }
      }
    }
    setRecording(false)
  }

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(endpoints, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `mock-config-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string)
        if (Array.isArray(data)) {
          setError('')
          setEndpoints(data)
        } else {
          setError('Invalid mock config: expected an array of endpoints.')
        }
      } catch {
        setError('Invalid JSON file.')
      }
    }
    reader.readAsText(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleAiImport = (imported: MockEndpoint[]) => {
    setEndpoints(prev => [...prev, ...imported])
  }

  const addEndpoint = () => {
    setEndpoints([...endpoints, {
      id: uid(),
      path: '/api/example',
      method: 'GET',
      description: '',
      responses: [defaultResponse(1)],
      mode: 'first_active',
      enabled: true,
    }])
  }

  const removeEndpoint = (id: string) => setEndpoints(endpoints.filter((e) => e.id !== id))
  const updateEndpoint = (id: string, updated: MockEndpoint) => setEndpoints(endpoints.map((e) => e.id === id ? updated : e))
  const clearHits = () => setHits([])

  return (
    <>
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Action toolbar: the panel title/navigation lives in MainArea. */}
      <div className="flex h-12 items-center gap-3 px-4 border-b border-border-1 shrink-0">
        <div className={cn(
          'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium',
          status.running ? 'bg-success/15 text-success' : 'bg-surface-2 text-text-4',
        )}>
          <Server size={11} className={status.running ? 'text-success' : 'text-text-4'} />
          <span className={cn('w-1.5 h-1.5 rounded-full', status.running ? 'bg-success animate-pulse' : 'bg-text-4')} />
          {status.running ? `Listening on :${status.port}` : 'Stopped'}
        </div>

        <div className="flex-1" />

        <button
          onClick={handleExport}
          disabled={endpoints.length === 0}
          className="flex items-center gap-1 px-2 py-1 text-[11px] text-text-3 hover:text-text-1 border border-border-2 rounded hover:bg-surface-2 disabled:opacity-30"
          title="Export as JSON"
        >
          <Download size={11} /> Export
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1 px-2 py-1 text-[11px] text-text-3 hover:text-text-1 border border-border-2 rounded hover:bg-surface-2"
          title="Import JSON config"
        >
          <Upload size={11} /> Import
        </button>
        <input ref={fileInputRef} type="file" accept=".json" onChange={handleImport} className="hidden" />

      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col gap-4 p-4 overflow-auto">
        {/* Server config */}
        <div className="bg-surface-1 border border-border-1 rounded-md p-3">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-2">
              <span className="text-[11px] text-text-3">Port</span>
              <input
                type="number"
                value={mockPort}
                onChange={(e) => setMockPort(Number(e.target.value))}
                disabled={status.running}
                className="w-20 h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none focus:border-accent disabled:opacity-50"
              />
            </label>

            <label className="flex items-center gap-2 flex-1">
              <span className="text-[11px] text-text-3">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={status.running}
                placeholder="optional (X-Mock-Auth header)"
                className="flex-1 h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none focus:border-accent disabled:opacity-50 placeholder:text-text-4"
              />
            </label>

            {status.running ? (
              <button
                onClick={handleStop}
                disabled={loading}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-error/80 text-white rounded text-xs font-medium disabled:opacity-50 hover:bg-error"
              >
                <Square size={11} /> Stop
              </button>
            ) : (
              <button
                onClick={handleStart}
                disabled={loading || !port}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-accent text-white rounded text-xs font-medium disabled:opacity-50 hover:bg-accent-hover"
              >
                <Play size={11} /> Start Server
              </button>
            )}
          </div>
          {error && <p className="text-[11px] text-error mt-2">{error}</p>}
        </div>

        {/* Record & Replay */}
        <details className="bg-surface-1 border border-border-1 rounded-md p-3 flex flex-col gap-2">
          <summary className="text-[11px] text-text-2 font-medium cursor-pointer hover:text-text-1 select-none flex items-center gap-2">
            <Mic size={12} className="text-accent" /> Record & Replay
          </summary>
          <div className="flex gap-2 mt-2 flex-wrap items-start">
            <select value={recordMethod} onChange={(e) => setRecordMethod(e.target.value)}
              className="h-7 px-2 bg-surface-2 border border-border-2 rounded text-[11px] text-text-1 outline-none">
              {['GET','POST','PUT','PATCH','DELETE'].map(m => <option key={m}>{m}</option>)}
            </select>
            <input value={recordUrl} onChange={(e) => setRecordUrl(e.target.value)}
              placeholder="https://api.your-domain.com/v1/endpoint"
              className="flex-1 h-7 px-2 bg-surface-2 border border-border-2 rounded text-[11px] text-text-1 font-mono outline-none focus:border-accent placeholder:text-text-4" />
            <input value={recordHeaders} onChange={(e) => setRecordHeaders(e.target.value)}
              placeholder='{"Authorization":"Bearer ..."}'
              className="w-48 h-7 px-2 bg-surface-2 border border-border-2 rounded text-[10px] text-text-1 font-mono outline-none focus:border-accent placeholder:text-text-4" />
            <button onClick={handleRecord} disabled={recording || !recordUrl}
              className="flex items-center gap-1 px-3 py-1.5 bg-accent text-white rounded text-xs font-medium disabled:opacity-40 hover:bg-accent-hover">
              <Mic size={10} /> {recording ? 'Recording…' : 'Record'}
            </button>
          </div>
          {recordMsg && <p className="text-[10px] text-success mt-1">{recordMsg}</p>}
        </details>

        {/* Endpoints */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-text-2">Endpoints</span>
              <span className="text-[10px] text-text-4">
                ({endpoints.filter(e => e.enabled !== false).length}/{endpoints.length} enabled)
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowAiDialog(true)}
                className="flex items-center gap-1 text-xs text-text-3 hover:text-accent transition-colors"
                title="Generate endpoints with AI"
              >
                <Sparkles size={12} /> Generate with AI
              </button>
              <button
                onClick={addEndpoint}
                className="flex items-center gap-1 text-xs text-accent hover:text-accent-light"
              >
                <Plus size={12} /> New endpoint
              </button>
            </div>
          </div>

          {endpoints.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-12 border border-dashed border-border-2 rounded-md">
              <Radio size={24} className="text-text-4" />
              <p className="text-xs text-text-4">No mock endpoints defined</p>
              <button onClick={addEndpoint} className="text-xs text-accent hover:text-accent-light flex items-center gap-1">
                <Plus size={12} /> Create your first endpoint
              </button>
            </div>
          )}
          {endpoints.length > 0 && (
            <div className="flex items-center gap-2 text-[10px] text-text-4">
              <span className="text-success font-medium">{endpoints.filter(e => e.enabled !== false).length} enabled</span>
              <span>·</span>
              <span>{endpoints.filter(e => e.enabled === false).length} disabled</span>
              {endpoints.some(e => e.enabled === false) && (
                <button
                  onClick={() => setEndpoints(endpoints.map(e => ({ ...e, enabled: true })))}
                  className="text-accent hover:text-accent-light ml-1"
                >
                  Enable all
                </button>
              )}
            </div>
          )}

          {endpoints.map((ep) => (
            <EndpointCard
              key={ep.id}
              ep={ep}
              onChange={(updated) => updateEndpoint(ep.id, updated)}
              onRemove={() => removeEndpoint(ep.id)}
            />
          ))}
        </div>

        {/* Hit log */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text-2">
              Hit Log
              {hits.length > 0 && (
                <span className="text-text-4 ml-1">
                  ({filteredHits.length}{filteredHits.length !== hits.length ? `/${hits.length}` : ''})
                </span>
              )}
            </span>
            <div className="flex items-center gap-2">
              {hits.length > 0 && (
                <button onClick={clearHits} className="text-[10px] text-text-4 hover:text-text-2">
                  Clear
                </button>
              )}
              <button onClick={refreshHits} className="text-text-4 hover:text-text-1">
                <RefreshCw size={11} />
              </button>
            </div>
          </div>

          {/* Filter bar */}
          {hits.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              {/* Path search */}
              <div className="relative flex-1 min-w-[160px]">
                <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-4 pointer-events-none" />
                <input
                  value={hitSearch}
                  onChange={(e) => setHitSearch(e.target.value)}
                  placeholder="Filter by path…"
                  className="h-6 w-full pl-6 pr-6 bg-surface-2 border border-border-2 rounded text-[10px] text-text-1 font-mono placeholder:text-text-4 focus:border-accent outline-none"
                />
                {hitSearch && (
                  <button
                    onClick={() => setHitSearch('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-4 hover:text-text-2"
                  >
                    <X size={9} />
                  </button>
                )}
              </div>
              {/* Method filter */}
              <div className="flex items-center gap-0.5">
                {(['ALL', 'GET', 'QUERY', 'POST', 'PUT', 'PATCH', 'DELETE'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setHitMethodFilter(m)}
                    className={cn(
                      'px-1.5 py-0.5 rounded text-[9px] font-bold transition-colors',
                      hitMethodFilter === m
                        ? 'bg-accent text-white'
                        : m === 'ALL'
                          ? 'text-text-3 hover:bg-surface-2'
                          : cn(METHOD_COLORS[m] ?? 'text-text-3', 'hover:bg-surface-2'),
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
              {/* Match filter */}
              <div className="flex items-center gap-0.5">
                {([['all', 'All'], ['match', 'OK'], ['miss', 'MISS']] as const).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setHitMatchFilter(val)}
                    className={cn(
                      'px-1.5 py-0.5 rounded text-[9px] font-semibold transition-colors',
                      hitMatchFilter === val
                        ? val === 'miss'
                          ? 'bg-error/20 text-error'
                          : val === 'match'
                            ? 'bg-success/20 text-success'
                            : 'bg-surface-3 text-text-1'
                        : 'text-text-4 hover:bg-surface-2',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="bg-surface-1 border border-border-1 rounded-md overflow-hidden min-h-[80px] max-h-[320px] overflow-y-auto">
            {hits.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6">
                <Zap size={16} className="text-text-4" />
                <p className="text-[11px] text-text-4">
                  {status.running ? 'Waiting for requests...' : 'Start the server to see incoming hits'}
                </p>
              </div>
            ) : filteredHits.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6">
                <Search size={16} className="text-text-4" />
                <p className="text-[11px] text-text-4">No hits match the current filters</p>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-surface-2 sticky top-0">
                  <tr className="text-[10px] text-text-4 uppercase tracking-wider">
                    <th className="py-1.5 px-3 text-left font-medium">Time</th>
                    <th className="py-1.5 px-3 text-left font-medium">Method</th>
                    <th className="py-1.5 px-3 text-left font-medium">Path</th>
                    <th className="py-1.5 px-3 text-center font-medium w-12">Match</th>
                    <th className="py-1.5 px-3 text-right font-medium w-16">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-1/30">
                  {filteredHits.map((h) => (
                    <tr key={h.id} className="hover:bg-surface-2/40 transition-colors">
                      <td className="py-1.5 px-3 text-[10px] text-text-4 font-mono whitespace-nowrap">
                        {h.timestamp}
                      </td>
                      <td className="py-1.5 px-3">
                        <span className={cn('font-bold text-[10px]', METHOD_COLORS[h.method] ?? 'text-text-3')}>
                          {h.method}
                        </span>
                      </td>
                      <td className="py-1.5 px-3 text-text-2 font-mono text-[10px] truncate max-w-[300px]">
                        {h.path}
                      </td>
                      <td className="py-1.5 px-3 text-center">
                        <span className={cn(
                          'text-[10px] font-semibold',
                          h.matched ? 'text-success' : 'text-error',
                        )}>
                          {h.matched ? 'OK' : 'MISS'}
                        </span>
                      </td>
                      <td className="py-1.5 px-3 text-right">
                        <span className={cn(
                          'font-mono text-[10px] font-semibold',
                          h.status ? statusColor(h.status) : 'text-text-4',
                        )}>
                          {h.status || '---'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
    {showAiDialog && (
      <AiMockDialog
        onClose={() => setShowAiDialog(false)}
        onImport={handleAiImport}
      />
    )}
    </>
  )
}
