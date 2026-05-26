import { useState, useEffect, useCallback } from 'react'
import {
  Play, Square, RefreshCw, Trash2, ChevronDown, ChevronRight,
  Filter, Activity, ShieldCheck, ShieldOff, Plus, Download,
  Map, Zap, Copy, RotateCcw, PauseCircle, X,
} from 'lucide-react'
import { useServerPort, serverUrl, sidecarFetch } from '@/lib/useServerPort'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { uid } from '@/lib/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrafficEntry {
  id: string
  timestamp: string
  method: string
  url: string
  reqHeaders: Record<string, string>
  reqBody: string
  status: number
  respHeaders: Record<string, string>
  respBody: string
  durationMs: number
  error?: string
  matched: boolean
}

interface ProxyStatus { running: boolean; port: number }

interface PendingBreakpoint {
  id: string
  timestamp: string
  method: string
  url: string
  headers: Record<string, string>
  body: string
}

interface ProxyRule {
  id: string
  type: 'allow' | 'block' | 'intercept'
  target: string
  enabled: boolean
  note?: string
}

interface MapLocalRule { pattern: string; localPath: string; enabled: boolean }
interface MapRemoteRule { pattern: string; target: string; enabled: boolean }
interface ThrottleConfig { enabled: boolean; latencyMs: number; bandwidthKbps: number; packetLossRate: number }

type ProxyTab = 'traffic' | 'rules' | 'ca' | 'maplocal' | 'mapremote' | 'throttle'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(s: number) {
  if (s === 0) return 'text-error'
  if (s < 300) return 'text-success'
  if (s < 400) return 'text-info'
  if (s < 500) return 'text-warning'
  return 'text-error'
}

function methodColor(m: string) {
  switch (m) {
    case 'GET': return 'text-method-get'
    case 'POST': return 'text-method-post'
    case 'PUT': return 'text-method-put'
    case 'PATCH': return 'text-method-patch'
    case 'DELETE': return 'text-method-delete'
    default: return 'text-text-3'
  }
}

function HeaderTable({ headers }: { headers: Record<string, string> }) {
  const entries = Object.entries(headers || {})
  if (entries.length === 0) return <span className="text-text-4 text-[10px]">none</span>
  return (
    <div className="flex flex-col gap-0.5">
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-2 text-[10px]">
          <span className="text-text-4 shrink-0 w-32 truncate font-mono">{k}</span>
          <span className="text-text-2 font-mono break-all">{v}</span>
        </div>
      ))}
    </div>
  )
}

function DetailSection({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-border-2 rounded-lg overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-3 py-2 bg-surface-1 text-left hover:bg-surface-2 transition-colors">
        {open ? <ChevronDown size={11} className="text-text-4" /> : <ChevronRight size={11} className="text-text-4" />}
        <span className="text-[10px] font-semibold text-text-3 uppercase tracking-wider">{title}</span>
      </button>
      {open && <div className="p-3 bg-surface-0/60">{children}</div>}
    </div>
  )
}

// ─── Traffic sub-panel ────────────────────────────────────────────────────────

function TrafficTab({
  port, status,
}: { port: number | null; status: ProxyStatus }) {
  const [traffic, setTraffic] = useState<TrafficEntry[]>([])
  const [pending, setPending] = useState<PendingBreakpoint[]>([])
  const [pendingDrafts, setPendingDrafts] = useState<Record<string, { url: string; body: string }>>({})
  const [selected, setSelected] = useState<TrafficEntry | null>(null)
  const [filter, setFilter] = useState('')

  const api = useCallback(async (path: string, body?: unknown, method?: string) => {
    const url = serverUrl(port, path)
    if (!url) return null
    try {
      const m = method ?? (body !== undefined ? 'POST' : 'GET')
      const res = await sidecarFetch(url, {
        method: m,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
      return res.json()
    } catch { return null }
  }, [port])

  const refresh = useCallback(async () => {
    const data = await api('/proxy/traffic')
    if (data && Array.isArray(data.entries)) setTraffic(data.entries)
  }, [api])

  const refreshPending = useCallback(async () => {
    const data = await api('/proxy/breakpoint/pending')
    if (data && Array.isArray(data.pending)) {
      setPending(data.pending)
      setPendingDrafts((current) => {
        const next = { ...current }
        for (const item of data.pending as PendingBreakpoint[]) {
          if (!next[item.id]) next[item.id] = { url: item.url, body: item.body || '' }
        }
        for (const id of Object.keys(next)) {
          if (!(data.pending as PendingBreakpoint[]).some((item) => item.id === id)) delete next[id]
        }
        return next
      })
    }
  }, [api])

  useEffect(() => {
    if (!port) return
    refresh()
    refreshPending()
    const t = setInterval(refresh, 1500)
    const p = setInterval(refreshPending, 700)
    return () => { clearInterval(t); clearInterval(p) }
  }, [port, refresh, refreshPending])

  const handleClear = async () => {
    await api('/proxy/traffic', undefined, 'DELETE')
    setTraffic([]); setSelected(null)
  }

  const handleRepeat = async (id: string) => {
    await api('/proxy/repeat', { id })
    refresh()
  }

  const updatePendingDraft = (id: string, patch: Partial<{ url: string; body: string }>) => {
    setPendingDrafts((current) => ({ ...current, [id]: { ...(current[id] || { url: '', body: '' }), ...patch } }))
  }

  const resumePending = async (item: PendingBreakpoint) => {
    const draft = pendingDrafts[item.id] || { url: item.url, body: item.body || '' }
    await api('/proxy/breakpoint/resume', {
      id: item.id,
      action: 'resume',
      method: item.method,
      url: draft.url,
      headers: item.headers,
      body: draft.body,
    })
    await refreshPending()
    await refresh()
  }

  const dropPending = async (item: PendingBreakpoint) => {
    await api('/proxy/breakpoint/resume', { id: item.id, action: 'drop' })
    await refreshPending()
    await refresh()
  }

  const handleExport = async () => {
    const data = await api('/proxy/export')
    if (!data) return
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `proxy-traffic-${Date.now()}.json`
    a.click()
  }

  const filtered = filter
    ? traffic.filter((t) => t.url.includes(filter) || t.method.includes(filter.toUpperCase()))
    : traffic

  return (
    <div className="flex flex-col overflow-hidden flex-1 min-h-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-1 shrink-0">
        <div className="flex items-center gap-1.5 h-7 px-2 bg-surface-2 border border-border-2 rounded-lg flex-1 max-w-xs">
          <Filter size={11} className="text-text-4" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter URL…"
            className="flex-1 bg-transparent text-xs text-text-1 outline-none placeholder:text-text-4" />
        </div>
        <div className="flex-1" />
        <button onClick={handleExport} title="Export traffic" className="flex items-center gap-1 px-2.5 py-1.5 border border-border-2 rounded-lg text-xs text-text-3 hover:text-text-1 transition-colors">
          <Download size={11} /> Export
        </button>
        <button onClick={refresh} className="w-7 h-7 flex items-center justify-center rounded-lg text-text-4 hover:text-text-1 hover:bg-surface-2 transition-colors">
          <RefreshCw size={13} />
        </button>
        <button onClick={handleClear} className="w-7 h-7 flex items-center justify-center rounded-lg text-text-4 hover:text-error hover:bg-surface-2 transition-colors">
          <Trash2 size={13} />
        </button>
      </div>

      {pending.length > 0 && (
        <div className="shrink-0 border-b border-warning/25 bg-warning/8 px-3 py-2">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-warning">
            <PauseCircle size={13} />
            {pending.length} paused request{pending.length === 1 ? '' : 's'} waiting for resume
          </div>
          <div className="flex flex-col gap-2">
            {pending.map((item) => {
              const draft = pendingDrafts[item.id] || { url: item.url, body: item.body || '' }
              return (
                <div key={item.id} className="rounded-lg border border-warning/25 bg-surface-0/70 p-2">
                  <div className="mb-2 flex items-center gap-2">
                    <span className={cn('w-14 shrink-0 font-bold text-[10px]', methodColor(item.method))}>{item.method}</span>
                    <input
                      value={draft.url}
                      onChange={(e) => updatePendingDraft(item.id, { url: e.target.value })}
                      className="h-7 flex-1 rounded-md border border-border-2 bg-surface-2 px-2 font-mono text-[10px] text-text-1 outline-none focus:border-warning"
                    />
                    <button onClick={() => resumePending(item)} className="h-7 rounded-md bg-warning px-3 text-[10px] font-semibold text-black transition-colors hover:bg-warning/90">
                      Resume
                    </button>
                    <button onClick={() => dropPending(item)} title="Drop request" className="grid h-7 w-7 place-items-center rounded-md border border-error/25 text-error hover:bg-error/10">
                      <X size={12} />
                    </button>
                  </div>
                  <textarea
                    value={draft.body}
                    onChange={(e) => updatePendingDraft(item.id, { body: e.target.value })}
                    placeholder="Request body"
                    className="h-16 w-full resize-none rounded-md border border-border-2 bg-surface-2 px-2 py-1 font-mono text-[10px] text-text-2 outline-none focus:border-warning"
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden min-h-0">
        <div className="w-[45%] border-r border-border-1 overflow-y-auto flex flex-col">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-1 border-b border-border-1 text-[10px] text-text-4 uppercase tracking-wider sticky top-0">
            <span className="w-14 shrink-0">Method</span>
            <span className="w-10 shrink-0">Status</span>
            <span className="flex-1">URL</span>
            <span className="w-12 shrink-0 text-right">ms</span>
          </div>
          {filtered.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 py-12">
              <Activity size={24} className="text-text-4 opacity-40" />
              <p className="text-xs text-text-4">{status.running ? 'Waiting for traffic…' : 'Start the proxy to capture traffic'}</p>
            </div>
          ) : filtered.map((t) => (
            <div key={t.id} onClick={() => setSelected(t)}
              className={cn('flex items-center gap-2 px-3 py-1.5 border-b border-border-1/30 cursor-pointer hover:bg-surface-1 transition-colors', selected?.id === t.id ? 'bg-surface-2' : '')}>
              <span className={cn('w-14 shrink-0 font-bold text-[10px]', methodColor(t.method))}>{t.method}</span>
              <span className={cn('w-10 shrink-0 font-mono text-[10px]', statusColor(t.status))}>{t.status || 'ERR'}</span>
              <span className="text-text-2 flex-1 truncate font-mono text-[10px]">{t.url}</span>
              <span className="text-text-4 text-[10px] shrink-0 w-12 text-right font-mono">{t.durationMs.toFixed(0)}</span>
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
          {!selected ? (
            <div className="flex items-center justify-center py-12"><p className="text-xs text-text-4">Select a request to inspect</p></div>
          ) : (
            <>
              <div className="flex items-center gap-3 pb-2.5 border-b border-border-1 mb-1">
                <span className={cn('text-sm font-bold', methodColor(selected.method))}>{selected.method}</span>
                <span className={cn('text-sm font-bold font-mono', statusColor(selected.status))}>{selected.status || 'ERR'}</span>
                <span className="text-text-4 text-xs font-mono">{selected.durationMs.toFixed(2)}ms</span>
                <span className="text-text-4 text-[10px] ml-auto">{selected.timestamp}</span>
                <button onClick={() => handleRepeat(selected.id)} title="Repeat request"
                  className="flex items-center gap-1 px-2 py-1 border border-border-2 rounded-md text-[10px] text-text-3 hover:text-text-1 transition-colors">
                  <RotateCcw size={10} /> Repeat
                </button>
              </div>
              <div className="text-[10px] text-text-2 font-mono break-all bg-surface-1 rounded-lg px-3 py-2 border border-border-2 flex items-center gap-2">
                <span className="flex-1">{selected.url}</span>
                <button onClick={() => navigator.clipboard.writeText(selected.url)} className="text-text-4 hover:text-text-1">
                  <Copy size={10} />
                </button>
              </div>
              {selected.error && <div className="px-3 py-2 bg-error/8 border border-error/25 rounded-lg text-[11px] text-error">{selected.error}</div>}
              <DetailSection title="Request Headers" defaultOpen><HeaderTable headers={selected.reqHeaders} /></DetailSection>
              {selected.reqBody && <DetailSection title="Request Body" defaultOpen><pre className="text-[10px] text-text-2 font-mono whitespace-pre-wrap break-all max-h-48 overflow-auto">{selected.reqBody}</pre></DetailSection>}
              <DetailSection title="Response Headers" defaultOpen><HeaderTable headers={selected.respHeaders} /></DetailSection>
              {selected.respBody && <DetailSection title="Response Body" defaultOpen><pre className="text-[10px] text-text-2 font-mono whitespace-pre-wrap break-all max-h-48 overflow-auto">{selected.respBody}</pre></DetailSection>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Rules sub-panel ──────────────────────────────────────────────────────────

function RulesTab({ port }: { port: number | null }) {
  const [rules, setRules] = useState<ProxyRule[]>([])
  const [testTarget, setTestTarget] = useState('')
  const [testResult, setTestResult] = useState<{ matched: boolean; ruleType: string; ruleId: string } | null>(null)
  const [log, setLog] = useState<Array<{ time: string; target: string; ruleType: string; matched: boolean }>>([])
  const [message, setMessage] = useState('')

  const api = useCallback(async (path: string, body?: unknown, method?: string) => {
    const url = serverUrl(port, path)
    if (!url) return null
    try {
      const m = method ?? (body !== undefined ? 'POST' : 'GET')
      const res = await sidecarFetch(url, { method: m, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined })
      return res.json()
    } catch { return null }
  }, [port])

  const loadRules = useCallback(async () => {
    const data = await api('/proxy/rules')
    if (data?.rules) setRules(data.rules)
  }, [api])

  const loadLog = useCallback(async () => {
    const data = await api('/proxy/rules/log')
    if (data?.log) setLog(data.log)
  }, [api])

  useEffect(() => { if (port) { loadRules(); loadLog() } }, [port, loadRules, loadLog])

  const saveRules = async () => {
    await api('/proxy/rules', { rules }, 'PUT')
    setMessage('Rules saved')
    setTimeout(() => setMessage(''), 2000)
  }

  const testRule = async () => {
    const data = await api('/proxy/rules/test', { target: testTarget })
    if (data) setTestResult(data)
  }

  const addRule = () => {
    setRules([...rules, { id: uid(), type: 'allow', target: '', enabled: true }])
  }

  const updateRule = (idx: number, patch: Partial<ProxyRule>) => {
    setRules(rules.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }

  const removeRule = (idx: number) => {
    setRules(rules.filter((_, i) => i !== idx))
  }

  return (
    <div className="flex-1 overflow-auto p-4 flex flex-col gap-4">
      <div className="bg-surface-1 border border-border-2 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-4 flex-1">IP / CIDR / Regex Rules</span>
          <button onClick={addRule} className="flex items-center gap-1 px-2.5 py-1.5 bg-accent/10 hover:bg-accent/20 text-accent border border-accent/25 rounded-md text-[10px] font-semibold transition-colors">
            <Plus size={10} /> Add Rule
          </button>
          <button onClick={saveRules} className="flex items-center gap-1 px-2.5 py-1.5 bg-accent hover:bg-accent-hover text-white rounded-md text-[10px] font-semibold transition-colors">
            Save
          </button>
        </div>
        {message && <div className="px-4 py-2 text-[11px] text-success border-b border-border-1">{message}</div>}
        <div className="flex flex-col divide-y divide-border-1/40">
          {rules.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-text-4">No rules. Click Add Rule to create one.</div>
          ) : rules.map((rule, idx) => (
            <div key={rule.id} className="flex items-center gap-3 px-4 py-2">
              <input type="checkbox" checked={rule.enabled} onChange={(e) => updateRule(idx, { enabled: e.target.checked })} className="accent-accent" />
              <select value={rule.type} onChange={(e) => updateRule(idx, { type: e.target.value as ProxyRule['type'] })}
                className="h-7 px-2 bg-surface-2 border border-border-2 rounded-lg text-xs text-text-1 outline-none">
                <option value="allow">Allow</option>
                <option value="block">Block</option>
                <option value="intercept">Intercept</option>
              </select>
              <input value={rule.target} onChange={(e) => updateRule(idx, { target: e.target.value })}
                placeholder="192.168.0.0/24 or *.internal or /regex/"
                className="flex-1 h-7 px-2 bg-surface-2 border border-border-2 rounded-lg text-xs text-text-1 font-mono outline-none focus:border-accent" />
              <input value={rule.note || ''} onChange={(e) => updateRule(idx, { note: e.target.value })}
                placeholder="note…"
                className="w-32 h-7 px-2 bg-surface-2 border border-border-2 rounded-lg text-xs text-text-1 outline-none focus:border-accent" />
              <button onClick={() => removeRule(idx)} className="text-text-4 hover:text-error transition-colors"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-surface-1 border border-border-2 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-4">Test a target</span>
        </div>
        <div className="flex gap-2 p-4">
          <input value={testTarget} onChange={(e) => setTestTarget(e.target.value)}
            placeholder="192.168.1.42 or api.internal"
            className="flex-1 h-8 px-3 bg-surface-2 border border-border-2 rounded-lg text-xs text-text-1 font-mono outline-none focus:border-accent" />
          <button onClick={testRule} className="px-4 py-1.5 bg-accent hover:bg-accent-hover text-white rounded-lg text-xs font-semibold transition-colors">
            Test
          </button>
        </div>
        {testResult && (
          <div className={cn('mx-4 mb-4 px-3 py-2 rounded-lg text-xs border',
            testResult.matched ? (testResult.ruleType === 'block' ? 'bg-error/8 border-error/25 text-error' : 'bg-success/8 border-success/25 text-success') : 'bg-surface-2 border-border-2 text-text-3')}>
            {testResult.matched ? `Matched rule ${testResult.ruleId} → ${testResult.ruleType.toUpperCase()}` : 'No rule matched (default: allow)'}
          </div>
        )}
      </div>

      {log.length > 0 && (
        <div className="bg-surface-1 border border-border-2 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-4 flex-1">Match Log</span>
            <button onClick={loadLog} className="text-text-4 hover:text-text-1"><RefreshCw size={12} /></button>
          </div>
          <div className="divide-y divide-border-1/40 max-h-48 overflow-y-auto">
            {log.map((entry, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-1.5 text-[10px] font-mono">
                <span className="text-text-4 shrink-0">{entry.time}</span>
                <span className="text-text-2 flex-1 truncate">{entry.target}</span>
                <span className={cn('shrink-0', entry.matched ? 'text-warning' : 'text-text-4')}>{entry.ruleType || '—'}</span>
                <span className={cn('shrink-0 font-semibold', entry.matched ? 'text-success' : 'text-text-4')}>{entry.matched ? 'HIT' : '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── CA sub-panel ─────────────────────────────────────────────────────────────

function CATab({ port }: { port: number | null }) {
  const [exists, setExists] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const api = useCallback(async (path: string, body?: unknown, method?: string) => {
    const url = serverUrl(port, path)
    if (!url) return null
    try {
      const m = method ?? (body !== undefined ? 'POST' : 'GET')
      const res = await sidecarFetch(url, { method: m, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined })
      return res.json()
    } catch { return null }
  }, [port])

  const refresh = useCallback(async () => {
    const data = await api('/proxy/ca/status')
    if (data) setExists(Boolean(data.exists))
  }, [api])

  useEffect(() => { if (port) refresh() }, [port, refresh])

  const run = async (fn: () => Promise<void>) => {
    setError(''); setMessage(''); setLoading(true)
    try { await fn() } catch (e) { setError(String(e)) } finally { setLoading(false) }
  }

  const generate = () => run(async () => {
    const data = await api('/proxy/ca/generate', {})
    if (data?.ok) { setMessage('CA certificate generated'); refresh() }
    else setError(data?.error || 'Failed')
  })

  const exportPem = () => run(async () => {
    const url = serverUrl(port, '/proxy/ca/export?format=pem')
    if (!url) return
    const a = document.createElement('a'); a.href = url; a.download = 'adomnia-ca.pem'; a.click()
    setMessage('Downloading adomnia-ca.pem')
  })

  const exportCrt = () => run(async () => {
    const url = serverUrl(port, '/proxy/ca/export?format=crt')
    if (!url) return
    const a = document.createElement('a'); a.href = url; a.download = 'adomnia-ca.crt'; a.click()
    setMessage('Downloading adomnia-ca.crt')
  })

  const deleteCa = () => run(async () => {
    const data = await api('/proxy/ca/delete', {})
    if (data?.ok) { setMessage('CA deleted'); refresh() }
  })

  return (
    <div className="flex-1 overflow-auto p-4 flex flex-col gap-4 max-w-2xl">
      <div className="bg-surface-1 border border-border-2 rounded-xl p-4 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className={cn('w-8 h-8 rounded-lg border flex items-center justify-center', exists ? 'bg-success/10 border-success/25' : 'bg-surface-2 border-border-2')}>
            {exists ? <ShieldCheck size={16} className="text-success" /> : <ShieldOff size={16} className="text-text-4" />}
          </div>
          <div>
            <div className="text-sm font-semibold text-text-1">{exists ? 'CA Certificate Ready' : 'No CA Certificate'}</div>
            <div className="text-[10px] text-text-4">{exists ? 'adOmnia Interception CA — valid 10 years' : 'Generate a CA to intercept HTTPS traffic'}</div>
          </div>
        </div>

        {(message || error) && (
          <div className={cn('px-3 py-2 rounded-lg text-xs border', error ? 'bg-error/8 border-error/25 text-error' : 'bg-success/8 border-success/25 text-success')}>
            {error || message}
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          {!exists ? (
            <button onClick={generate} disabled={loading}
              className="flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-xs font-semibold shadow-[0_0_12px_var(--color-accent-glow)] disabled:opacity-50 transition-all">
              <ShieldCheck size={12} /> Generate CA
            </button>
          ) : (
            <>
              <button onClick={exportPem} disabled={loading}
                className="flex items-center gap-1.5 px-3 py-2 border border-border-2 hover:border-border-1 rounded-lg text-xs text-text-2 hover:text-text-1 transition-colors">
                <Download size={12} /> Download .pem
              </button>
              <button onClick={exportCrt} disabled={loading}
                className="flex items-center gap-1.5 px-3 py-2 border border-border-2 hover:border-border-1 rounded-lg text-xs text-text-2 hover:text-text-1 transition-colors">
                <Download size={12} /> Download .crt
              </button>
              <button onClick={deleteCa} disabled={loading}
                className="flex items-center gap-1.5 px-3 py-2 border border-error/30 hover:border-error rounded-lg text-xs text-error hover:bg-error/8 transition-colors ml-auto">
                <Trash2 size={12} /> Delete CA
              </button>
            </>
          )}
        </div>
      </div>

      {exists && (
        <div className="bg-surface-1 border border-border-2 rounded-xl p-4 flex flex-col gap-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-4 mb-1">Installation instructions</div>
          <p className="text-xs text-text-3">To intercept HTTPS traffic, install the CA certificate as a trusted root authority:</p>
          <ul className="flex flex-col gap-1.5 text-xs text-text-3 list-none">
            <li><span className="text-accent font-mono">Windows: </span>Double-click .crt → Install → Local Machine → Trusted Root CAs</li>
            <li><span className="text-accent font-mono">macOS: </span>Keychain Access → drag .pem → Trust → Always Trust</li>
            <li><span className="text-accent font-mono">Firefox: </span>Settings → Privacy → View Certificates → Authorities → Import</li>
            <li><span className="text-accent font-mono">Chrome/Edge: </span>Uses OS certificate store — install .crt to OS root</li>
          </ul>
        </div>
      )}
    </div>
  )
}

// ─── Map Local sub-panel ──────────────────────────────────────────────────────

function MapLocalTab({ port }: { port: number | null }) {
  const [rules, setRules] = useState<MapLocalRule[]>([])
  const [message, setMessage] = useState('')

  const api = useCallback(async (path: string, body?: unknown, method?: string) => {
    const url = serverUrl(port, path)
    if (!url) return null
    try {
      const m = method ?? (body !== undefined ? 'POST' : 'GET')
      const res = await sidecarFetch(url, { method: m, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined })
      return res.json()
    } catch { return null }
  }, [port])

  useEffect(() => {
    if (!port) return
    api('/proxy/map/local').then((d) => { if (d?.rules) setRules(d.rules) })
  }, [port, api])

  const save = async () => {
    await api('/proxy/map/local', { rules })
    setMessage('Saved'); setTimeout(() => setMessage(''), 2000)
  }

  const add = () => setRules([...rules, { pattern: '', localPath: '', enabled: true }])
  const update = (idx: number, patch: Partial<MapLocalRule>) => setRules(rules.map((r, i) => i === idx ? { ...r, ...patch } : r))
  const remove = (idx: number) => setRules(rules.filter((_, i) => i !== idx))

  return (
    <div className="flex-1 overflow-auto p-4 flex flex-col gap-4">
      <div className="bg-surface-1 border border-border-2 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-1">
          <Map size={13} className="text-accent" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-4 flex-1">Map Local — redirect URLs to local files</span>
          <button onClick={add} className="flex items-center gap-1 px-2.5 py-1.5 bg-accent/10 hover:bg-accent/20 text-accent border border-accent/25 rounded-md text-[10px] font-semibold transition-colors">
            <Plus size={10} /> Add
          </button>
          <button onClick={save} className="flex items-center gap-1 px-2.5 py-1.5 bg-accent hover:bg-accent-hover text-white rounded-md text-[10px] font-semibold transition-colors">
            Save
          </button>
        </div>
        {message && <div className="px-4 py-2 text-[11px] text-success border-b border-border-1">{message}</div>}
        <div className="divide-y divide-border-1/40">
          {rules.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-text-4">No map-local rules. Intercept URLs and serve local files instead.</div>
          ) : rules.map((rule, idx) => (
            <div key={idx} className="flex items-center gap-3 px-4 py-2">
              <input type="checkbox" checked={rule.enabled} onChange={(e) => update(idx, { enabled: e.target.checked })} className="accent-accent" />
              <input value={rule.pattern} onChange={(e) => update(idx, { pattern: e.target.value })}
                placeholder="https://api.your-domain.com/v1/*"
                className="flex-1 h-7 px-2 bg-surface-2 border border-border-2 rounded-lg text-xs text-text-1 font-mono outline-none focus:border-accent" />
              <span className="text-text-4 text-xs">→</span>
              <input value={rule.localPath} onChange={(e) => update(idx, { localPath: e.target.value })}
                placeholder="C:\mocks\response.json"
                className="flex-1 h-7 px-2 bg-surface-2 border border-border-2 rounded-lg text-xs text-text-1 font-mono outline-none focus:border-accent" />
              <button onClick={() => remove(idx)} className="text-text-4 hover:text-error transition-colors"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Map Remote sub-panel ─────────────────────────────────────────────────────

function MapRemoteTab({ port }: { port: number | null }) {
  const [rules, setRules] = useState<MapRemoteRule[]>([])
  const [message, setMessage] = useState('')

  const api = useCallback(async (path: string, body?: unknown, method?: string) => {
    const url = serverUrl(port, path)
    if (!url) return null
    try {
      const m = method ?? (body !== undefined ? 'POST' : 'GET')
      const res = await sidecarFetch(url, { method: m, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined })
      return res.json()
    } catch { return null }
  }, [port])

  useEffect(() => {
    if (!port) return
    api('/proxy/map/remote').then((d) => { if (d?.rules) setRules(d.rules) })
  }, [port, api])

  const save = async () => {
    await api('/proxy/map/remote', { rules })
    setMessage('Saved'); setTimeout(() => setMessage(''), 2000)
  }

  const add = () => setRules([...rules, { pattern: '', target: '', enabled: true }])
  const update = (idx: number, patch: Partial<MapRemoteRule>) => setRules(rules.map((r, i) => i === idx ? { ...r, ...patch } : r))
  const remove = (idx: number) => setRules(rules.filter((_, i) => i !== idx))

  return (
    <div className="flex-1 overflow-auto p-4 flex flex-col gap-4">
      <div className="bg-surface-1 border border-border-2 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-1">
          <Map size={13} className="text-accent" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-4 flex-1">Map Remote — redirect URLs to other URLs</span>
          <button onClick={add} className="flex items-center gap-1 px-2.5 py-1.5 bg-accent/10 hover:bg-accent/20 text-accent border border-accent/25 rounded-md text-[10px] font-semibold transition-colors">
            <Plus size={10} /> Add
          </button>
          <button onClick={save} className="flex items-center gap-1 px-2.5 py-1.5 bg-accent hover:bg-accent-hover text-white rounded-md text-[10px] font-semibold transition-colors">
            Save
          </button>
        </div>
        {message && <div className="px-4 py-2 text-[11px] text-success border-b border-border-1">{message}</div>}
        <div className="divide-y divide-border-1/40">
          {rules.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-text-4">No map-remote rules. Redirect traffic from one URL pattern to another.</div>
          ) : rules.map((rule, idx) => (
            <div key={idx} className="flex items-center gap-3 px-4 py-2">
              <input type="checkbox" checked={rule.enabled} onChange={(e) => update(idx, { enabled: e.target.checked })} className="accent-accent" />
              <input value={rule.pattern} onChange={(e) => update(idx, { pattern: e.target.value })}
                placeholder="https://api.your-domain.com/prod/*"
                className="flex-1 h-7 px-2 bg-surface-2 border border-border-2 rounded-lg text-xs text-text-1 font-mono outline-none focus:border-accent" />
              <span className="text-text-4 text-xs">→</span>
              <input value={rule.target} onChange={(e) => update(idx, { target: e.target.value })}
                placeholder="https://api.your-domain.com/staging/*"
                className="flex-1 h-7 px-2 bg-surface-2 border border-border-2 rounded-lg text-xs text-text-1 font-mono outline-none focus:border-accent" />
              <button onClick={() => remove(idx)} className="text-text-4 hover:text-error transition-colors"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Throttle sub-panel ───────────────────────────────────────────────────────

function ThrottleTab({ port }: { port: number | null }) {
  const [cfg, setCfg] = useState<ThrottleConfig>({ enabled: false, latencyMs: 0, bandwidthKbps: 0, packetLossRate: 0 })
  const [message, setMessage] = useState('')

  const api = useCallback(async (path: string, body?: unknown, method?: string) => {
    const url = serverUrl(port, path)
    if (!url) return null
    try {
      const m = method ?? (body !== undefined ? 'POST' : 'GET')
      const res = await sidecarFetch(url, { method: m, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined })
      return res.json()
    } catch { return null }
  }, [port])

  useEffect(() => {
    if (!port) return
    api('/proxy/throttle').then((d) => { if (d?.config) setCfg(d.config) })
  }, [port, api])

  const save = async () => {
    await api('/proxy/throttle', cfg)
    setMessage(cfg.enabled ? 'Throttle active' : 'Throttle disabled')
    setTimeout(() => setMessage(''), 2000)
  }

  const PRESETS = [
    { label: '3G', latencyMs: 100, bandwidthKbps: 750, packetLossRate: 0 },
    { label: '4G', latencyMs: 50, bandwidthKbps: 4000, packetLossRate: 0 },
    { label: 'Slow WiFi', latencyMs: 150, bandwidthKbps: 1000, packetLossRate: 2 },
    { label: 'Offline', latencyMs: 0, bandwidthKbps: 0, packetLossRate: 100 },
  ]

  return (
    <div className="flex-1 overflow-auto p-4 flex flex-col gap-4 max-w-xl">
      <div className="bg-surface-1 border border-border-2 rounded-xl p-4 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Zap size={14} className="text-accent" />
          <span className="text-sm font-semibold text-text-1">Network Throttle</span>
          <label className="ml-auto flex items-center gap-2 cursor-pointer">
            <span className="text-xs text-text-3">{cfg.enabled ? 'Active' : 'Inactive'}</span>
            <div
              onClick={() => setCfg({ ...cfg, enabled: !cfg.enabled })}
              className={cn('w-9 h-5 rounded-full transition-colors cursor-pointer', cfg.enabled ? 'bg-accent' : 'bg-surface-3')}
            >
              <div className={cn('w-4 h-4 rounded-full bg-white shadow m-0.5 transition-transform', cfg.enabled ? 'translate-x-4' : '')} />
            </div>
          </label>
        </div>

        <div className="flex gap-2 flex-wrap">
          {PRESETS.map((p) => (
            <button key={p.label}
              onClick={() => setCfg({ ...cfg, ...p, enabled: true })}
              className="px-3 py-1.5 bg-surface-2 border border-border-2 hover:border-accent/40 rounded-lg text-xs text-text-3 hover:text-text-1 transition-colors">
              {p.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-4">Latency (ms)</span>
            <input type="number" value={cfg.latencyMs} onChange={(e) => setCfg({ ...cfg, latencyMs: Number(e.target.value) })} min={0}
              className="h-8 px-2 bg-surface-2 border border-border-2 rounded-lg text-xs text-text-1 outline-none focus:border-accent" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-4">Bandwidth (kbps)</span>
            <input type="number" value={cfg.bandwidthKbps} onChange={(e) => setCfg({ ...cfg, bandwidthKbps: Number(e.target.value) })} min={0}
              className="h-8 px-2 bg-surface-2 border border-border-2 rounded-lg text-xs text-text-1 outline-none focus:border-accent" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-4">Packet Loss (%)</span>
            <input type="number" value={cfg.packetLossRate} onChange={(e) => setCfg({ ...cfg, packetLossRate: Number(e.target.value) })} min={0} max={100}
              className="h-8 px-2 bg-surface-2 border border-border-2 rounded-lg text-xs text-text-1 outline-none focus:border-accent" />
          </label>
        </div>

        {message && <div className="px-3 py-2 rounded-lg text-xs bg-success/8 border border-success/25 text-success">{message}</div>}

        <button onClick={save}
          className="self-start flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-xs font-semibold shadow-[0_0_12px_var(--color-accent-glow)] transition-all">
          Apply Throttle
        </button>
      </div>
    </div>
  )
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

const PROXY_TABS: { id: ProxyTab; label: string }[] = [
  { id: 'traffic', label: 'Traffic' },
  { id: 'rules', label: 'Rules' },
  { id: 'ca', label: 'CA / HTTPS' },
  { id: 'maplocal', label: 'Map Local' },
  { id: 'mapremote', label: 'Map Remote' },
  { id: 'throttle', label: 'Throttle' },
]

export function ProxyPanel() {
  const port = useServerPort()
  const settings = useSettingsStore((s) => s.settings)
  const [proxyPort, setProxyPort] = useState(settings.proxy?.defaultProxyPort ?? 8888)
  const [status, setStatus] = useState<ProxyStatus>({ running: false, port: 0 })
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<ProxyTab>('traffic')

  const api = useCallback(async (path: string, body?: unknown, method?: string) => {
    const url = serverUrl(port, path)
    if (!url) return null
    try {
      const m = method ?? (body !== undefined ? 'POST' : 'GET')
      const res = await sidecarFetch(url, { method: m, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined })
      return res.json()
    } catch { return null }
  }, [port])

  const refreshStatus = useCallback(async () => {
    const data = await api('/proxy/traffic')
    if (data && typeof data.running === 'boolean') {
      setStatus({ running: data.running, port: data.port ?? 0 })
      useAppStore.getState().setProxyRunning(data.running)
    }
  }, [api])

  useEffect(() => {
    if (!port) return
    refreshStatus()
    const t = setInterval(refreshStatus, 3000)
    return () => clearInterval(t)
  }, [port, refreshStatus])

  const handleStart = useCallback(async () => {
    setLoading(true)
    await api('/proxy/start', { port: proxyPort, breakpoints: [] })
    setStatus({ running: true, port: proxyPort })
    useAppStore.getState().setProxyRunning(true)
    setLoading(false)
  }, [api, proxyPort])

  useEffect(() => {
    const startFromCommandPalette = (event: Event) => {
      const command = event as CustomEvent<{ handled: boolean }>
      command.detail.handled = true
      void handleStart()
    }
    document.addEventListener('adomnia:start-proxy', startFromCommandPalette)
    return () => document.removeEventListener('adomnia:start-proxy', startFromCommandPalette)
  }, [handleStart])

  const handleStop = async () => {
    setLoading(true)
    await api('/proxy/stop', {})
    setStatus({ running: false, port: 0 })
    useAppStore.getState().setProxyRunning(false)
    setLoading(false)
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border-1 shrink-0">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-accent" />
          <h2 className="text-sm font-semibold text-text-1">Proxy Interceptor</h2>
        </div>
        <div className={cn('flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold border',
          status.running ? 'bg-success/10 text-success border-success/25' : 'bg-surface-2 text-text-4 border-border-2')}>
          {status.running && <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />}
          {status.running ? `Running :${status.port}` : 'Stopped'}
        </div>
        <div className="flex-1" />
        <label className="flex items-center gap-1.5">
          <span className="text-[10px] text-text-4">Port</span>
          <input type="number" value={proxyPort} onChange={(e) => setProxyPort(Number(e.target.value))} disabled={status.running}
            className="w-16 h-7 px-2 bg-surface-2 border border-border-2 rounded-lg text-xs text-text-1 outline-none focus:border-accent disabled:opacity-50 text-center" />
        </label>
        {!status.running ? (
          <button onClick={handleStart} disabled={loading || !port}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-accent hover:bg-accent-hover text-white rounded-lg text-xs font-semibold shadow-[0_0_12px_var(--color-accent-glow)] disabled:opacity-50 disabled:shadow-none transition-all">
            <Play size={11} /> Start
          </button>
        ) : (
          <button onClick={handleStop} disabled={loading}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-error/80 hover:bg-error text-white rounded-lg text-xs font-semibold disabled:opacity-50 transition-colors">
            <Square size={11} /> Stop
          </button>
        )}
      </div>

      {!status.running && (
        <div className="px-4 py-1.5 border-b border-border-1 bg-surface-1/40 shrink-0">
          <p className="text-[11px] text-text-4">
            Configure your HTTP client to proxy <code className="text-accent font-mono bg-accent/8 px-1 py-0.5 rounded">127.0.0.1:{proxyPort}</code>
          </p>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex items-center gap-0.5 px-4 border-b border-border-1 shrink-0 bg-surface-1/20">
        {PROXY_TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn('px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors',
              tab === t.id ? 'border-accent text-accent' : 'border-transparent text-text-3 hover:text-text-2')}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'traffic' && <TrafficTab port={port} status={status} />}
      {tab === 'rules' && <RulesTab port={port} />}
      {tab === 'ca' && <CATab port={port} />}
      {tab === 'maplocal' && <MapLocalTab port={port} />}
      {tab === 'mapremote' && <MapRemoteTab port={port} />}
      {tab === 'throttle' && <ThrottleTab port={port} />}
    </div>
  )
}
